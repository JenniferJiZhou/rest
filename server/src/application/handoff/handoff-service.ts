import { createHash } from "node:crypto";
import {
  CONTRACT_VERSION,
  handoffJobSchema,
  handoffJobStateSchema,
  handoffStartRequestSchema,
  handoffSummarySchema,
  type HandoffJob,
  type HandoffJobState,
  type HandoffStartRequest,
  type HandoffSummary
} from "../../domain/contracts.js";
import {
  AppError,
  toErrorResponse,
  unknownToAppError
} from "../../domain/errors.js";
import { canonicalRequestHash } from "../../domain/request-hash.js";
import type {
  AgentLLM,
  Clock,
  ClassifiedMail,
  HandoffCompletionSink,
  HandoffJobRecord,
  HandoffJobRepository,
  IdGenerator,
  IdempotencyStore,
  MailItem,
  MailProvider
} from "../../domain/ports.js";
import { withProviderTimeout } from "../../infra/provider-call.js";

const JOB_TTL_SECONDS = 24 * 60 * 60;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUTS: HandoffProviderTimeouts = {
  llmMs: 15_000,
  mailFetchMs: 10_000,
  draftCreateMs: 10_000,
  completionMs: 5_000
};

type DraftResults = Map<
  string,
  { saved: boolean; draftId: string | null; preview: string }
>;

export interface HandoffServiceOptions {
  log?(entry: {
    event: "handoff_completion_failed";
    jobId: string;
    requestId: string;
    errorCode: string;
  }): void;
  timeouts?: Partial<HandoffProviderTimeouts>;
}

export interface HandoffProviderTimeouts {
  llmMs: number;
  mailFetchMs: number;
  draftCreateMs: number;
  completionMs: number;
}

export class HandoffService {
  private readonly completionClaims = new Set<string>();
  private readonly jobControllers = new Map<string, AbortController>();
  private lastCleanupAtMs: number | null = null;

  constructor(
    private readonly jobs: HandoffJobRepository,
    private readonly idempotency: IdempotencyStore<string>,
    private readonly mail: MailProvider,
    private readonly agent: AgentLLM,
    private readonly completionSink: HandoffCompletionSink,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly options: HandoffServiceOptions = {}
  ) {}

  private get timeouts(): HandoffProviderTimeouts {
    return {
      ...DEFAULT_TIMEOUTS,
      ...this.options.timeouts
    };
  }

  async start(
    input: HandoffStartRequest,
    idempotencyKey: string
  ): Promise<HandoffJob> {
    const request = handoffStartRequestSchema.parse(input);
    await this.cleanupExpired();
    const claim = await this.idempotency.claimOrGet({
      key: idempotencyKey,
      requestHash: canonicalRequestHash(request),
      ttlSeconds: JOB_TTL_SECONDS,
      create: async () => {
        const jobId = this.ids.next("hj");
        const now = this.clock.now().toISOString();
        const job = handoffJobSchema.parse({
          schema_version: CONTRACT_VERSION,
          request_id: request.request_id,
          job_id: jobId,
          status: "queued",
          estimated_wait_seconds: request.include_gmail ? 20 : 5,
          micro_reset_available: true
        });
        const state = handoffJobStateSchema.parse({
          schema_version: CONTRACT_VERSION,
          request_id: request.request_id,
          job_id: jobId,
          status: "queued",
          progress_stage: "queued",
          estimated_wait_seconds: job.estimated_wait_seconds,
          summary: null,
          error: null
        });
        await this.jobs.create({
          job,
          request,
          state,
          idempotencyKey,
          createdAt: now,
          updatedAt: now,
          cancelled: false
        });
        return jobId;
      }
    });
    if (claim.kind === "conflict_different_request") {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "该 Idempotency-Key 已用于不同的交班请求。",
        statusCode: 409,
        retryable: false,
        details: {
          reason: "IDEMPOTENCY_KEY_REUSED"
        }
      });
    }

    const record = await this.requireJob(claim.value);
    if (claim.kind === "created") {
      setImmediate(() => {
        void this.process(claim.value);
      });
    }
    return handoffJobSchema.parse({
      ...record.job,
      request_id: request.request_id
    });
  }

  async get(jobId: string, requestId: string): Promise<HandoffJobState> {
    const record = await this.requireJob(jobId);
    return handoffJobStateSchema.parse({
      ...record.state,
      request_id: requestId,
      summary: record.state.summary
        ? { ...record.state.summary, request_id: requestId }
        : record.state.summary,
      error: record.state.error
        ? { ...record.state.error, request_id: requestId }
        : record.state.error
    });
  }

  async cancel(jobId: string): Promise<void> {
    const record = await this.requireJob(jobId);
    if (["succeeded", "failed", "cancelled"].includes(record.state.status)) {
      this.jobControllers.get(jobId)?.abort(
        new Error("Handoff Job cancelled.")
      );
      return;
    }
    const result = await this.jobs.transition(jobId, {
      expectedStatuses: ["queued", "running"],
      updatedAt: this.clock.now().toISOString(),
      nextState: handoffJobStateSchema.parse({
        ...record.state,
        status: "cancelled",
        progress_stage: "cancelled",
        estimated_wait_seconds: 0,
        summary: null,
        error: null
      })
    });
    if (result.kind === "not_found") {
      throw this.jobNotFound();
    }
    this.jobControllers.get(jobId)?.abort(
      new Error("Handoff Job cancelled.")
    );
  }

  async process(jobId: string): Promise<void> {
    if (this.jobControllers.has(jobId)) {
      return;
    }
    const controller = new AbortController();
    this.jobControllers.set(jobId, controller);
    try {
      const fetching = await this.setRunning(
        jobId,
        ["queued"],
        "fetching_mail",
        18
      );
      if (!fetching) {
        return;
      }

      const mailResult = await this.fetchMail(
        fetching.request,
        controller.signal
      );
      const classifying = await this.setRunning(
        jobId,
        ["running"],
        "classifying",
        12
      );
      if (!classifying) {
        return;
      }

      const draft = await withProviderTimeout({
        signal: controller.signal,
        timeoutMs: this.timeouts.llmMs,
        timeoutError: () =>
          new AppError({
            code: "LLM_TIMEOUT",
            message: "Model provider timed out.",
            statusCode: 503,
            retryable: true,
            fallback: "LOCAL_RULES",
            details: {
              reason: "timeout",
              operation: "summarize_handoff"
            }
          }),
        operation: (signal) =>
          this.agent.summarizeHandoff(
            {
              request: classifying.request,
              mail: mailResult.items,
              mailAvailable: mailResult.available
            },
            { signal }
          )
      });
      const classifications = this.normalizeClassifications(
        mailResult.items,
        draft.classifications
      );
      const creatingDrafts = await this.setRunning(
        jobId,
        ["running"],
        "creating_drafts",
        7
      );
      if (!creatingDrafts) {
        return;
      }

      const draftResults = await this.processDrafts(
        creatingDrafts,
        mailResult.items,
        classifications,
        controller.signal
      );
      const preparingReceipt = await this.setRunning(
        jobId,
        ["running"],
        "preparing_receipt",
        2
      );
      if (!preparingReceipt) {
        return;
      }

      const summary = this.buildSummary(
        preparingReceipt,
        mailResult.items,
        mailResult.available,
        classifications,
        draftResults,
        draft.tomorrowFirstStep
      );
      const completed = handoffJobStateSchema.parse({
        schema_version: CONTRACT_VERSION,
        request_id: preparingReceipt.request.request_id,
        job_id: jobId,
        status: "succeeded",
        progress_stage: "completed",
        estimated_wait_seconds: null,
        summary,
        error: null
      });
      const completion = await this.jobs.transition(jobId, {
        expectedStatuses: ["running"],
        nextState: completed,
        updatedAt: this.clock.now().toISOString()
      });
      if (completion.kind !== "updated") {
        return;
      }
      const finalRecord = await this.requireJob(jobId);
      await this.deliverCompletion(finalRecord, controller.signal);
    } catch (error) {
      const appError = unknownToAppError(error);
      const record = await this.jobs.get(jobId);
      if (!record) {
        return;
      }
      await this.jobs.transition(jobId, {
        expectedStatuses: ["running"],
        updatedAt: this.clock.now().toISOString(),
        nextState: handoffJobStateSchema.parse({
          schema_version: CONTRACT_VERSION,
          request_id: record.request.request_id,
          job_id: jobId,
          status: "failed",
          progress_stage: "failed",
          estimated_wait_seconds: null,
          summary: null,
          error: toErrorResponse(appError, record.request.request_id)
        })
      });
    } finally {
      if (this.jobControllers.get(jobId) === controller) {
        this.jobControllers.delete(jobId);
      }
    }
  }

  private async fetchMail(
    request: HandoffStartRequest,
    jobSignal: AbortSignal
  ): Promise<{ items: MailItem[]; available: boolean }> {
    if (!request.include_gmail) {
      return { items: [], available: false };
    }
    try {
      return {
        items: await withProviderTimeout({
          signal: jobSignal,
          timeoutMs: this.timeouts.mailFetchMs,
          timeoutError: () =>
            new AppError({
              code: "GMAIL_UNAVAILABLE",
              message: "Mail provider timed out.",
              statusCode: 503,
              retryable: true,
              fallback: "OPEN_LOOPS_ONLY",
              details: {
                reason: "timeout",
                operation: "fetch_unread"
              }
            }),
          operation: (signal) =>
            this.mail.fetchUnread(
              {
                accountId: request.gmail_account_id ?? null,
                since: this.clock.now().toISOString(),
                maxItems: 30
              },
              { signal }
            )
        }),
        available: true
      };
    } catch {
      return { items: [], available: false };
    }
  }

  private normalizeClassifications(
    mail: MailItem[],
    proposed: ClassifiedMail[]
  ): ClassifiedMail[] {
    const validIds = new Set(mail.map((item) => item.id));
    const byId = new Map<string, ClassifiedMail>();
    for (const item of proposed) {
      if (validIds.has(item.id) && !byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
    return mail.map(
      (item) =>
        byId.get(item.id) ?? {
          id: item.id,
          priority: "uncertain",
          gist: item.subject || "未命名邮件",
          reason: "模型没有为这封邮件返回可验证的分类。",
          suggestedDraft: null
        }
    );
  }

  private async processDrafts(
    record: HandoffJobRecord,
    mail: MailItem[],
    classifications: ClassifiedMail[],
    jobSignal: AbortSignal
  ): Promise<DraftResults> {
    const mailById = new Map(mail.map((item) => [item.id, item]));
    const draftResults: DraftResults = new Map();

    for (const item of classifications) {
      const source = mailById.get(item.id);
      if (
        !source ||
        !item.suggestedDraft ||
        !["tonight_required", "tomorrow"].includes(item.priority)
      ) {
        continue;
      }
      const suggestedDraft = item.suggestedDraft;
      try {
        const result = await withProviderTimeout({
          signal: jobSignal,
          timeoutMs: this.timeouts.draftCreateMs,
          timeoutError: () =>
            new AppError({
              code: "GMAIL_DRAFT_FAILED",
              message: "Draft creation timed out.",
              statusCode: 503,
              retryable: true,
              fallback: "SUMMARY_ONLY",
              details: {
                reason: "timeout",
                operation: "create_draft"
              }
            }),
          operation: (signal) =>
            this.mail.createDraft(
              {
                forItemId: source.id,
                threadId: source.threadId,
                to: source.replyTo ?? source.from,
                subject: source.subject.startsWith("Re:")
                  ? source.subject
                  : `Re: ${source.subject}`,
                bodyText: suggestedDraft,
                dedupeKey: this.draftDedupeKey(
                  record.job.job_id,
                  source.id
                )
              },
              { signal }
            )
        });
        draftResults.set(source.id, {
          saved: true,
          draftId: result.draftId,
          preview: suggestedDraft.slice(0, 160)
        });
      } catch {
        draftResults.set(source.id, {
          saved: false,
          draftId: null,
          preview: suggestedDraft.slice(0, 160)
        });
      }
    }
    return draftResults;
  }

  private buildSummary(
    record: HandoffJobRecord,
    mail: MailItem[],
    mailAvailable: boolean,
    classifications: ClassifiedMail[],
    draftResults: DraftResults,
    proposedFirstStep: string | null
  ): HandoffSummary {
    const mailById = new Map(mail.map((item) => [item.id, item]));
    const toSummaryItem = (item: ClassifiedMail) => {
      const source = mailById.get(item.id);
      const draftResult = draftResults.get(item.id);
      return {
        id: item.id,
        from: source?.from ?? "",
        subject: source?.subject ?? "",
        gist: item.gist,
        priority_reason: item.reason,
        draft_saved: draftResult?.saved ?? false
      };
    };
    const includedSources: string[] = [];
    const excludedSources: string[] = [
      "wechat",
      "phone_calls",
      "other_unconnected_channels"
    ];
    if (record.request.open_loops.length > 0) {
      includedSources.push("user_submitted_open_loops");
    }
    if (mailAvailable) {
      includedSources.push("authorized_gmail");
    } else if (record.request.include_gmail) {
      excludedSources.unshift("authorized_gmail_unavailable");
    } else {
      excludedSources.unshift("authorized_gmail_not_requested");
    }

    const firstStep =
      proposedFirstStep ??
      record.request.open_loops[0]?.text ??
      classifications.find((item) => item.priority === "tomorrow")?.gist ??
      null;
    const heldOpenLoops = record.request.open_loops.map((item) => ({
      id: item.id,
      title: item.text,
      status: "saved_for_tomorrow" as const
    }));
    const heldDrafts = classifications
      .filter((item) => draftResults.get(item.id)?.saved)
      .map((item) => ({
        id: item.id,
        title: item.gist,
        status: "gmail_draft_saved" as const
      }));
    const heldFailedDrafts = classifications
      .filter((item) => {
        const result = draftResults.get(item.id);
        return result !== undefined && !result.saved;
      })
      .map((item) => ({
        id: item.id,
        title: item.gist,
        status: "not_saved" as const
      }));
    const heldUncertain = classifications
      .filter((item) => item.priority === "uncertain")
      .map((item) => ({
        id: item.id,
        title: item.gist,
        status: "needs_review" as const
      }));

    return handoffSummarySchema.parse({
      schema_version: CONTRACT_VERSION,
      request_id: record.request.request_id,
      job_id: record.job.job_id,
      total_unread: mail.length,
      tonight_required: classifications
        .filter((item) => item.priority === "tonight_required")
        .map(toSummaryItem),
      tomorrow: classifications
        .filter((item) => item.priority === "tomorrow")
        .map(toSummaryItem),
      no_action_count: classifications.filter(
        (item) => item.priority === "no_action"
      ).length,
      uncertain: classifications
        .filter((item) => item.priority === "uncertain")
        .map(toSummaryItem),
      drafts: classifications
        .filter((item) => draftResults.has(item.id))
        .map((item) => {
          const result = draftResults.get(item.id)!;
          return {
            for_item_id: item.id,
            preview: result.preview,
            saved: result.saved,
            gmail_draft_id: result.draftId
          };
        }),
      pause_receipt: {
        coverage: {
          included_sources: includedSources,
          excluded_sources: excludedSources,
          since: record.createdAt
        },
        held_items: [
          ...heldOpenLoops,
          ...heldDrafts,
          ...heldFailedDrafts,
          ...heldUncertain
        ],
        tomorrow_first_step: firstStep,
        conclusion: mailAvailable
          ? heldFailedDrafts.length > 0
            ? "你主动交接的事项已经保存；邮件已经完成分类，但部分草稿未能保存，请在回执中查看。"
            : "你主动交接的事项已经保存；在已授权 Gmail 范围内，邮件已经完成分类。"
          : record.request.include_gmail
            ? "你主动交接的事项已经保存；Gmail 本次不可用，因此没有检查邮箱。"
            : "你主动交接的事项已经保存；本次未请求检查 Gmail。",
        coverage_note:
          heldFailedDrafts.length > 0
            ? "部分建议草稿未保存成功；结论只适用于上述已覆盖来源，未连接渠道不在本次判断范围内。"
            : "结论只适用于上述已覆盖来源，未连接渠道不在本次判断范围内。"
      }
    });
  }

  private async setRunning(
    jobId: string,
    expectedStatuses: HandoffJobState["status"][],
    stage: HandoffJobState["progress_stage"],
    remaining: number
  ): Promise<HandoffJobRecord | null> {
    const record = await this.requireJob(jobId);
    const result = await this.jobs.transition(jobId, {
      expectedStatuses,
      updatedAt: this.clock.now().toISOString(),
      nextState: handoffJobStateSchema.parse({
        ...record.state,
        status: "running",
        progress_stage: stage,
        estimated_wait_seconds: remaining,
        summary: null,
        error: null
      })
    });
    if (result.kind === "not_found") {
      throw this.jobNotFound();
    }
    return result.kind === "updated" ? result.record : null;
  }

  private async requireJob(jobId: string): Promise<HandoffJobRecord> {
    const record = await this.jobs.get(jobId);
    if (!record) {
      throw this.jobNotFound();
    }
    return record;
  }

  private jobNotFound(): AppError {
    return new AppError({
      code: "JOB_NOT_FOUND",
      message: "没有找到这次交班任务。",
      statusCode: 404,
      retryable: false
    });
  }

  private async deliverCompletion(
    record: HandoffJobRecord,
    jobSignal: AbortSignal
  ): Promise<void> {
    if (
      record.state.status !== "succeeded" ||
      record.request.response_channel !== "imessage" ||
      this.completionClaims.has(record.job.job_id)
    ) {
      return;
    }
    this.completionClaims.add(record.job.job_id);
    try {
      await withProviderTimeout({
        signal: jobSignal,
        timeoutMs: this.timeouts.completionMs,
        timeoutError: () =>
          new AppError({
            code: "PHOTON_UNAVAILABLE",
            message: "Completion delivery timed out.",
            statusCode: 503,
            retryable: true,
            fallback: "APP_ONLY",
            details: {
              reason: "timeout",
              operation: "completion_send"
            }
          }),
        operation: (signal) =>
          this.completionSink.notify(record, { signal })
      });
    } catch (error) {
      const entry = {
        event: "handoff_completion_failed" as const,
        jobId: record.job.job_id,
        requestId: record.request.request_id,
        errorCode:
          error instanceof AppError ? error.code : "INTERNAL_ERROR"
      };
      if (this.options.log) {
        this.options.log(entry);
      } else {
        console.warn(JSON.stringify(entry));
      }
    }
  }

  private async cleanupExpired(): Promise<void> {
    const now = this.clock.now();
    const nowMs = now.getTime();
    if (
      this.lastCleanupAtMs !== null &&
      nowMs - this.lastCleanupAtMs < CLEANUP_INTERVAL_MS
    ) {
      return;
    }
    this.lastCleanupAtMs = nowMs;
    const jobCutoff = new Date(
      nowMs - JOB_TTL_SECONDS * 1_000
    ).toISOString();
    try {
      await Promise.all([
        this.jobs.deleteExpired(jobCutoff),
        this.idempotency.deleteExpired(now.toISOString())
      ]);
    } catch {
      console.warn(
        JSON.stringify({ event: "handoff_cleanup_failed" })
      );
    }
  }

  private draftDedupeKey(jobId: string, mailId: string): string {
    return createHash("sha256")
      .update(`${jobId}:${mailId}`)
      .digest("hex");
  }
}

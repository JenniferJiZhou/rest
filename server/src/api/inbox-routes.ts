import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";
import type { InboxService } from "../application/inbox/inbox-service.js";
import {
  inboxAcknowledgeRequestSchema,
  inboxDraftPatchSchema,
  inboxEventBatchSchema,
  inboxSendRequestSchema
} from "../domain/contracts.js";

export interface InboxRouteContext {
  requestId: string;
  principalId: string;
  inbox: InboxService;
}

export interface InboxRouteHelpers {
  context(
    request: FastifyRequest,
    reply: FastifyReply,
    hasBody: boolean,
    access: "app" | "connector"
  ): InboxRouteContext;
  assertBodyRequestId(bodyRequestId: string, headerRequestId: string): void;
  requiredIdempotencyKey(request: FastifyRequest): string;
}

const listQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict();

export function registerInboxRoutes(
  server: FastifyInstance,
  helpers: InboxRouteHelpers
): void {
  server.post("/v1/inbox/events:batch", async (request, reply) => {
    const context = helpers.context(
      request,
      reply,
      true,
      "connector"
    );
    const input = inboxEventBatchSchema.parse(request.body);
    helpers.assertBodyRequestId(input.request_id, context.requestId);
    const result = await context.inbox.ingest(input);
    return reply.status(202).send({
      accepted: result.accepted,
      duplicates: result.duplicates,
      item_ids: result.itemIds
    });
  });

  server.get("/v1/inbox/items", async (request, reply) => {
    const context = helpers.context(request, reply, false, "app");
    const query = listQuerySchema.parse(request.query);
    const result = await context.inbox.listItems(
      query.cursor
        ? { cursor: query.cursor, limit: query.limit }
        : { limit: query.limit }
    );
    return {
      items: result.items,
      next_cursor: result.nextCursor
    };
  });

  server.get<{
    Params: { itemId: string };
  }>("/v1/inbox/items/:itemId", async (request, reply) => {
    const context = helpers.context(request, reply, false, "app");
    return context.inbox.getItem(request.params.itemId);
  });

  server.post<{
    Params: { itemId: string };
  }>(
    "/v1/inbox/items/:itemId(^[^:]+)::acknowledge",
    async (request, reply) => {
      const context = helpers.context(request, reply, true, "app");
      const input = inboxAcknowledgeRequestSchema.parse(request.body);
      helpers.assertBodyRequestId(
        input.request_id,
        context.requestId
      );
      return context.inbox.acknowledge(
        request.params.itemId,
        input.expected_revision
      );
    }
  );

  server.post<{
    Params: { itemId: string };
  }>("/v1/inbox/items/:itemId/summary", async (request, reply) => {
    const context = helpers.context(request, reply, false, "app");
    return context.inbox.summarize(request.params.itemId);
  });

  server.post<{
    Params: { itemId: string };
  }>("/v1/inbox/items/:itemId/draft", async (request, reply) => {
    const context = helpers.context(request, reply, false, "app");
    return context.inbox.createDraft(request.params.itemId);
  });

  server.get<{
    Params: { draftId: string };
  }>("/v1/inbox/drafts/:draftId", async (request, reply) => {
    const context = helpers.context(request, reply, false, "app");
    return context.inbox.getDraft(request.params.draftId);
  });

  server.patch<{
    Params: { draftId: string };
  }>("/v1/inbox/drafts/:draftId", async (request, reply) => {
    const context = helpers.context(request, reply, true, "app");
    const input = inboxDraftPatchSchema.parse(request.body);
    helpers.assertBodyRequestId(input.request_id, context.requestId);
    return context.inbox.updateDraft(request.params.draftId, {
      content: input.content,
      contentType: input.content_type,
      expectedVersion: input.expected_version
    });
  });

  server.post<{
    Params: { draftId: string };
  }>(
    "/v1/inbox/drafts/:draftId/confirmation",
    async (request, reply) => {
      const context = helpers.context(request, reply, false, "app");
      const confirmation = await context.inbox.issueConfirmation(
        request.params.draftId,
        context.principalId
      );
      return {
        confirmation_token: confirmation.token,
        expires_at: confirmation.expiresAt
      };
    }
  );

  server.post<{
    Params: { draftId: string };
  }>(
    "/v1/inbox/drafts/:draftId(^[^:]+)::send",
    async (request, reply) => {
    const context = helpers.context(request, reply, true, "app");
    const idempotencyKey =
      helpers.requiredIdempotencyKey(request);
    const input = inboxSendRequestSchema.parse(request.body);
    helpers.assertBodyRequestId(input.request_id, context.requestId);
    return context.inbox.sendDraft(request.params.draftId, {
      expectedVersion: input.expected_version,
      confirmationToken: input.confirmation_token,
      idempotencyKey,
      principalId: context.principalId
    });
    }
  );

  server.get("/v1/inbox/sync-status", async (request, reply) => {
    const context = helpers.context(request, reply, false, "app");
    return context.inbox.syncStatus();
  });
}

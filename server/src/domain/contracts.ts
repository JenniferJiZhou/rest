import { z } from "zod";

export const CONTRACT_VERSION = "1.0" as const;
export const CONTENT_VERSION = "1.0.0" as const;

const schemaVersion = z.literal(CONTRACT_VERSION);
const requestId = z.string().min(1);
const userProvidedContextLabel = z
  .string()
  .refine((value) => !/\p{Cc}/u.test(value), {
    message: "user_provided_context_label must not contain control characters"
  })
  .transform((value) => value.trim().normalize("NFC"))
  .refine((value) => Array.from(value).length >= 1, {
    message: "user_provided_context_label must not be empty"
  })
  .refine((value) => Array.from(value).length <= 80, {
    message: "user_provided_context_label must be at most 80 characters"
  });
const websiteDomain = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .transform((value) =>
    value.startsWith("www.") ? value.slice(4) : value
  )
  .refine(
    (value) =>
      /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u.test(
        value
      ),
    {
      message: "website_domain must be a hostname without URL components"
    }
  );

export const fatigueTypeSchema = z.enum([
  "physical",
  "sensory_overload",
  "cognitive_overload",
  "emotional_social",
  "bedtime_arousal",
  "unknown"
]);

export const usageSummarySchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    measured_at: z.iso.datetime({ offset: true }),
    platform: z.enum(["ios", "ipados", "macos"]),
    trigger_source: z.enum([
      "device_activity_threshold",
      "macos_usage_checkpoint",
      "macos_website_checkpoint",
      "macos_rule",
      "manual_ios",
      "manual_macos",
      "notification",
      "debug"
    ]),
    user_provided_context_label: userProvidedContextLabel
      .nullable()
      .optional(),
    daily_app_usage_minutes: z.number().int().min(0).max(1440).optional(),
    estimated_continuous_app_usage_minutes: z
      .number()
      .int()
      .min(0)
      .max(1440)
      .optional(),
    continuous_app_usage_minutes: z
      .number()
      .int()
      .min(0)
      .max(1440)
      .optional(),
    target_type: z.literal("website").optional(),
    website_domain: websiteDomain.optional(),
    label_source: z.enum(["domain", "user"]).optional(),
    daily_usage_minutes: z.number().int().min(0).max(1440).optional(),
    continuous_usage_minutes: z.number().int().min(0).max(1440).optional(),
    full_url_included: z.literal(false).optional(),
    page_title_included: z.literal(false).optional(),
    continuous_usage_is_estimated: z.boolean().optional(),
    continuous_screen_minutes: z.number().int().min(0).nullable().optional(),
    app_switches_last_10_minutes: z.number().int().min(0).nullable().optional(),
    local_hour: z.number().int().min(0).max(23),
    minutes_since_last_rest: z.number().int().min(0),
    self_reported_energy: z.number().int().min(1).max(5).nullable().optional(),
    recent_feedback: z
      .array(z.enum(["too_early", "right", "too_late"]))
      .optional()
      .default([]),
    raw_app_names_included: z.literal(false).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const appCurrentFields = [
      "user_provided_context_label",
      "daily_app_usage_minutes",
      "estimated_continuous_app_usage_minutes",
      "continuous_app_usage_minutes",
      "continuous_usage_is_estimated"
    ] as const;
    const websiteCurrentFields = [
      "target_type",
      "website_domain",
      "label_source",
      "daily_usage_minutes",
      "continuous_usage_minutes",
      "full_url_included",
      "page_title_included"
    ] as const;
    const hasCurrent = [...appCurrentFields, ...websiteCurrentFields].some(
      (field) => value[field] !== undefined
    );
    const hasLegacy = value.continuous_screen_minutes !== undefined;

    if (hasCurrent && hasLegacy) {
      context.addIssue({
        code: "custom",
        path: ["continuous_screen_minutes"],
        message: "current and legacy usage fields cannot be combined"
      });
    }

    if (hasLegacy && !hasCurrent) {
      requireFields(
        value,
        ["continuous_screen_minutes", "raw_app_names_included"],
        context
      );
      if (
        value.trigger_source === "macos_usage_checkpoint" ||
        value.trigger_source === "macos_website_checkpoint"
      ) {
        context.addIssue({
          code: "custom",
          path: ["trigger_source"],
          message: "current Mac triggers require their current usage format"
        });
      }
    } else if (value.trigger_source === "device_activity_threshold") {
      requireFields(
        value,
        [
          "user_provided_context_label",
          "daily_app_usage_minutes",
          "estimated_continuous_app_usage_minutes",
          "continuous_usage_is_estimated",
          "raw_app_names_included"
        ],
        context
      );
      requireUserLabel(value.user_provided_context_label, context);
      requireLiteral(
        value.continuous_usage_is_estimated,
        true,
        "continuous_usage_is_estimated",
        context
      );
      compareUsage(
        value.estimated_continuous_app_usage_minutes,
        value.daily_app_usage_minutes,
        "estimated_continuous_app_usage_minutes",
        context
      );
      forbidFields(
        value,
        [
          "continuous_app_usage_minutes",
          "target_type",
          "website_domain",
          "label_source",
          "daily_usage_minutes",
          "continuous_usage_minutes",
          "full_url_included",
          "page_title_included"
        ],
        context
      );
    } else if (value.trigger_source === "macos_usage_checkpoint") {
      requireFields(
        value,
        [
          "user_provided_context_label",
          "daily_app_usage_minutes",
          "continuous_app_usage_minutes",
          "continuous_usage_is_estimated",
          "raw_app_names_included"
        ],
        context
      );
      requireUserLabel(value.user_provided_context_label, context);
      requireLiteral(
        value.continuous_usage_is_estimated,
        false,
        "continuous_usage_is_estimated",
        context
      );
      compareUsage(
        value.continuous_app_usage_minutes,
        value.daily_app_usage_minutes,
        "continuous_app_usage_minutes",
        context
      );
      forbidFields(
        value,
        [
          "estimated_continuous_app_usage_minutes",
          "target_type",
          "website_domain",
          "label_source",
          "daily_usage_minutes",
          "continuous_usage_minutes",
          "full_url_included",
          "page_title_included"
        ],
        context
      );
    } else if (value.trigger_source === "macos_website_checkpoint") {
      requireFields(
        value,
        [
          "target_type",
          "website_domain",
          "label_source",
          "daily_usage_minutes",
          "continuous_usage_minutes",
          "continuous_usage_is_estimated",
          "full_url_included",
          "page_title_included"
        ],
        context
      );
      requireLiteral(
        value.continuous_usage_is_estimated,
        false,
        "continuous_usage_is_estimated",
        context
      );
      compareUsage(
        value.continuous_usage_minutes,
        value.daily_usage_minutes,
        "continuous_usage_minutes",
        context
      );
      if (
        value.label_source === "user" &&
        value.user_provided_context_label == null
      ) {
        context.addIssue({
          code: "custom",
          path: ["user_provided_context_label"],
          message: "a user-supplied website label is required"
        });
      }
      if (
        value.label_source === "domain" &&
        value.user_provided_context_label != null
      ) {
        context.addIssue({
          code: "custom",
          path: ["user_provided_context_label"],
          message: "a domain-labelled website must not include a user label"
        });
      }
      forbidFields(
        value,
        [
          "daily_app_usage_minutes",
          "estimated_continuous_app_usage_minutes",
          "continuous_app_usage_minutes",
          "raw_app_names_included"
        ],
        context
      );
    } else {
      requireFields(
        value,
        ["continuous_screen_minutes", "raw_app_names_included"],
        context
      );
    }
    if (!hasCurrent && !hasLegacy) {
      context.addIssue({
        code: "custom",
        path: ["continuous_screen_minutes"],
        message: "a current or legacy usage format is required"
      });
    }
  });

function requireFields(
  value: Record<string, unknown>,
  fields: string[],
  context: z.core.$RefinementCtx<unknown>
): void {
  for (const field of fields) {
    if (value[field] === undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is required for this usage format`
      });
    }
  }
}

function requireLiteral(
  value: unknown,
  expected: boolean,
  field: string,
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value !== undefined && value !== expected) {
    context.addIssue({
      code: "custom",
      path: [field],
      message: `${field} must be ${String(expected)} for this usage format`
    });
  }
}

function requireUserLabel(
  value: string | null | undefined,
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value == null) {
    context.addIssue({
      code: "custom",
      path: ["user_provided_context_label"],
      message: "a user-provided context label is required"
    });
  }
}

function forbidFields(
  value: Record<string, unknown>,
  fields: string[],
  context: z.core.$RefinementCtx<unknown>
): void {
  for (const field of fields) {
    if (value[field] !== undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} does not belong to this usage format`
      });
    }
  }
}

function compareUsage(
  continuous: number | undefined,
  daily: number | undefined,
  field: string,
  context: z.core.$RefinementCtx<unknown>
): void {
  if (
    continuous !== undefined &&
    daily !== undefined &&
    continuous > daily
  ) {
    context.addIssue({
      code: "custom",
      path: [field],
      message: "continuous usage cannot exceed daily usage"
    });
  }
}

export const restSuggestionReasonCodeSchema = z.enum([
  "long_continuous_use",
  "attention_fragmentation",
  "late_hour",
  "low_energy",
  "manual",
  "cooldown",
  "insufficient_signal"
]);

export const restSuggestionActionSchema = z.enum([
  "start_rest_session",
  "open_check_in",
  "remind_later",
  "dismiss"
]);

export const restSuggestionSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    should_offer_rest: z.boolean(),
    reason_code: restSuggestionReasonCodeSchema,
    message: z.string().max(240),
    default_quest_id: z.string().nullable().optional(),
    actions: z.array(restSuggestionActionSchema)
  })
  .strict();

export const fatigueCheckInSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    session_id: z.string().min(1),
    source: z.enum([
      "manual_ios",
      "manual_macos",
      "photon_message",
      "notification",
      "debug"
    ]),
    description: z.string().min(1).max(500),
    input_mode: z.enum(["text", "voice", "quick_tag"]),
    available_minutes: z.number().int().min(1).max(10),
    willing_to_move: z.boolean().nullable().optional(),
    current_place: z.string().max(80).nullable().optional(),
    follow_up_answer: z.string().max(100).nullable().optional()
  })
  .strict();

export const fatigueReflectionSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    fatigue_type: fatigueTypeSchema,
    reflection: z.string().min(1).max(300),
    needs_follow_up: z.boolean(),
    follow_up: z
      .object({
        question: z.string().max(160),
        options: z.array(z.string().max(30)).min(2).max(3)
      })
      .strict()
      .nullable()
      .optional(),
    safety_notice: z.string().max(300).nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.needs_follow_up && !value.follow_up) {
      context.addIssue({
        code: "custom",
        path: ["follow_up"],
        message: "follow_up is required when needs_follow_up is true"
      });
    }
    if (!value.needs_follow_up && value.follow_up) {
      context.addIssue({
        code: "custom",
        path: ["follow_up"],
        message: "follow_up must be null when needs_follow_up is false"
      });
    }
  });

export const restQuestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    content_version: z.string().min(1),
    title: z.string().max(80),
    fatigue_types: z.array(fatigueTypeSchema).min(1),
    duration_seconds: z.number().int().min(20).max(600),
    energy_required: z.enum(["very_low", "low", "medium"]),
    location_tags: z.array(z.string()),
    time_tags: z.array(z.enum(["day", "evening", "bedtime", "any"])),
    steps: z.array(z.string().max(120)).min(1).max(4),
    requires_screen: z.boolean(),
    safety_note: z.string().max(200).nullable().optional(),
    anchor_compatible: z.boolean().optional().default(false)
  })
  .strict();

export const restRecommendationRequestSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    session_id: z.string().min(1),
    content_version: z.string().min(1),
    fatigue_type: fatigueTypeSchema,
    user_preference: z
      .enum(["quiet", "move", "surprise"])
      .nullable()
      .optional(),
    available_minutes: z.number().int().min(1).max(10),
    source: z.string().min(1),
    location_tags: z.array(z.string()).optional().default([]),
    excluded_quest_ids: z.array(z.string()).optional().default([]),
    allowed_quest_ids: z.array(z.string()).optional().default([])
  })
  .strict();

export const restQuestRecommendationSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    content_version: z.string().min(1),
    quest_id: z.string().min(1),
    reason_code: z.string().min(1),
    intro: z.string().max(200).nullable().optional(),
    fallback_quest_id: z.string().nullable().optional()
  })
  .strict();

export const restFeedbackSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    session_id: z.string().min(1),
    quest_id: z.string().min(1),
    helpfulness: z.enum(["helped", "no_change", "interrupted"]),
    timing: z.enum(["too_early", "right", "too_late", "manual_not_applicable"]),
    recorded_at: z.iso.datetime({ offset: true }),
    notes: z.string().max(300).nullable().optional()
  })
  .strict();

export const handoffStartRequestSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    source: z.enum(["ios_app", "macos_app", "photon_message", "debug"]),
    include_gmail: z.boolean(),
    gmail_account_id: z.string().nullable().optional(),
    open_loops: z
      .array(
        z
          .object({
            id: z.string().min(1),
            text: z.string().min(1).max(500),
            desired_time: z
              .enum(["tomorrow_morning", "tomorrow", "later"])
              .nullable()
              .optional()
          })
          .strict()
      )
      .max(10),
    response_channel: z.enum(["app", "imessage"]),
    timezone: z.string().min(1),
    locale: z.string().default("zh-CN")
  })
  .strict();

export const mailSummaryItemSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    subject: z.string(),
    gist: z.string(),
    priority_reason: z.string(),
    draft_saved: z.boolean()
  })
  .strict();

export const draftSummarySchema = z
  .object({
    for_item_id: z.string(),
    preview: z.string(),
    saved: z.boolean(),
    gmail_draft_id: z.string().nullable().optional()
  })
  .strict();

export const pauseReceiptSchema = z
  .object({
    coverage: z
      .object({
        included_sources: z.array(z.string()),
        excluded_sources: z.array(z.string()),
        since: z.iso.datetime({ offset: true })
      })
      .strict(),
    held_items: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          status: z.enum([
            "gmail_draft_saved",
            "saved_for_tomorrow",
            "needs_review",
            "not_saved"
          ])
        })
        .strict()
    ),
    tomorrow_first_step: z.string().max(300).nullable().optional(),
    conclusion: z.string().max(400),
    coverage_note: z.string().max(300).nullable().optional()
  })
  .strict();

export const handoffSummarySchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    job_id: z.string().min(1),
    total_unread: z.number().int().min(0),
    tonight_required: z.array(mailSummaryItemSchema),
    tomorrow: z.array(mailSummaryItemSchema),
    no_action_count: z.number().int().min(0),
    uncertain: z.array(mailSummaryItemSchema),
    drafts: z.array(draftSummarySchema),
    pause_receipt: pauseReceiptSchema
  })
  .strict();

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "CONTRACT_VERSION_UNSUPPORTED",
  "CONTENT_VERSION_MISMATCH",
  "LLM_TIMEOUT",
  "LLM_INVALID_OUTPUT",
  "GMAIL_NOT_CONNECTED",
  "GMAIL_UNAVAILABLE",
  "GMAIL_RATE_LIMITED",
  "GMAIL_DRAFT_FAILED",
  "PHOTON_UNAVAILABLE",
  "PHOTON_SIGNATURE_INVALID",
  "JOB_NOT_FOUND",
  "JOB_FAILED",
  "DEMO_MODE_DISABLED",
  "INTERNAL_ERROR"
]);

export const errorResponseSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean(),
        fallback: z.string().nullable().optional(),
        details: z.record(z.string(), z.unknown()).nullable().optional()
      })
      .strict()
  })
  .strict();

export const handoffJobSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    job_id: z.string().min(1),
    status: z.enum(["queued", "running"]),
    estimated_wait_seconds: z.number().int().min(0),
    micro_reset_available: z.boolean()
  })
  .strict();

export const handoffJobStateSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    job_id: z.string().min(1),
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    progress_stage: z.enum([
      "queued",
      "fetching_mail",
      "classifying",
      "creating_drafts",
      "preparing_receipt",
      "completed",
      "failed",
      "cancelled"
    ]),
    estimated_wait_seconds: z.number().int().min(0).nullable().optional(),
    summary: handoffSummarySchema.nullable().optional(),
    error: errorResponseSchema.nullable().optional()
  })
  .strict();

export type UsageSummary = z.infer<typeof usageSummarySchema>;
export type RestSuggestion = z.infer<typeof restSuggestionSchema>;
export type FatigueCheckIn = z.infer<typeof fatigueCheckInSchema>;
export type FatigueReflection = z.infer<typeof fatigueReflectionSchema>;
export type FatigueType = z.infer<typeof fatigueTypeSchema>;
export type RestQuest = z.infer<typeof restQuestSchema>;
export type RestRecommendationRequest = z.infer<
  typeof restRecommendationRequestSchema
>;
export type RestQuestRecommendation = z.infer<
  typeof restQuestRecommendationSchema
>;
export type RestFeedback = z.infer<typeof restFeedbackSchema>;
export type HandoffStartRequest = z.infer<typeof handoffStartRequestSchema>;
export type PauseReceipt = z.infer<typeof pauseReceiptSchema>;
export type HandoffSummary = z.infer<typeof handoffSummarySchema>;
export type HandoffJob = z.infer<typeof handoffJobSchema>;
export type HandoffJobState = z.infer<typeof handoffJobStateSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;

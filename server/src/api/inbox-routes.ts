import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";
import type { InboxService } from "../application/inbox/inbox-service.js";
import {
  inboxDraftPatchSchema,
  inboxEventBatchSchema,
  inboxSendRequestSchema
} from "../domain/contracts.js";

export interface InboxRouteContext {
  requestId: string;
  inbox: InboxService;
}

export interface InboxRouteHelpers {
  context(
    request: FastifyRequest,
    reply: FastifyReply,
    hasBody: boolean
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
    const context = helpers.context(request, reply, true);
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
    const context = helpers.context(request, reply, false);
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
    const context = helpers.context(request, reply, false);
    return context.inbox.getItem(request.params.itemId);
  });

  server.post<{
    Params: { itemId: string };
  }>("/v1/inbox/items/:itemId/summary", async (request, reply) => {
    const context = helpers.context(request, reply, false);
    return context.inbox.summarize(request.params.itemId);
  });

  server.post<{
    Params: { itemId: string };
  }>("/v1/inbox/items/:itemId/draft", async (request, reply) => {
    const context = helpers.context(request, reply, false);
    return context.inbox.createDraft(request.params.itemId);
  });

  server.get<{
    Params: { draftId: string };
  }>("/v1/inbox/drafts/:draftId", async (request, reply) => {
    const context = helpers.context(request, reply, false);
    return context.inbox.getDraft(request.params.draftId);
  });

  server.patch<{
    Params: { draftId: string };
  }>("/v1/inbox/drafts/:draftId", async (request, reply) => {
    const context = helpers.context(request, reply, true);
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
      const context = helpers.context(request, reply, false);
      const confirmation = await context.inbox.issueConfirmation(
        request.params.draftId
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
    const context = helpers.context(request, reply, true);
    const idempotencyKey =
      helpers.requiredIdempotencyKey(request);
    const input = inboxSendRequestSchema.parse(request.body);
    helpers.assertBodyRequestId(input.request_id, context.requestId);
    return context.inbox.sendDraft(request.params.draftId, {
      expectedVersion: input.expected_version,
      confirmationToken: input.confirmation_token,
      idempotencyKey
    });
    }
  );

  server.get("/v1/inbox/sync-status", async (request, reply) => {
    const context = helpers.context(request, reply, false);
    return context.inbox.syncStatus();
  });
}

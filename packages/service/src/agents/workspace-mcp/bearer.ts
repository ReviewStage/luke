import { createHash } from "node:crypto";
import {
  type AgentStoreEffect,
  readRunnerTokenConversation,
} from "@repo/database/models/agent-store";
import { Effect, Option } from "effect";
import type { AdmittedConversation } from "../eve-host/conversation.js";

export const BEARER_PREFIX = "Bearer ";

export function runnerTokenDigest(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

export function presentedBearer(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith(BEARER_PREFIX)) return undefined;
  const bearer = authorization.slice(BEARER_PREFIX.length).trim();
  return bearer.length > 0 ? bearer : undefined;
}

export function admitRunnerBearer(
  bearer: string,
): AgentStoreEffect<Option.Option<AdmittedConversation>> {
  return Effect.map(
    readRunnerTokenConversation(runnerTokenDigest(bearer)),
    Option.map(
      (row): AdmittedConversation => ({
        caller: row.userId,
        target: { userId: row.userId, conversationId: row.conversationId },
        runtimeSessionId: row.runtimeSessionId ?? undefined,
        timeZone: undefined,
      }),
    ),
  );
}

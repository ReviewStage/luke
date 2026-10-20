/**
 * bearer.ts -- the runner's bearer at Luke's MCP server: kept as its digest, and admitting the conversation the digest names.
 *
 * A native harness's runner is handed one bearer for its agent's session,
 * which it presents as `Authorization: Bearer` on every call to the server.
 * The store keeps its SHA-256 alone (`conversations.runner_token_hash`), so a
 * read of the row cannot be replayed as the bearer. A bearer whose digest no
 * standing conversation holds, a retired one's among them, admits nothing.
 */

import { createHash } from "node:crypto";
import {
  type CodingAgentStoreEffect,
  readRunnerTokenConversation,
} from "@luke/database/models/coding-agent-store";
import { Effect, Option } from "effect";
import type { AdmittedConversation } from "../brain-host/conversation.js";

/** What a bearer header leads with before the bearer. */
const BEARER_PREFIX = "Bearer ";

/** The digest the store keeps of a runner's bearer: its SHA-256, in hex. */
export function runnerTokenDigest(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

/** The bearer a request presents; nothing where it presents none, or an empty one. */
export function presentedBearer(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith(BEARER_PREFIX)) return undefined;
  const bearer = authorization.slice(BEARER_PREFIX.length).trim();
  return bearer.length > 0 ? bearer : undefined;
}

/**
 * The agent's conversation the bearer stands for, admitted as its starter:
 * the account that opened it is the caller, so the tools run as the
 * developer who started the agent, with its conversation's context; nothing
 * for a bearer no standing conversation holds.
 */
export function admitRunnerBearer(
  bearer: string,
): CodingAgentStoreEffect<Option.Option<AdmittedConversation>> {
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

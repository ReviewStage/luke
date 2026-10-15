/**
 * servers.ts -- which integrations' MCP servers one turn of an agent is handed, read as the turn starts.
 *
 * Every agent is handed its account's integrations through one dynamic
 * connection resolved at `turn.started` (`connections.ts`), and what it is
 * handed is its role's connection policy (`role.ts`), among the
 * integrations this deployment offers the account
 * (`accountIntegrationConnect`): one not set up here, or withheld from the
 * account, is handed to none of its agents. The planning agents are handed
 * every one offered. A coding agent is handed every one but those the
 * developer switched off for it from its composer, which writes
 * the agent's `disabled_servers` (`coding-agent-store.ts`); its worker's
 * session is admitted for its parent's conversation, so it follows its
 * parent agent's switches. A server the developer mentioned in a message to
 * a coding agent (`@Linear`) is handed to the next turn the agent starts
 * whatever its switch says, and to that turn alone: the turn takes the
 * mentions from the row as it reads its standing, and the switch is never
 * written. A worker takes none. A turn already running keeps what it was
 * handed, and eve tells the model at its next step when a connection came or
 * went.
 *
 * The read fails closed: a turn whose admission or row could not be read is
 * handed no server, so one the developer switched off never comes back on
 * through a passing store failure, and the turn carries on without it. A
 * resolver that threw would fail the whole turn instead, which is why
 * nothing here throws. The log line keeps the failure's kind alone, since a
 * store failure's message may name a statement.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  readCodingAgentOfConversation,
  takeCodingAgentMentionedServers,
} from "@luke/database/models/coding-agent-store";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@luke/features/integration-wire";
import { causeKind } from "@luke/runtime/effect";
import type { GitHubApp } from "@luke/service/github/github-app";
import {
  accountIntegrationConnect,
  type IntegrationConnect,
} from "@luke/service/integrations/integration-connect";
import { Effect, Option, Result, type Schema } from "effect";
import type { SessionAuth } from "eve/context";
import type { ConversationAdmission } from "../brain-host/conversation.js";
import { githubOffered } from "../github-integration.js";
import { CONNECTION_POLICY, type ConnectionPolicy } from "./role.js";

/** Which servers a turn is handed, under the account they are credentialed for, or none. */
export type ServerStanding =
  | {
      readonly on: true;
      readonly account: string;
      readonly providers: readonly IntegrationProvider[];
    }
  | { readonly on: false };

const SERVERS_OFF: ServerStanding = { on: false };

/** How the session a turn runs in is admitted: a root's own standing, or a worker's ownership alone. */
type ServerAdmission = Effect.Effect<
  ConversationAdmission,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** How an agent's edge reads the standing for one session: its own admission and policy, run where the edge runs effects. */
export type ServerStandingRead = (auth: SessionAuth, sessionId: string) => Promise<ServerStanding>;

/**
 * The servers mentioned since the agent's last turn started, taken by the
 * turn starting now; none where the policy takes none. Note that a take
 * that failed hands only what the switches say rather than failing the
 * standing, so a passing store failure costs the turn a mention, never
 * every server.
 */
function takenMentions(
  policy: ConnectionPolicy,
  userId: string,
  conversationId: string,
): Effect.Effect<readonly IntegrationProvider[], never, DatabaseServices> {
  if (policy !== CONNECTION_POLICY.AGENT_SWITCHES_AND_MENTIONS) return Effect.succeed([]);
  return takeCodingAgentMentionedServers(userId, conversationId).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `the turn took no mentioned server, its mentions unread: ${causeKind(cause)}`,
        ),
        [],
      ),
    ),
  );
}

/**
 * The servers the turn starting is handed under the policy, among those
 * offered to the account: every one for a session admitted at all, and for
 * a coding agent every one its row does not list, and every one mentioned
 * since its last turn where the policy takes mentions; none for a session
 * the host does not admit, one admitted for no agent where the policy reads
 * an agent's switches, or a read that failed.
 */
export function turnServers(
  admission: ServerAdmission,
  policy: ConnectionPolicy,
): Effect.Effect<ServerStanding, never, DatabaseServices | IntegrationConnect | GitHubApp> {
  return Effect.gen(function* () {
    const admitted = yield* admission;
    if (Result.isFailure(admitted)) return SERVERS_OFF;
    const { userId, conversationId } = admitted.success.target;
    const connect = yield* accountIntegrationConnect(userId);
    const github = yield* githubOffered;
    // A provider the account's GitHub sign-in grants is offered wherever the GitHub App is.
    const offered = INTEGRATION_PROVIDER_LIST.filter((provider) =>
      INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
        ? github
        : connect[provider].configured,
    );
    if (policy === CONNECTION_POLICY.ALWAYS_ON) {
      return { on: true, account: userId, providers: offered } as const;
    }
    const agent = yield* readCodingAgentOfConversation(userId, conversationId);
    if (Option.isNone(agent)) return SERVERS_OFF;
    const { disabledServers } = agent.value;
    const mentioned = yield* takenMentions(policy, userId, conversationId);
    const providers = offered.filter(
      (provider) => !disabledServers.includes(provider) || mentioned.includes(provider),
    );
    return { on: true, account: userId, providers } as const;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `the turn was handed no server, its standing unread: ${causeKind(cause)}`,
        ),
        SERVERS_OFF,
      ),
    ),
  );
}

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
 * parent agent's switches. A turn already running keeps what it was handed,
 * and eve tells the model at its next step when a connection came or went.
 *
 * The read fails closed: a turn whose admission or row could not be read is
 * handed no server, so one the developer switched off never comes back on
 * through a passing store failure, and the turn carries on without it. A
 * resolver that threw would fail the whole turn instead, which is why
 * nothing here throws. The log line keeps the failure's kind alone, since a
 * store failure's message may name a statement.
 */

import type { DatabaseServices, QueryError } from "@sidecar/database/core/query";
import { readCodingAgentOfConversation } from "@sidecar/database/models/coding-agent-store";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@sidecar/features/integration-wire";
import { causeKind } from "@sidecar/runtime/effect";
import { Effect, Option, Result, type Schema } from "effect";
import type { SessionAuth } from "eve/context";
import type { GitHubApp } from "../../github/github-app.js";
import type { ConversationAdmission } from "../brain-host/conversation.js";
import { githubOffered } from "../github-integration.js";
import { accountIntegrationConnect, type IntegrationConnect } from "../integration-connect.js";
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
 * The servers the turn starting is handed under the policy, among those
 * offered to the account: every one for a session admitted at all, and for
 * a coding agent every one its row does not list; none for a session the
 * host does not admit, one admitted for no agent where the policy reads an
 * agent's switches, or a read that failed.
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
    const providers = offered.filter((provider) => !disabledServers.includes(provider));
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

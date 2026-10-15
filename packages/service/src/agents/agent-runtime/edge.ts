/**
 * edge.ts -- the doors an eve root opens onto the agent runtime, built once for both roots over the root's own runner.
 *
 * eve drives a root's authored files through promise-shaped hooks, so each
 * root's `host.ts` is a runtime edge and holds the doors those files call.
 * The planning root (`apps/luke/host.ts`) and the coding root (`apps/dev/host.ts`)
 * open the same three: a role's integrations, the skills a session starts
 * with, and a child session's relay. They differ by the role's profile
 * (`role.ts`) and by the two small facts a root hands in (`EdgeRoot`), so
 * the doors are built here and each root's are one call.
 *
 * Nothing here runs an effect. The root hands in its own runner, which is
 * `runAgent` in production, as `productionBrainHostSeams` is handed one.
 */

import type { QueryError } from "@luke/database/core/query";
import { Effect, Result, type Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import {
  type IntegrationAdmission,
  integrationAccessToken,
} from "../../integrations/integration-connection.js";
import type { WebAgentRun, WebAgentServices } from "../../run.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import type { RelayStateStore } from "../brain-host/relay.js";
import { integrationConnections } from "./connections.js";
import { type AgentRole, ROLE_PROFILE } from "./role.js";
import { turnServers } from "./servers.js";
import type { AgentSkill } from "./skills.js";

/** How a door's read fails before the runner rejects with it. */
type EdgeFailure = QueryError | Schema.SchemaError;

/** What the doors need of a root's host: its admissions and its child relay, which both hosts carry alike. */
interface EdgeHost {
  readonly admit: (auth: SessionAuth, sessionId: string) => IntegrationAdmission;
  readonly admitStarting: (auth: SessionAuth, sessionId: string) => IntegrationAdmission;
  readonly admitDelegated: (auth: SessionAuth, sessionId: string) => IntegrationAdmission;
  readonly relayChild: (
    event: MessageStreamEvent,
    session: SessionContext["session"],
    state: RelayStateStore,
  ) => Effect.Effect<void, EdgeFailure, WebAgentServices>;
}

/** One root as its doors are built over it: its host, and the two facts the roots differ by. */
export interface EdgeRoot {
  readonly host: EdgeHost;
  /** The skills a session admitted as it starts is offered. */
  readonly skills: (
    admitted: AdmittedConversation,
  ) => Effect.Effect<readonly AgentSkill[], EdgeFailure, WebAgentServices>;
  /** What a child session's task wakes once relayed, on a fiber of its own; absent where it wakes nothing. */
  readonly childTasked?: (
    session: SessionContext["session"],
  ) => Effect.Effect<void, EdgeFailure, WebAgentServices>;
}

/** The doors one root's authored files call, each run on the root's runner. */
export interface EdgeKit {
  /** Every integration the role's agent is handed, for its own `connections/integrations.ts`. */
  integrationConnections(role: AgentRole): ReturnType<typeof integrationConnections>;
  /** The skills the role's session is offered as it starts, for the root's `skills/repository.ts`. */
  sessionSkills(
    role: AgentRole,
    auth: SessionAuth,
    sessionId: string,
  ): Promise<readonly AgentSkill[]>;
  /** One event of a child session relayed into its child conversation, for the worker's own hook. */
  relayChildEvent(
    event: MessageStreamEvent,
    session: SessionContext["session"],
    state: RelayStateStore,
  ): Promise<void>;
}

/**
 * The doors over one root. A role's reads run under the admission its
 * profile names: a worker's on ownership alone (`admitDelegated`), since eve
 * hands a resolver no lineage, and a root's on its own standing. A session
 * the host does not admit is handed no server, no token, and no skill. Note
 * that a child's `childTasked` fiber outlives the hook that relayed its
 * task, so the worker's turn is not held for it.
 */
export function edgeKit(run: WebAgentRun, root: EdgeRoot): EdgeKit {
  const { host } = root;
  const admissionOf = (role: AgentRole) =>
    ROLE_PROFILE[role].delegated ? host.admitDelegated : host.admit;
  return {
    integrationConnections(role) {
      const admit = admissionOf(role);
      const policy = ROLE_PROFILE[role].connections;
      return integrationConnections({
        servers: (auth, sessionId) => run(turnServers(admit(auth, sessionId), policy)),
        token: (account) => (auth, sessionId) =>
          run(integrationAccessToken(account, admit(auth, sessionId))),
      });
    },
    sessionSkills(role, auth, sessionId) {
      if (!ROLE_PROFILE[role].skills) return Promise.resolve([]);
      return run(
        Effect.gen(function* () {
          const admitted = yield* host.admitStarting(auth, sessionId);
          if (Result.isFailure(admitted)) return [];
          return yield* root.skills(admitted.success);
        }),
      );
    },
    relayChildEvent(event, session, state) {
      const { childTasked } = root;
      return run(
        Effect.gen(function* () {
          yield* host.relayChild(event, session, state);
          if (childTasked !== undefined && event.type === "message.received") {
            yield* Effect.forkDetach(childTasked(session));
          }
        }),
      );
    },
  };
}

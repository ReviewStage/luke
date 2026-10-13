import { Effect } from "effect";
import { integrationConnections } from "../server/hosted/agent-runtime/connections.js";
import { type AGENT_ROLE, ROLE_PROFILE } from "../server/hosted/agent-runtime/role.js";
import { turnServers } from "../server/hosted/agent-runtime/servers.js";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host.js";
import {
  type BrainHostSeams,
  productionBrainHostSeams,
} from "../server/hosted/brain-host/production.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
import { integrationAccessToken } from "../server/hosted/integration-connection.js";
import { runWeb } from "../server/runtime.js";

/**
 * The one host every authored file of this eve project shares, over the
 * deployment's seams. The seams are composed here, once, over the same
 * `HostedEnvironment` layer the web runtime builds, and run synchronously
 * because eve loads the authored files as modules and the channel's door
 * takes the deployment's secret as a value: the environment read is a
 * `Config` over `process.env`, which suspends on nothing, so the run
 * completes as the module does. The edge's own runner is handed down too:
 * the seams whose readers hold a promise — eve's door, the model
 * middleware's meter — run on it, so nothing under `server/hosted/` keeps a
 * runner of its own.
 */
export const seams: BrainHostSeams = Effect.runSync(
  Effect.provide(productionBrainHostSeams(runWeb), hostedEnvironment),
);

export const host: BrainHost = brainHost(seams);

/**
 * Relays one event of a subagent's session into its child conversation, for
 * the subagent's own hook, which runs here rather than at an edge of its own.
 * Each task the subagent receives wakes its title on a fiber of its own once
 * relayed, so its turn is not held for it; the title always names the first
 * task the subagent received, and only the first title that lands stands.
 */
export function relayChildEvent(
  event: Parameters<BrainHost["relayChild"]>[0],
  session: Parameters<BrainHost["relayChild"]>[1],
  state: Parameters<BrainHost["relayChild"]>[2],
): Promise<void> {
  return runWeb(
    Effect.gen(function* () {
      yield* host.relayChild(event, session, state);
      // The fiber outlives this hook and ends on its own, as a coding agent's title's does.
      if (event.type === "message.received") {
        yield* Effect.forkDetach(host.titleChild(session));
      }
    }),
  );
}

/**
 * Every integration one of this project's agents is handed, for that
 * agent's own `connections/integrations.ts`: the standing and the token
 * reads run here, at the edge, under the check that agent's model runs
 * under too, and the role's policy decides the servers
 * (`server/hosted/agent-runtime/servers.ts`).
 */
export function integrationConnectionsFor(
  role: typeof AGENT_ROLE.PLANNER | typeof AGENT_ROLE.PLANNER_WORKER,
) {
  const profile = ROLE_PROFILE[role];
  const admit = profile.delegated ? host.admitDelegated : host.admit;
  return integrationConnections({
    servers: (auth, sessionId) => runWeb(turnServers(admit(auth, sessionId), profile.connections)),
    token: (provider) => (auth, sessionId) =>
      runWeb(integrationAccessToken(provider, admit(auth, sessionId))),
  });
}

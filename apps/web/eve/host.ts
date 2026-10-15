import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { Effect } from "effect";
import type { SessionAuth } from "eve/context";
import { edgeKit } from "../server/hosted/agent-runtime/edge.js";
import type { AgentSkill } from "../server/hosted/agent-runtime/skills.js";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host.js";
import {
  type BrainHostSeams,
  productionBrainHostSeams,
} from "../server/hosted/brain-host/production.js";
import { hostedEnvironment } from "../server/hosted/environment.js";
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
 * The doors this project's authored files open onto the agent runtime
 * (`server/hosted/agent-runtime/edge.ts`), run here on the edge's runner.
 * Each task a subagent receives wakes its title on a fiber of its own once
 * relayed, so its turn is not held for it; the title always names the
 * first task the subagent received, and only the first title that lands
 * stands.
 */
const edge = edgeKit(runWeb, { host, skills: host.skills, childTasked: host.titleChild });

/** Relays one event of a subagent's session into its child conversation, for the subagent's own hook. */
export function relayChildEvent(
  event: Parameters<BrainHost["relayChild"]>[0],
  session: Parameters<BrainHost["relayChild"]>[1],
  state: Parameters<BrainHost["relayChild"]>[2],
): Promise<void> {
  return edge.relayChildEvent(event, session, state);
}

/**
 * The skills the planning session is offered as it starts, for the
 * project's own `skills/repository.ts`: the ones the plan's repository
 * keeps, or none for a session the host does not admit.
 */
export function sessionSkills(
  auth: SessionAuth,
  sessionId: string,
): Promise<readonly AgentSkill[]> {
  return edge.sessionSkills(AGENT_ROLE.PLANNER, auth, sessionId);
}

/** Every integration one of this project's agents is handed, for that agent's own `connections/integrations.ts`. */
export function integrationConnectionsFor(
  role: typeof AGENT_ROLE.PLANNER | typeof AGENT_ROLE.PLANNER_WORKER,
) {
  return edge.integrationConnections(role);
}

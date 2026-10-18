import { edgeKit } from "@luke/service/agents/agent-runtime/edge";
import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import type { AgentSkill } from "@luke/service/agents/agent-runtime/skills";
import { type BrainHost, brainHost } from "@luke/service/agents/brain-host/host";
import {
  type BrainHostSeams,
  productionBrainHostSeams,
} from "@luke/service/agents/brain-host/production";
import { hostedEnvironment } from "@luke/service/environment";
import { Effect } from "effect";
import type { SessionAuth } from "eve/context";
import { runAgent } from "./runtime.js";

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
  Effect.provide(productionBrainHostSeams(runAgent), hostedEnvironment),
);

export const host: BrainHost = brainHost(seams);

/**
 * The doors this project's authored files open onto the agent runtime
 * (`packages/service/src/agents/agent-runtime/edge.ts`), run here on the edge's runner.
 * Each task a subagent receives wakes its title on a fiber of its own once
 * relayed, so its turn is not held for it; the title always names the
 * first task the subagent received, and only the first title that lands
 * stands.
 */
const edge = edgeKit(runAgent, { host, skills: host.skills, childTasked: host.titleChild });

/** Relays one event of a subagent's session into its child conversation, for the subagent's own hook. */
export function relayChildEvent(
  event: Parameters<BrainHost["relayChild"]>[0],
  session: Parameters<BrainHost["relayChild"]>[1],
  state: Parameters<BrainHost["relayChild"]>[2],
): Promise<void> {
  return edge.relayChildEvent(event, session, state);
}

/**
 * The skills the brain's session is offered as it starts, for the
 * project's own `skills/repository.ts`: the ones the task's repository
 * keeps, or none for a session the host does not admit.
 */
export function sessionSkills(
  auth: SessionAuth,
  sessionId: string,
): Promise<readonly AgentSkill[]> {
  return edge.sessionSkills(AGENT_ROLE.BRAIN, auth, sessionId);
}

/** Every integration one of this project's agents is handed, for that agent's own `connections/integrations.ts`. */
export function integrationConnectionsFor(
  role: typeof AGENT_ROLE.BRAIN | typeof AGENT_ROLE.BRAIN_WORKER,
) {
  return edge.integrationConnections(role);
}

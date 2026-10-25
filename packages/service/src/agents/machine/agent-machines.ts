/**
 * agent-machines.ts -- the two agent machines behind one: each call answered by the machine its agent's row names, Vercel Sandbox or the starter's Mac.
 *
 * A call that holds an agent asks the machine its row names
 * (`coding_agent.machine`), and one that holds a place or a runner asks the
 * machine that place names. A call that holds a session alone, as a door
 * and a later call's find do, asks the Mac first whether the session is a
 * local agent's, and Vercel Sandbox otherwise, so a sandbox's session costs
 * one read of the store before its own call.
 *
 * The deployment composes it once for the native harnesses and the doors
 * (`agentMachinesLayer`), and a launch's end and the sweep's retire, which
 * hold no edge's runner for a checkout, compose its lifecycle alone
 * (`deploymentLifecycle`).
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { CodingAgentMachine } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import {
  deploymentOidcToken,
  type SandboxUnavailable,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { AgentMachine, type AgentMachineService, type MachineLifecycle } from "./agent-machine.js";
import { type MacMachineService, macMachine } from "./mac-machine.js";
import { type VercelMachineOptions, vercelLifecycle, vercelMachine } from "./vercel-machine.js";

/** The lifecycle of whichever machine answers for the session, or for the place or runner named. */
function routedLifecycle(cloud: MachineLifecycle, mac: MacMachineService): MachineLifecycle {
  const of = (machine: CodingAgentMachine): MachineLifecycle =>
    machine === CODING_AGENT_MACHINE.MAC ? mac : cloud;
  const bySession = <A>(
    session: string,
    call: (machine: MachineLifecycle) => Effect.Effect<A, SandboxUnavailable>,
  ) => Effect.flatMap(mac.owns(session), (owned) => call(owned ? mac : cloud));
  return {
    findPlaces: (session) => bySession(session, (machine) => machine.findPlaces(session)),
    recordRunner: (place, record) => of(place.machine).recordRunner(place, record),
    setCredential: (place, credential) => of(place.machine).setCredential(place, credential),
    resume: (found) => of(found.machine).resume(found),
    stop: (place) => of(place.machine).stop(place),
    discard: (found) => of(found.machine).discard(found),
    writeFiles: (place, files) => of(place.machine).writeFiles(place, files),
    writeLine: (handle, text) => of(handle.machine).writeLine(handle, text),
    runnerExit: (handle, within) => of(handle.machine).runnerExit(handle, within),
    kill: (handle) => of(handle.machine).kill(handle),
    readFile: (session, path, bound) =>
      bySession(session, (machine) => machine.readFile(session, path, bound)),
    runRepositoryCommand: (session, command) =>
      bySession(session, (machine) => machine.runRepositoryCommand(session, command)),
  };
}

/** Both machines behind one, as above. */
function routedMachine(cloud: AgentMachineService, mac: MacMachineService): AgentMachineService {
  const of = (machine: CodingAgentMachine | undefined): AgentMachineService =>
    machine === CODING_AGENT_MACHINE.MAC ? mac : cloud;
  return {
    ...routedLifecycle(cloud, mac),
    layout: (agent) => of(agent.machine).layout(agent),
    open: (ask, use) => of(ask.agent.machine).open(ask, use),
    launchRunner: (place, launch) => of(place.machine).launchRunner(place, launch),
  };
}

/** The deployment's machines' lifecycle, Vercel asked under the function's own OIDC token. */
export const deploymentLifecycle: Effect.Effect<
  MachineLifecycle,
  never,
  HttpClient.HttpClient | DatabaseServices
> = Effect.gen(function* () {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  return routedLifecycle(vercelLifecycle(api), yield* macMachine);
});

/** The deployment's machines behind one, Vercel asked under the token given and its checkout run through the edge's runner. */
export function agentMachinesLayer(
  options: VercelMachineOptions,
): Layer.Layer<AgentMachine, never, HttpClient.HttpClient | DatabaseServices> {
  return Layer.effect(
    AgentMachine,
    Effect.gen(function* () {
      const api = yield* vercelSandboxApi(options.readToken);
      return routedMachine(vercelMachine(api, options.run), yield* macMachine);
    }),
  );
}

import type { DatabaseServices } from "@repo/database/core/query";
import type { AgentMachineKind } from "@repo/features/agent-wire";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import { deploymentOidcToken, vercelSandboxApi } from "../vercel-sandbox-api.js";
import { AgentMachine, type AgentMachineService, type MachineLifecycle } from "./agent-machine.js";
import { type DeviceMachineService, deviceMachine } from "./device-machine.js";
import { type VercelMachineOptions, vercelLifecycle, vercelMachine } from "./vercel-machine.js";

function routedLifecycle(cloud: MachineLifecycle, mac: DeviceMachineService): MachineLifecycle {
  const of = (machine: AgentMachineKind): MachineLifecycle =>
    machine === AGENT_MACHINE.DEVICE ? mac : cloud;
  const bySession = <A, E, R>(
    session: string,
    call: (machine: MachineLifecycle) => Effect.Effect<A, E, R>,
  ) => Effect.flatMap(mac.owns(session), (owned) => call(owned ? mac : cloud));
  return {
    findPlaces: (userId, session) =>
      bySession(session, (machine) => machine.findPlaces(userId, session)),
    recordRunner: (place, record) => of(place.machine).recordRunner(place, record),
    firewall: {
      write: (place, userId, sources) => of(place.machine).firewall.write(place, userId, sources),
      keepLaunch: (place, userId, launch) =>
        of(place.machine).firewall.keepLaunch(place, userId, launch),
      endLaunch: (place, userId, sources) =>
        of(place.machine).firewall.endLaunch(place, userId, sources),
      clear: (place) => of(place.machine).firewall.clear(place),
    },
    resume: (found) => of(found.machine).resume(found),
    stop: (place) => of(place.machine).stop(place),
    discard: (found) => of(found.machine).discard(found),
    writeFiles: (place, files) => of(place.machine).writeFiles(place, files),
    writeLine: (handle, text) => of(handle.machine).writeLine(handle, text),
    wrote: (handle, text) => of(handle.machine).wrote(handle, text),
    runnerExit: (handle, within) => of(handle.machine).runnerExit(handle, within),
    kill: (handle) => of(handle.machine).kill(handle),
    readFile: (session, path, bound) =>
      bySession(session, (machine) => machine.readFile(session, path, bound)),
  };
}

function routedMachine(cloud: AgentMachineService, mac: DeviceMachineService): AgentMachineService {
  const of = (machine: AgentMachineKind | undefined): AgentMachineService =>
    machine === AGENT_MACHINE.DEVICE ? mac : cloud;
  return {
    ...routedLifecycle(cloud, mac),
    layout: (agent) => of(agent.machine).layout(agent),
    open: (ask, use) => of(ask.agent.machine).open(ask, use),
    checkOutExtras: (place, target, agent, shared) =>
      of(place.machine).checkOutExtras(place, target, agent, shared),
    launchRunner: (place, launch) => of(place.machine).launchRunner(place, launch),
  };
}

export const deploymentLifecycle: Effect.Effect<
  MachineLifecycle,
  never,
  HttpClient.HttpClient | DatabaseServices
> = Effect.gen(function* () {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  return routedLifecycle(vercelLifecycle(api), yield* deviceMachine);
});

export function agentMachinesLayer(
  options: VercelMachineOptions,
): Layer.Layer<AgentMachine, never, HttpClient.HttpClient | DatabaseServices> {
  return Layer.effect(
    AgentMachine,
    Effect.gen(function* () {
      const api = yield* vercelSandboxApi(options.readToken);
      return routedMachine(vercelMachine(api, options.run), yield* deviceMachine);
    }),
  );
}

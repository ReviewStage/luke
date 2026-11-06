import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { AgentMachine, type AgentMachineService } from "../machine/agent-machine.js";
import { SandboxUnavailable } from "../vercel-sandbox-api.js";

export const SANDBOX_DOOR_MAX_BYTES = 8 * 1024 * 1024;

export type SandboxDoorRunner<R = HttpClient.HttpClient> = <A, E>(
  effect: Effect.Effect<A, E, R>,
) => Promise<A>;

export interface AgentSandboxDoors {
  readonly files: InboxSandboxDoor;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function agentSandboxDoors<R>(
  run: SandboxDoorRunner<R>,
  machine: Layer.Layer<AgentMachine, never, R>,
): (admitted: AdmittedConversation) => AgentSandboxDoors {
  const ask = <A, E>(call: (machine: AgentMachineService) => Effect.Effect<A, E>) =>
    run(Effect.flatMap(AgentMachine, call).pipe(Effect.provide(machine)));
  return (admitted) => {
    const sessionId = admitted.runtimeSessionId;
    const unfound = () => Promise.reject(new SandboxUnavailable({}));
    if (sessionId === undefined) return { files: unfound };
    return {
      files: () =>
        Promise.resolve({
          readFile: async ({ path }: { readonly path: string }) => {
            const bytes = await ask((each) =>
              each.readFile(sessionId, path, SANDBOX_DOOR_MAX_BYTES),
            );
            return bytes === undefined ? null : streamOf(bytes);
          },
        }),
    };
  };
}

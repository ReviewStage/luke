/**
 * sandbox-door.ts -- the door to a native agent's sandbox a tool of Luke's MCP server reads a file through.
 *
 * eve hands each of its tools the session's sandbox (`ctx.getSandbox()`),
 * through which `post_to_inbox`, `post_chat`, `edit_plan`, `show_image`, and
 * `show_page` read a file the agent names by its path. A native harness runs
 * in a sandbox eve never opened, so the same door is made here, over the
 * agent's machine (`../machine/agent-machine.ts`): the place its session
 * runs in, and the one file asked for, read as the agent's own user, never
 * as root, so a path the model was talked into naming (the runner's
 * environment, a private home) reads as no file. Nothing is resumed: the
 * agent calling the tool runs in that place, so a place not up has nothing
 * to read from, and the read is unavailable.
 *
 * `show_code` runs its reads as commands rather than file reads, so the
 * same place is also handed as a repository's sandbox
 * (`../repository-shell.ts`): each command run there and waited on.
 *
 * Every door hands a file on as one stream, which the door's caller holds to
 * its own bound; the read stops one byte past the widest of those bounds, so
 * a file larger than any is refused as larger rather than read whole.
 */

import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import {
  AgentMachine,
  type AgentMachineService,
  type RepositoryCommand,
} from "../machine/agent-machine.js";
import type { RepositorySandboxDoor } from "../repository-shell.js";
import { SandboxUnavailable } from "../vercel-sandbox-api.js";

/** The most of one file a door reads: past every bound a tool holds a file to, a page's HTML and a kept picture among them. */
export const SANDBOX_DOOR_MAX_BYTES = 8 * 1024 * 1024;

/** How the edge runs the door's effects, on its own runtime. */
export type SandboxDoorRunner = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Promise<A>;

/** The doors to the admitted agent's sandbox: one to read a file through, and one to run a command in. */
export interface AgentSandboxDoors {
  readonly files: InboxSandboxDoor;
  readonly repository: RepositorySandboxDoor;
}

/** Bytes as the one-chunk stream a door's caller reads. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * The doors to the admitted agent's sandbox, their calls made of the agent's
 * machine the layer given provides and run on the runner given; a
 * conversation that records no session has no sandbox to find, and its
 * doors fail, which each tool answers as a sandbox it could not reach.
 */
export function agentSandboxDoors(
  run: SandboxDoorRunner,
  machine: Layer.Layer<AgentMachine, never, HttpClient.HttpClient>,
): (admitted: AdmittedConversation) => AgentSandboxDoors {
  /** One call of the agent's machine, run on the edge's runner. */
  const ask = <A, E>(call: (machine: AgentMachineService) => Effect.Effect<A, E>) =>
    run(Effect.flatMap(AgentMachine, call).pipe(Effect.provide(machine)));
  return (admitted) => {
    const sessionId = admitted.runtimeSessionId;
    const unfound = () => Promise.reject(new SandboxUnavailable({}));
    if (sessionId === undefined) return { files: unfound, repository: unfound };
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
      repository: () =>
        Promise.resolve({
          run: (command: RepositoryCommand) =>
            ask((each) => each.runRepositoryCommand(sessionId, command)),
        }),
    };
  };
}

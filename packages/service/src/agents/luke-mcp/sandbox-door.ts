/**
 * sandbox-door.ts -- the door to a native agent's sandbox a tool of Luke's MCP server reads a file through.
 *
 * eve hands each of its tools the session's sandbox (`ctx.getSandbox()`),
 * through which `post_to_inbox`, `post_chat`, `edit_plan`, `show_image`, and
 * `show_page` read a file the agent names by its path. A native harness runs
 * in a sandbox eve never opened, so the same door is made here, over the
 * calls Luke makes of Vercel Sandbox itself (`../vercel-sandbox-api.ts`):
 * the sandbox carrying the agent's session id as its tag, as every agent's
 * sandbox does, and the one file asked for, read from its running session.
 * Nothing is resumed: the agent calling the tool runs in that sandbox, so a
 * sandbox not up has nothing to read from, and the read is unavailable.
 *
 * `show_code` runs its reads as commands rather than file reads, so the
 * same sandbox is also handed as a repository's sandbox
 * (`../repository-shell.ts`): each command run in its running session and
 * waited on, its environment named by `env` on the command line rather than
 * by the API, as Luke's other commands are run (`../vercel-sandbox-api.ts`).
 *
 * Every door hands a file on as one stream, which the door's caller holds to
 * its own bound; the read stops one byte past the widest of those bounds, so
 * a file larger than any is refused as larger rather than read whole.
 */

import { Effect } from "effect";
import type { HttpClient } from "effect/http";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import type { RepositorySandbox, RepositorySandboxDoor } from "../repository-shell.js";
import { type OidcTokenRead, SandboxUnavailable, vercelSandboxApi } from "../vercel-sandbox-api.js";

/** The most of one file a door reads: past every bound a tool holds a file to, a page's HTML and a kept picture among them. */
export const SANDBOX_DOOR_MAX_BYTES = 8 * 1024 * 1024;

/** The states a sandbox is up in, which a file can be read from. */
const UP_STATUSES: ReadonlySet<string> = new Set(["pending", "running"]);

/** How the edge runs the door's effects, on its own runtime. */
export type SandboxDoorRunner = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Promise<A>;

/** The doors to the admitted agent's sandbox: one to read a file through, and one to run a command in. */
export interface AgentSandboxDoors {
  readonly files: InboxSandboxDoor;
  readonly repository: RepositorySandboxDoor;
}

/** The API and the running session of the sandbox tagged with the session; unavailable where none is up. */
function runningSession(readToken: OidcTokenRead, sessionId: string) {
  return Effect.gen(function* () {
    const api = yield* vercelSandboxApi(readToken);
    const sandboxes = yield* api.listTagged(sessionId);
    const running = sandboxes.find(
      (sandbox) => sandbox.status !== undefined && UP_STATUSES.has(sandbox.status),
    )?.currentSessionId;
    if (running === undefined) return yield* new SandboxUnavailable({});
    return { api, running };
  });
}

/** One file of the running sandbox tagged with the session, bounded; nothing where there is no such file. */
function readSessionFile(
  readToken: OidcTokenRead,
  sessionId: string,
  path: string,
): Effect.Effect<Uint8Array | undefined, SandboxUnavailable, HttpClient.HttpClient> {
  return Effect.flatMap(runningSession(readToken, sessionId), ({ api, running }) =>
    api.readFile(running, path, SANDBOX_DOOR_MAX_BYTES),
  );
}

/** One command run as a repository's sandbox runs one: a shell script, where it says, under the environment it names. */
type CommandOptions = Parameters<RepositorySandbox["run"]>[0];

/** One command of the repository's run in the running sandbox tagged with the session, waited on: its script under bash, its environment set by `env` before it. */
function runSessionCommand(readToken: OidcTokenRead, sessionId: string, options: CommandOptions) {
  return Effect.flatMap(runningSession(readToken, sessionId), ({ api, running }) => {
    const environment = Object.entries(options.env ?? {}).map(
      ([name, value]) => `${name}=${value}`,
    );
    return api.run(running, {
      command: "env",
      args: [...environment, "bash", "-c", options.command],
      ...(options.workingDirectory === undefined ? {} : { cwd: options.workingDirectory }),
    });
  });
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
 * The doors to the admitted agent's sandbox, their calls run on the runner
 * given; a conversation that records no session has no sandbox to find, and
 * its doors fail, which each tool answers as a sandbox it could not reach.
 */
export function agentSandboxDoors(
  run: SandboxDoorRunner,
  readToken: OidcTokenRead,
): (admitted: AdmittedConversation) => AgentSandboxDoors {
  return (admitted) => {
    const sessionId = admitted.runtimeSessionId;
    const unfound = () => Promise.reject(new SandboxUnavailable({}));
    if (sessionId === undefined) return { files: unfound, repository: unfound };
    return {
      files: () =>
        Promise.resolve({
          readFile: async ({ path }: { readonly path: string }) => {
            const bytes = await run(readSessionFile(readToken, sessionId, path));
            return bytes === undefined ? null : streamOf(bytes);
          },
        }),
      repository: () =>
        Promise.resolve({
          run: (options: CommandOptions) => run(runSessionCommand(readToken, sessionId, options)),
        }),
    };
  };
}

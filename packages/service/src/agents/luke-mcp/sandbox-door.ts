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
 * Every door hands a file on as one stream, which the door's caller holds to
 * its own bound; the read stops one byte past the widest of those bounds, so
 * a file larger than any is refused as larger rather than read whole.
 */

import { Effect } from "effect";
import type { HttpClient } from "effect/http";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import { type OidcTokenRead, SandboxUnavailable, vercelSandboxApi } from "../vercel-sandbox-api.js";

/** The most of one file a door reads: past every bound a tool holds a file to, a page's HTML and a kept picture among them. */
export const SANDBOX_DOOR_MAX_BYTES = 8 * 1024 * 1024;

/** The states a sandbox is up in, which a file can be read from. */
const UP_STATUSES: ReadonlySet<string> = new Set(["pending", "running"]);

/** How the edge runs the door's effects, on its own runtime. */
export type SandboxDoorRunner = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Promise<A>;

/** One file of the running sandbox tagged with the session, bounded; nothing where there is no such file. */
function readSessionFile(
  readToken: OidcTokenRead,
  sessionId: string,
  path: string,
): Effect.Effect<Uint8Array | undefined, SandboxUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const api = yield* vercelSandboxApi(readToken);
    const sandboxes = yield* api.listTagged(sessionId);
    const running = sandboxes.find(
      (sandbox) => sandbox.status !== undefined && UP_STATUSES.has(sandbox.status),
    )?.currentSessionId;
    if (running === undefined) return yield* new SandboxUnavailable({});
    return yield* api.readFile(running, path, SANDBOX_DOOR_MAX_BYTES);
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
 * The door to the admitted agent's sandbox, its reads run on the runner
 * given; a conversation that records no session has no sandbox to find, and
 * its door fails, which each tool answers as a file it could not read.
 */
export function agentSandboxDoor(
  run: SandboxDoorRunner,
  readToken: OidcTokenRead,
): (admitted: AdmittedConversation) => InboxSandboxDoor {
  return (admitted) => () => {
    const sessionId = admitted.runtimeSessionId;
    if (sessionId === undefined) return Promise.reject(new SandboxUnavailable({}));
    return Promise.resolve({
      readFile: async ({ path }: { readonly path: string }) => {
        const bytes = await run(readSessionFile(readToken, sessionId, path));
        return bytes === undefined ? null : streamOf(bytes);
      },
    });
  };
}

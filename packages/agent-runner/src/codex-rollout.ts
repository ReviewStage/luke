/**
 * codex-rollout.ts -- Codex's rollout kept at the service, where the config names `transcriptsUrl`: each new line mirrored as a turn completes, and the thread's files written back to `CODEX_HOME` where a sandbox no longer holds them.
 *
 * Codex keeps no store of its own: a thread is the rollout file app-server
 * writes under `CODEX_HOME`, one JSON line per item. So the runner keeps it
 * in the same store as Claude Code's transcript (`transcripts.ts`), under
 * the project `codex`, the thread as its session, and the file's path under
 * `CODEX_HOME` as its subpath, as the SDK keeps a file that belongs to a
 * session. A thread resumed or forked has each of its files written back
 * to its own path where it is missing, so app-server finds it by the
 * thread's id as ever. A mirror reads the file past what it already sent,
 * whole lines alone, and sends them; one the store did not take is sent
 * again with the next turn's.
 */

import { existsSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import type { transcriptStore } from "./transcripts.js";

/** The store's project Codex's threads are kept under. */
const CODEX_PROJECT = "codex";

type TranscriptStore = ReturnType<typeof transcriptStore>;

/** A thread's rollout as the launch mirrors it: where it is, and how much of it the store already holds. */
export interface RolloutMirror {
  readonly store: TranscriptStore;
  readonly threadId: string;
  readonly path: string;
  readonly subpath: string;
  sent: number;
}

/** The thread's files the store holds, each written back to its path under `CODEX_HOME` where it is missing. */
export const restoreRollouts = Effect.fn("agent-runner/codex/restoreRollouts")(function* (
  store: TranscriptStore,
  codexHome: string,
  threadId: string,
) {
  const key = { projectKey: CODEX_PROJECT, sessionId: threadId };
  const subpaths = yield* Effect.tryPromise(() => store.listSubkeys(key));
  for (const subpath of subpaths) {
    const path = join(codexHome, subpath);
    if (existsSync(path)) continue;
    const entries = yield* Effect.tryPromise(() => store.load({ ...key, subpath }));
    if (entries === null) continue;
    const text = entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
    yield* Effect.tryPromise(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    });
  }
});

/** A mirror of the thread's rollout at the path app-server named, past what the file already holds, which the store holds already. */
export const openRolloutMirror = Effect.fn("agent-runner/codex/openRolloutMirror")(function* (
  store: TranscriptStore,
  codexHome: string,
  threadId: string,
  path: string,
) {
  const sent = yield* Effect.tryPromise(async () => {
    if (!existsSync(path)) return 0;
    const file = await open(path);
    try {
      return (await file.stat()).size;
    } finally {
      await file.close();
    }
  });
  return {
    store,
    threadId,
    path,
    subpath: relative(codexHome, path),
    sent,
  } satisfies RolloutMirror;
});

/** The rollout's whole lines past what the store holds, sent to it; a read or send that fails sends nothing, and the next tries again. */
export const mirrorRollout = Effect.fn("agent-runner/codex/mirrorRollout")(function* (
  mirror: RolloutMirror,
) {
  const read = yield* Effect.tryPromise(async () => {
    if (!existsSync(mirror.path)) return { entries: [], bytes: 0 };
    const file = await open(mirror.path);
    try {
      const size = (await file.stat()).size;
      const bytes = Buffer.alloc(Math.max(0, size - mirror.sent));
      await file.read(bytes, 0, bytes.length, mirror.sent);
      // Note that a line app-server is still writing is left for the next read.
      const end = bytes.lastIndexOf(0x0a) + 1;
      const entries = bytes
        .subarray(0, end)
        .toString("utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line): SessionStoreEntry => JSON.parse(line));
      return { entries, bytes: end };
    } finally {
      await file.close();
    }
  });
  if (read.entries.length === 0) return;
  const key = { projectKey: CODEX_PROJECT, sessionId: mirror.threadId, subpath: mirror.subpath };
  yield* Effect.tryPromise(() => mirror.store.append(key, read.entries));
  mirror.sent += read.bytes;
});

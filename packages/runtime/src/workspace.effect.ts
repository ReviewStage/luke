/**
 * workspace.effect.ts -- what a workspace tool answers, as the Result vocabulary.
 *
 * `workspace.ts` is ported from OpenClaw and imports nothing from `effect`, so
 * the answers the brain's workspace tools carry live here beside it. Each is a
 * `Result` whose failure is the tool's own rejection text.
 */

import type { Result } from "effect";

/** A workspace file's content, or the reason it was not read. */
export type WorkspaceReadResult = Result.Result<{ readonly content: string }, string>;

/** How many characters a write landed, or the reason it was refused. */
export type WorkspaceWriteResult = Result.Result<{ readonly chars: number }, string>;

/** Where an appended note landed and how long the note now is, or the reason it was refused. */
export type WorkspaceAppendResult = Result.Result<
  { readonly path: string; readonly chars: number },
  string
>;

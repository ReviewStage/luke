import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/**
 * What the notebook read answers: Luke's notebook as the workspace rows hold
 * it, read whole for its owner to look at. The notebook is `MEMORY.md`,
 * `USER.md`, and the dated notes under `memory/`, which is the same set his
 * `memory_search` and `memory_get` tools may name; the other workspace files
 * (`AGENTS.md`, `IDENTITY.md`, `BOOTSTRAP.md`) are instructions this
 * repository seeds, not memory, and never travel here.
 *
 * The answer is bounded on both axes so a long-kept notebook cannot answer
 * a page-sized body: at most `MAX_FILES` rows, the two curated files first
 * and then the newest dated notes, each cut to `MAX_FILE_CHARS` — the same
 * per-file bound the writer lets a note stand at — with `chars` carrying
 * the row's whole length, so a reader can tell a file it was shown all of
 * from one it was shown the head of, and `omittedNotes` saying how many
 * older notes stand behind the ones answered.
 *
 * Declared directly with Effect's `Schema.Struct` and exported under its own
 * name. A key the service added and this declaration does not name is dropped
 * rather than refused, which is what the body read this answer travels through
 * does by default.
 */
export const NOTEBOOK_READ_BOUNDS = {
  /** The two curated files plus the newest dated notes, and no more rows than this. */
  MAX_FILES: 32,
  /** The most characters of one file that travel; the writer's own per-file bound. */
  MAX_FILE_CHARS: 20_000,
  /** The most characters a path may spell, the store's own row bound. */
  MAX_PATH_CHARS: 512,
} as const;

/** An integer at or above its minimum. */
const wholeNumber = (minimum: number) =>
  EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(minimum));

export const notebookFileSchema = EffectSchema.Struct({
  /** The workspace-relative path, as the row spells it: `MEMORY.md`, `USER.md`, or `memory/<day>.md`. */
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(NOTEBOOK_READ_BOUNDS.MAX_PATH_CHARS),
  ),
  /** The file's words, Markdown, from the front and cut at the bound. */
  content: EffectSchema.String.check(EffectSchema.isMaxLength(NOTEBOOK_READ_BOUNDS.MAX_FILE_CHARS)),
  /** How many characters the whole row holds; more than `content` carries means the head alone travelled. */
  chars: wholeNumber(0),
  /** Epoch milliseconds of the row's last write. */
  updatedAt: countedNumber,
});

export type NotebookFile = typeof notebookFileSchema.Type;

export const notebookAnswerSchema = EffectSchema.Struct({
  files: EffectSchema.Array(notebookFileSchema).check(
    EffectSchema.isMaxLength(NOTEBOOK_READ_BOUNDS.MAX_FILES),
  ),
  /** The dated notes older than the ones answered, counted and not carried. */
  omittedNotes: wholeNumber(0),
});

export type NotebookAnswer = typeof notebookAnswerSchema.Type;

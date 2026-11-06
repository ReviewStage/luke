import { Schema as EffectSchema } from "effect";

/**
 * sandbox-mirror-wire.ts -- the mirror: what a tunnel's mirror bridge tells the Mac about a cloud agent's checkout, and what the Mac asks of it.
 *
 * A mirror is a tunnel of the `MIRROR` kind (`sandbox-tunnel-wire.ts`) on
 * which the Mac opens one channel. Every message below rides that channel
 * as one `data` frame, its bytes the message's JSON in UTF-8, so the relay
 * carries the mirror as it carries any channel and reads none of it. On
 * the open the bridge sends a header, then a manifest of every file the
 * checkout holds by git's own rules (`git ls-files -co --exclude-standard`,
 * symlinks left out); from then on it sends a file, a delete, or a skip for
 * each file that changes, and answers the Mac's requests in the order asked.
 * Nothing is kept on either side between connections: a new channel starts
 * over from the header. A file's bytes, its name, and its hash are the
 * agent's and are never logged, traced, counted, or kept in a fixture (root
 * `AGENTS.md`'s Never, as for a Terminal's bytes). A message the Mac sends
 * refuses a key it did not name; one the bridge sends is read dropping any
 * key a newer bridge added.
 */

export const MIRROR_BOUNDS = {
  /** The largest file the bridge sends; a larger one is named in a `skipped` message instead. */
  FILE_BYTES: 10 * 1024 * 1024,
  /** The most paths one request names, so a request stays well under the tunnel's bound on a frame from the Mac. */
  REQUEST_PATHS: 100,
} as const;

/** How a manifest hashes a file's bytes: `node:crypto`'s algorithm and digest encoding, as the Mac hashes its own copy. */
export const MIRROR_HASH = { ALGORITHM: "sha256", ENCODING: "hex" } as const;

/** A file's mode, as git keeps it: executable or not. */
export const MIRROR_FILE_MODE = {
  REGULAR: "100644",
  EXECUTABLE: "100755",
} as const;

export type MirrorFileMode = (typeof MIRROR_FILE_MODE)[keyof typeof MIRROR_FILE_MODE];

/** A mirror message's type. */
export const MIRROR_FRAME = {
  /** The bridge's first message on a channel: the commit the mirror's tree starts from. */
  HEADER: "header",
  /** Every file the checkout holds, with its size and hash, right after the header. */
  MANIFEST: "manifest",
  /** One file's bytes, new, changed, or asked for. */
  FILE: "file",
  /** A file that is gone, or that was asked for and is not in the checkout. */
  DELETE: "delete",
  /** A file over the size bound, never sent. */
  SKIPPED: "skipped",
  /** The Mac's ask for the files named. */
  REQUEST: "request",
} as const;

/** A file's path, relative to the checkout's root with `/` between its folders, as git lists it. */
const path = EffectSchema.NonEmptyString;

const size = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0));

/** One message the bridge sends the Mac. */
export const mirrorFrameSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(MIRROR_FRAME.HEADER),
    /**
     * The merge base of the checkout's `HEAD` and the branch it was cloned
     * from, a commit GitHub holds; `HEAD` itself where the checkout names no
     * such branch, and none where it has no commit yet.
     */
    base: EffectSchema.NullOr(EffectSchema.NonEmptyString),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(MIRROR_FRAME.MANIFEST),
    files: EffectSchema.Array(EffectSchema.Struct({ path, size, hash: EffectSchema.String })),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(MIRROR_FRAME.FILE),
    path,
    mode: EffectSchema.Literals(Object.values(MIRROR_FILE_MODE)),
    bytes: EffectSchema.Uint8ArrayFromBase64,
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(MIRROR_FRAME.DELETE), path }),
  EffectSchema.Struct({ type: EffectSchema.Literal(MIRROR_FRAME.SKIPPED), path, size }),
]);

export type MirrorFrame = typeof mirrorFrameSchema.Type;

/** The Mac's ask for files by path, answered in order, each by its `file`, `skipped`, or `delete`. */
export const mirrorRequestSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(MIRROR_FRAME.REQUEST),
  paths: EffectSchema.Array(path).check(EffectSchema.isMaxLength(MIRROR_BOUNDS.REQUEST_PATHS)),
});

export type MirrorRequest = typeof mirrorRequestSchema.Type;

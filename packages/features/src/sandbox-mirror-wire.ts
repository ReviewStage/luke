import { Schema as EffectSchema } from "effect";

export const MIRROR_BOUNDS = {
  FILE_BYTES: 10 * 1024 * 1024,
  REQUEST_PATHS: 100,
} as const;

export const MIRROR_HASH = { ALGORITHM: "sha256", ENCODING: "hex" } as const;

export const MIRROR_FILE_MODE = {
  REGULAR: "100644",
  EXECUTABLE: "100755",
} as const;

export type MirrorFileMode = (typeof MIRROR_FILE_MODE)[keyof typeof MIRROR_FILE_MODE];

export const MIRROR_FRAME = {
  HEADER: "header",
  MANIFEST: "manifest",
  FILE: "file",
  DELETE: "delete",
  SKIPPED: "skipped",
  REQUEST: "request",
} as const;

const COMMIT_ID_PATTERN = /^[0-9a-f]{40}$/u;

const path = EffectSchema.NonEmptyString;

const size = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0));

export const mirrorFrameSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(MIRROR_FRAME.HEADER),
    base: EffectSchema.String.check(EffectSchema.isPattern(COMMIT_ID_PATTERN)),
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

export const mirrorRequestSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(MIRROR_FRAME.REQUEST),
  paths: EffectSchema.Array(path).check(EffectSchema.isMaxLength(MIRROR_BOUNDS.REQUEST_PATHS)),
});

export type MirrorRequest = typeof mirrorRequestSchema.Type;

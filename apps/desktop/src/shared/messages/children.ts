import { childrenAnswerSchema } from "@sidecar/hosted/reads-wire";
import { WireValueSchema } from "@sidecar/wire";
import { Schema as EffectSchema } from "effect";

/**
 * The account's children as the host's read of the service lists them, for
 * the document every window is told from: whether a read has landed, and
 * each child as the children read answers it, under the same schema the
 * service's answer is read through, so the host cannot hand a window a child
 * the wire would not have admitted.
 */
export const childrenSnapshotSchema = EffectSchema.Struct({
  settled: EffectSchema.Boolean,
  children: childrenAnswerSchema.fields.children,
});

export type ChildrenSnapshot = typeof childrenSnapshotSchema.Type;

/**
 * The open child's transcript as the host composes it: the child, whether a
 * read has landed, the row a read could not read back, and its turn groups.
 * The groups are the Conversation's own shape — stored rows the host already
 * held to the brain catalog's registry — which has no schema of its own on
 * this side of the boundary, so they cross as the Conversation snapshot's do:
 * admitted here as wire records, and read where they are drawn.
 */
export const childTranscriptSnapshotSchema = EffectSchema.Struct({
  childId: EffectSchema.NonEmptyString,
  settled: EffectSchema.Boolean,
  groups: EffectSchema.Array(EffectSchema.Record(EffectSchema.String, WireValueSchema)),
  unreadable: EffectSchema.optionalKey(
    EffectSchema.Struct({
      conversationId: EffectSchema.NonEmptyString,
      seq: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});

import { childrenAnswerSchema } from "@sidecar/hosted/reads-wire";
import { isRecord, isWireBoolean, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Schema as EffectSchema } from "effect";

/**
 * The account's children as the host's read of the service lists them, for
 * the document every window is told from: whether a read has landed, and
 * each child as the children read answers it, under the same schema the
 * service's answer is read through, so the host cannot hand a window a child
 * the wire would not have admitted. The transcript beside it is the
 * Conversation's own shape under a child's id, read where it is drawn as the
 * Conversation's is.
 */
export const childrenSnapshotSchema = EffectSchema.Struct({
  settled: EffectSchema.Boolean,
  children: childrenAnswerSchema.fields.children,
});

export type ChildrenSnapshot = typeof childrenSnapshotSchema.Type;

/** Whether a payload is the open child's transcript as the host composes it: the child, its groups, and whether a read has landed. */
export function isChildTranscriptSnapshot(value: UnparsedWireValue): boolean {
  return (
    isRecord(value) &&
    isWireString(value.childId) &&
    Array.isArray(value.groups) &&
    isWireBoolean(value.settled)
  );
}

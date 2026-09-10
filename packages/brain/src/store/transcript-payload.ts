import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  type CompactionBoundary,
  type ContextInput,
  isCompactionSource,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The shape a transcript event is stored in, and the reading that takes it
 * back. A row keeps the event's kind and clock in columns of their own and
 * the rest as this payload, so the writer and the reader are one pair
 * wherever the rows live, and a payload this build cannot vouch for drops the
 * row rather than the transcript.
 */

/** The payload a row keeps: the event less its kind and clock, which have columns of their own. */
export function transcriptPayload(
  event: TranscriptEvent,
): { input: ContextInput } | { boundary: CompactionBoundary } {
  return event.kind === TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT
    ? { input: event.input }
    : { boundary: event.boundary };
}

/** The event a parsed payload describes: the row's `{ input }` or `{ boundary }`, or an archive line carrying the same fields. */
export function transcriptEventFromPayload(
  kind: string,
  recordedAt: number,
  parsed: UnparsedWireValue,
): TranscriptEvent | undefined {
  if (!isRecord(parsed)) return undefined;
  if (kind === TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT) {
    const input = contextInputFromWire(parsed.input);
    return input ? { kind, recordedAt, input } : undefined;
  }
  if (kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
    const boundary = parsed.boundary;
    if (!isRecord(boundary) || !isWireNumber(boundary.dropped)) return undefined;
    const source = isCompactionSource(boundary.source)
      ? boundary.source
      : COMPACTION_SOURCE.PROVIDER_INLINE;
    return {
      kind,
      recordedAt,
      boundary: {
        source,
        dropped: boundary.dropped,
        ...(isWireString(boundary.checkpointFormat)
          ? { checkpointFormat: boundary.checkpointFormat }
          : undefined),
      },
    };
  }
  return undefined;
}

function contextInputFromWire(value: UnparsedWireValue): ContextInput | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case CONTEXT_INPUT_KIND.USER_TEXT:
      return isWireString(value.text) ? { kind: value.kind, text: value.text } : undefined;
    case CONTEXT_INPUT_KIND.MODEL_OUTPUT: {
      if (!Array.isArray(value.items)) return undefined;
      const items = [];
      for (const item of value.items) {
        if (!isRecord(item)) return undefined;
        items.push(item);
      }
      return { kind: value.kind, items };
    }
    case CONTEXT_INPUT_KIND.TOOL_RESULT:
      return isWireString(value.callId) && isWireString(value.outputJson)
        ? { kind: value.kind, callId: value.callId, outputJson: value.outputJson }
        : undefined;
    default:
      return undefined;
  }
}

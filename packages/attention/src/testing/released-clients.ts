import { isRecord, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";
import { ATTENTION_DISPOSITION, type AttentionDisposition } from "../attention.js";

/**
 * How released desktops read a hosted attention answer, transcribed from the
 * two client generations still in the field and frozen: the first-version
 * reader (before the judgment-only contract) refuses a spoken decision that
 * carries no summary, and the second-version reader keeps the judgment alone.
 * The service is held to answering both exactly as it did when they shipped.
 */

const RELEASED_SUMMARY_LENGTH = 180;

export interface ReleasedV1Decision {
  disposition: AttentionDisposition;
  decidedAt: number;
  summary?: string;
}

function dispositionFromWire(value: UnparsedWireValue): AttentionDisposition | undefined {
  if (!isWireString(value)) return undefined;
  return Object.values(ATTENTION_DISPOSITION).find((candidate) => candidate === value);
}

export function releasedV1ReviewAnswer(
  value: UnparsedWireValue,
  decidedAt: number,
): ReleasedV1Decision | undefined {
  if (!isRecord(value) || !isRecord(value.decision)) return undefined;
  const disposition = dispositionFromWire(value.decision.disposition);
  if (!disposition) return undefined;
  const summary = text(value.decision.summary)?.slice(0, RELEASED_SUMMARY_LENGTH);
  if (disposition !== ATTENTION_DISPOSITION.SILENT && !summary) return undefined;
  return { disposition, decidedAt, ...(summary ? { summary } : undefined) };
}

export function releasedV2ReviewAnswer(
  value: UnparsedWireValue,
  decidedAt: number,
): { disposition: AttentionDisposition; decidedAt: number } | undefined {
  if (!isRecord(value) || !isRecord(value.decision)) return undefined;
  const disposition = dispositionFromWire(value.decision.disposition);
  return disposition ? { disposition, decidedAt } : undefined;
}

export function releasedSubjectAnswer(value: UnparsedWireValue): string | null | undefined {
  if (!isRecord(value)) return undefined;
  if (value.subject === null) return null;
  return isWireString(value.subject) ? value.subject : undefined;
}

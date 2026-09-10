import {
  OMISSION_MARKER,
  type ProviderTranscriptResult,
  type SessionIdentity,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { rejection } from "./records.js";
import { type Settled, settledUnlessAborted } from "./settled.js";
import { REFUSAL_REASON } from "./turn.js";

/** A transcript held to a bound from the front, and whether anything was cut. */
interface FrontCut {
  text: string;
  cut: boolean;
}

function cutFront(value: string, maximumChars: number): FrontCut {
  if (value.length <= maximumChars) return { text: value, cut: false };
  const keep = Math.max(0, maximumChars - OMISSION_MARKER.length - 1);
  return { text: `${OMISSION_MARKER}\n${value.slice(value.length - keep)}`, cut: true };
}

export interface WholeTranscriptRead {
  read: (identity: SessionIdentity) => Promise<ProviderTranscriptResult>;
  signal: AbortSignal;
  maximumChars: number;
}

export async function readWholeTranscript(
  identity: SessionIdentity,
  options: WholeTranscriptRead,
): Promise<WireRecord> {
  let read: Settled<ProviderTranscriptResult>;
  try {
    read = await settledUnlessAborted(options.read(identity), options.signal);
  } catch {
    return rejection(REFUSAL_REASON.READ_FAILED);
  }
  if (read.aborted) return rejection(REFUSAL_REASON.RUN_REVOKED);
  const result = read.value;
  if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
    return { status: result.status, reason: result.reason };
  }
  const bounded = cutFront(result.transcript, options.maximumChars);
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    truncated: bounded.cut,
    transcript: bounded.text,
  };
}

import type { SessionIdentity } from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

/**
 * The wire readings a turn's tools and journal share: what a model's call
 * carried, which session it named, and the shape a refusal takes. They are
 * about one record at a time and know nothing of generations.
 */

export function parsedRecord(json: string): WireRecord {
  try {
    // SAFETY: JSON.parse returns a wire value; the record check below is the validation.
    const parsed = JSON.parse(json) as UnparsedWireValue;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function identityFromRecord(value: UnparsedWireValue): SessionIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = text(value.provider_id);
  const providerSessionId = text(value.provider_session_id);
  return providerId && providerSessionId ? { providerId, providerSessionId } : undefined;
}

export function sameIdentity(first: SessionIdentity, second: SessionIdentity): boolean {
  return (
    first.providerId === second.providerId && first.providerSessionId === second.providerSessionId
  );
}

export function rejection(reason: string): WireRecord {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}

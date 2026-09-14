import type { SessionIdentity } from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

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
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

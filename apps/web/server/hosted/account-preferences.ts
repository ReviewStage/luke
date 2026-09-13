import { type AccountPreferences, RETIRED_ACCOUNT_PREFERENCE_FIELD } from "@sidecar/settings";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { isRealtimeVoiceSpeed, type RealtimeVoiceSpeed } from "../core.js";

/**
 * The hosted snapshot: the preferences every device shares, and the phone's
 * Realtime pace, which the desktop no longer has and its reader drops. The
 * pace is kept here for the phone alone until it moves to Live, so a phone
 * that syncs its pace today keeps it across its own devices meanwhile.
 */
export type HostedAccountPreferences = AccountPreferences & {
  [RETIRED_ACCOUNT_PREFERENCE_FIELD.VOICE_SPEED]?: RealtimeVoiceSpeed;
};

export type PhoneVoiceSpeed =
  | { valid: true; value: RealtimeVoiceSpeed | undefined }
  | { valid: false };

/** The phone's pace out of the raw snapshot: absent or null is none, and anything but a pace the Realtime contract offers refuses the write. */
export function phoneVoiceSpeed(preferences: UnparsedWireValue): PhoneVoiceSpeed {
  if (!isRecord(preferences)) return { valid: true, value: undefined };
  const raw = preferences[RETIRED_ACCOUNT_PREFERENCE_FIELD.VOICE_SPEED];
  if (raw === undefined || raw === null) return { valid: true, value: undefined };
  return isRealtimeVoiceSpeed(raw) ? { valid: true, value: raw } : { valid: false };
}

export interface AccountPreferencesRow {
  preferences: HostedAccountPreferences;
  updatedAt: Date;
}

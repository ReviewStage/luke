import {
  type AccountPreferences,
  accountPreferencesFromWire,
  RETIRED_ACCOUNT_PREFERENCE_FIELD,
} from "@sidecar/settings";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { isRealtimeVoiceSpeed, type RealtimeVoiceSpeed } from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

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

export interface AccountPreferencesReadOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  readPreferences: (userId: string) => Promise<AccountPreferencesRow | undefined>;
}

export interface AccountPreferencesWriteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  writePreferences: (userId: string, preferences: HostedAccountPreferences) => Promise<Date>;
}

export async function handleAccountPreferencesRead(
  options: AccountPreferencesReadOptions,
): Promise<Response> {
  const { request, resolveUserId, readPreferences } = options;

  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const row = await readPreferences(userId);
  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    preferences: row?.preferences ?? {},
    ...(row ? { updatedAt: row.updatedAt.getTime() } : undefined),
  });
}

export async function handleAccountPreferencesWrite(
  options: AccountPreferencesWriteOptions,
): Promise<Response> {
  const { request, resolveUserId, writePreferences } = options;

  if (request.method !== "PUT") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  let body: UnparsedWireValue;
  try {
    // SAFETY: Request JSON is untrusted boundary data; accountPreferencesFromWire validates it before use.
    body = (await request.json()) as UnparsedWireValue;
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  if (!isRecord(body)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const shared = accountPreferencesFromWire(body.preferences);
  const pace = phoneVoiceSpeed(body.preferences);
  if (shared === undefined || !pace.valid) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const incoming: HostedAccountPreferences = {
    ...shared,
    ...(pace.value !== undefined
      ? { [RETIRED_ACCOUNT_PREFERENCE_FIELD.VOICE_SPEED]: pace.value }
      : undefined),
  };

  const updatedAt = await writePreferences(userId, incoming);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    preferences: incoming,
    updatedAt: updatedAt.getTime(),
  });
}

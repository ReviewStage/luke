import { type AccountPreferences, accountPreferencesFromWire } from "@sidecar/settings";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/**
 * Fields a client of an earlier contract still writes and this build no
 * longer keeps. The phone syncs its Realtime pace under this key until it
 * moves to Live; the desktop has no pace and the row no longer carries one,
 * so the key is dropped at the door rather than refusing the phone's whole
 * snapshot. Removing an entry here is the phone's follow-up, not a cleanup.
 */
const RETIRED_ACCOUNT_PREFERENCE_FIELD = {
  VOICE_SPEED: "voiceSpeed",
} as const;

const RETIRED_ACCOUNT_PREFERENCE_FIELDS: ReadonlySet<string> = new Set(
  Object.values(RETIRED_ACCOUNT_PREFERENCE_FIELD),
);

function withoutRetiredFields(preferences: UnparsedWireValue): UnparsedWireValue {
  if (!isRecord(preferences)) return preferences;
  return Object.fromEntries(
    Object.entries(preferences).filter(([field]) => !RETIRED_ACCOUNT_PREFERENCE_FIELDS.has(field)),
  );
}

export interface AccountPreferencesRow {
  preferences: AccountPreferences;
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
  writePreferences: (userId: string, preferences: AccountPreferences) => Promise<Date>;
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

  const incoming = accountPreferencesFromWire(withoutRetiredFields(body.preferences));
  if (incoming === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const updatedAt = await writePreferences(userId, incoming);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    preferences: incoming,
    updatedAt: updatedAt.getTime(),
  });
}

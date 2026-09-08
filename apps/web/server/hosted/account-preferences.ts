import { type AccountPreferences, accountPreferencesFromWire } from "@sidecar/settings";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

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

  const incoming = accountPreferencesFromWire(body.preferences, {
    unknownFields: "reject",
    invalidFields: "reject",
  });
  if (incoming === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const updatedAt = await writePreferences(userId, incoming);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    preferences: incoming,
    updatedAt: updatedAt.getTime(),
  });
}

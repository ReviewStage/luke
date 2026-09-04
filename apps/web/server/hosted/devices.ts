import {
  deviceTokenIsStorable,
  isDevicePlatform,
  isPushEnvironment,
  isRecord,
  text,
  type UnparsedWireValue,
} from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/**
 * A phone's push registration as the endpoints store it. The token is kept
 * lowercased so the same device never stands twice under two spellings.
 */
export interface DeviceRegistration {
  token: string;
  platform: string;
  environment: string;
}

function parseDeviceToken(value: UnparsedWireValue): string | undefined {
  const token = text(value)?.toLowerCase();
  return token !== undefined && deviceTokenIsStorable(token) ? token : undefined;
}

async function requestBody(request: Request): Promise<UnparsedWireValue> {
  try {
    // SAFETY: request.json() returns unknown; isRecord at the call site validates the shape.
    return (await request.json()) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

export interface DeviceTokenStoreOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** Stores the registration for the account, moving the token if another account held it. */
  storeToken: (userId: string, registration: DeviceRegistration) => Promise<void>;
}

/**
 * Registers the signed-in account's phone for push. The bearer token names
 * the account and nothing in the body can choose another; a token already on
 * file moves to this account, because the phone that sends it is the phone
 * that is signed in here now.
 */
export async function handleDeviceTokenStore(options: DeviceTokenStoreOptions): Promise<Response> {
  const { request, resolveUserId, storeToken } = options;

  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const body = await requestBody(request);
  if (!isRecord(body)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const token = parseDeviceToken(body.token);
  const platform = text(body.platform);
  const environment = text(body.environment);
  if (!token || !isDevicePlatform(platform) || !isPushEnvironment(environment)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  await storeToken(userId, { token, platform, environment });

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { stored: true });
}

export interface DeviceTokenDeleteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** Deletes the token only where this account holds it; answers whether a row went. */
  deleteToken: (userId: string, token: string) => Promise<boolean>;
}

/**
 * Forgets one phone at sign-out. Scoped to the account the bearer names, so a
 * caller cannot unregister a token another account holds.
 */
export async function handleDeviceTokenDelete(
  options: DeviceTokenDeleteOptions,
): Promise<Response> {
  const { request, resolveUserId, deleteToken } = options;

  if (request.method !== "DELETE") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const body = await requestBody(request);
  if (!isRecord(body)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const token = parseDeviceToken(body.token);
  if (!token) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const deleted = await deleteToken(userId, token);

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
}

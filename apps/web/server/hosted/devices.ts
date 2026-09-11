import { randomUUID } from "node:crypto";
import {
  DEVICE_METHOD,
  type DeviceForgetRequest,
  type DeviceHeartbeatRequest,
  type DevicePlatform,
  deviceForgetRequestSchema,
  deviceHeartbeatRequestSchema,
  deviceRegisterRequestSchema,
  type PushEnvironment,
  type Schema,
  type UnparsedWireValue,
} from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { createRateBrake } from "./rate-brake.js";

/**
 * The device record's three writes, on one path: register the installation
 * at sign-in, move its last-seen instant on a heartbeat, forget it at
 * sign-out. The bearer token names the account and nothing in a body can
 * choose another; every row the seams touch is scoped to that account, so a
 * caller cannot see, move, or forget a device another account holds. The
 * brake is generous enough for every device a person owns to heartbeat every
 * few minutes and tight enough that a client stuck in a loop is a trickle.
 */

const DEVICE_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 60,
  MAX_TRACKED_USERS: 10_000,
} as const;

const deviceRateLimited = createRateBrake({
  windowMs: DEVICE_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: DEVICE_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: DEVICE_RATE_LIMIT.MAX_TRACKED_USERS,
});

/** A push token with the gateway that issued it, as a row stores the pair. */
interface DevicePushAddress {
  token: string;
  environment: PushEnvironment;
}

/**
 * What a registration writes: the row's key, its platform, and the push
 * address it arrived with. An address replaces the one on file; none leaves
 * it, because a device that registers before Apple has handed its token back
 * still has the token it registered with last time.
 */
export interface DeviceRegistration {
  installationId: string;
  platform: DevicePlatform;
  push: DevicePushAddress | undefined;
}

/**
 * What a heartbeat writes beside the last-seen instant. `push` is a change
 * only when present: a new address replaces the one on file, `null` clears
 * it, and absent leaves it. `activeUntil` and `quietUntil` likewise move only
 * when the device reported them; the heartbeat carries no quiet instant, the
 * change-signal poll does.
 */
export interface DeviceHeartbeat {
  deviceId: string;
  /** `null` clears the presence on file, which is how a device reports it went idle. */
  activeUntil: Date | null | undefined;
  /** The instant a meeting hold the device observes ends; `null` clears it, absent leaves it. */
  quietUntil?: Date | null;
  push: DevicePushAddress | null | undefined;
}

export interface DeviceSeams {
  /**
   * Upserts the installation's row under the account, moving it from any
   * account that held it, and answers the row's id, minted here on a first
   * registration and kept across every later one.
   */
  registerDevice: (
    userId: string,
    registration: DeviceRegistration,
    mintId: () => string,
    now: Date,
  ) => Promise<{ deviceId: string }>;
  /** Moves the row's last-seen instant and applies the heartbeat's changes; answers whether the account holds the row. */
  touchDevice: (userId: string, heartbeat: DeviceHeartbeat, now: Date) => Promise<boolean>;
  /** Deletes the row only where this account holds it; answers whether a row went. */
  forgetDevice: (userId: string, deviceId: string) => Promise<boolean>;
}

export interface DevicesOptions extends DeviceSeams {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  now?: () => number;
  mintId?: () => string;
}

const DEVICE_METHODS: ReadonlySet<string> = new Set(Object.values(DEVICE_METHOD));

async function requestBody<Value>(
  request: Request,
  schema: Schema<Value>,
): Promise<Value | undefined> {
  let body: UnparsedWireValue;
  try {
    // SAFETY: request.json() returns unknown; the schema parse below validates the shape.
    body = (await request.json()) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  return schema.parse(body);
}

function pushAddress(fields: {
  pushToken?: string | null;
  pushEnvironment?: PushEnvironment;
}): DevicePushAddress | undefined {
  if (!fields.pushToken || fields.pushEnvironment === undefined) return undefined;
  return { token: fields.pushToken, environment: fields.pushEnvironment };
}

function heartbeatFrom(request: DeviceHeartbeatRequest): DeviceHeartbeat {
  return {
    deviceId: request.deviceId,
    activeUntil: request.activeUntil === undefined ? undefined : new Date(request.activeUntil),
    push: request.pushToken === null ? null : pushAddress(request),
  };
}

/**
 * Dispatches the one path's three methods. The gate order is the shared one:
 * method, bearer, brake, body. A body that is not the method's documented
 * shape is one 400 whatever was wrong with it, so a refused request tells a
 * caller nothing about which field the service reads.
 */
export async function handleDevices(options: DevicesOptions): Promise<Response> {
  const { request, resolveUserId } = options;
  const now = options.now ?? Date.now;
  const mintId = options.mintId ?? randomUUID;

  if (!DEVICE_METHODS.has(request.method)) {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  if (deviceRateLimited(userId, now())) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }

  if (request.method === DEVICE_METHOD.REGISTER) {
    const body = await requestBody(request, deviceRegisterRequestSchema);
    if (!body) {
      return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
    }
    const registration: DeviceRegistration = {
      installationId: body.installationId,
      platform: body.platform,
      push: pushAddress(body),
    };
    const { deviceId } = await options.registerDevice(
      userId,
      registration,
      mintId,
      new Date(now()),
    );
    return jsonResponse(HOSTED_HTTP_STATUS.OK, { deviceId });
  }

  if (request.method === DEVICE_METHOD.HEARTBEAT) {
    const body = await requestBody(request, deviceHeartbeatRequestSchema);
    if (!body) {
      return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
    }
    const seen = await options.touchDevice(userId, heartbeatFrom(body), new Date(now()));
    return jsonResponse(HOSTED_HTTP_STATUS.OK, { seen });
  }

  const body: DeviceForgetRequest | undefined = await requestBody(
    request,
    deviceForgetRequestSchema,
  );
  if (!body) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const deleted = await options.forgetDevice(userId, body.deviceId);
  return jsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
}

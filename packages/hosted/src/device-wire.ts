import {
  isWireString,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { isWireUuid, WIRE_UUID_LENGTH, wireUuidSchema } from "./service-wire.js";

/**
 * One device record per app installation, on every platform Luke runs on.
 * The three endpoints on one path — register, heartbeat, forget — take and
 * answer the shapes declared here, and the desktop, the service, and the
 * Swift transcription in `LukeKit/DeviceClient.swift` mirror this one file.
 */

/** The platforms a device row may name. Shared on the wire with the Swift `DevicePlatform`. */
export const DEVICE_PLATFORM = {
  MACOS: "macos",
  IOS: "ios",
  WATCHOS: "watchos",
} as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];

const DEVICE_PLATFORM_LIST = Object.values(DEVICE_PLATFORM);

const DEVICE_PLATFORM_SET: ReadonlySet<string> = new Set(DEVICE_PLATFORM_LIST);

export function isDevicePlatform(value: UnparsedWireValue): value is DevicePlatform {
  return isWireString(value) && DEVICE_PLATFORM_SET.has(value);
}

/**
 * Which of Apple's two push gateways a token belongs to. A build run from
 * Xcode registers with the sandbox gateway and one from TestFlight or the App
 * Store with production; the phone knows which it is, and a token sent to the
 * wrong gateway is refused, so the registration says.
 */
export const PUSH_ENVIRONMENT = {
  SANDBOX: "sandbox",
  PRODUCTION: "production",
} as const;

export type PushEnvironment = (typeof PUSH_ENVIRONMENT)[keyof typeof PUSH_ENVIRONMENT];

const PUSH_ENVIRONMENT_LIST = Object.values(PUSH_ENVIRONMENT);

const PUSH_ENVIRONMENT_SET: ReadonlySet<string> = new Set(PUSH_ENVIRONMENT_LIST);

export function isPushEnvironment(value: UnparsedWireValue): value is PushEnvironment {
  return isWireString(value) && PUSH_ENVIRONMENT_SET.has(value);
}

/**
 * The bounds a device token must sit inside before the service stores it.
 * Apple hands the app the token as bytes, and the phone sends its hex; Apple
 * documents no fixed length, so the bound is generous on both sides and the
 * check is only that it is hex at all.
 */
export const DEVICE_TOKEN_BOUNDS = {
  MIN_LENGTH: 32,
  MAX_LENGTH: 512,
} as const;

export function deviceTokenIsStorable(token: string): boolean {
  return (
    token.length >= DEVICE_TOKEN_BOUNDS.MIN_LENGTH &&
    token.length <= DEVICE_TOKEN_BOUNDS.MAX_LENGTH &&
    /^[0-9a-f]+$/u.test(token)
  );
}

/** A push token as it travels: lowercased so one device never stands twice under two spellings. */
const pushTokenSchema: Schema<string> = s.refine(
  s.map(s.text({ max: DEVICE_TOKEN_BOUNDS.MAX_LENGTH }), (token) => token.toLowerCase()),
  deviceTokenIsStorable,
);

const pushEnvironmentSchema: Schema<PushEnvironment> = s.enumOf(PUSH_ENVIRONMENT_LIST);

/**
 * Every id on this wire is a UUID: the installation id a client mints once
 * and keeps, and the device id the service mints for its row. The shape is
 * the hosted wire's one UUID rule, the canonical lowercase hyphenated form,
 * which is the only one either side ever writes.
 */
export const DEVICE_ID_LENGTH = WIRE_UUID_LENGTH;

export const isDeviceWireId = isWireUuid;

export const deviceWireIdSchema: Schema<string> = wireUuidSchema;

/** Whether a token and its gateway arrived together: one without the other addresses nothing. */
function pushFieldsPaired(fields: {
  pushToken?: string | null;
  pushEnvironment?: PushEnvironment;
}): boolean {
  if (isWireString(fields.pushToken)) return fields.pushEnvironment !== undefined;
  return fields.pushEnvironment === undefined;
}

/**
 * What a client sends to register the installation it runs as. The
 * installation id is the client's stable key: a row already standing under
 * it moves to the account the bearer names, so a machine that signs into a
 * different account carries its one row along rather than leaving a second.
 * A push token present replaces the one on file; one absent leaves it, since
 * a launch that registers before Apple hands the token back is not a device
 * without one.
 */
export interface DeviceRegisterRequest {
  platform: DevicePlatform;
  installationId: string;
  pushToken?: string;
  pushEnvironment?: PushEnvironment;
}

export const deviceRegisterRequestSchema: Schema<DeviceRegisterRequest> = s.refine(
  s.record({
    platform: s.enumOf(DEVICE_PLATFORM_LIST),
    installationId: deviceWireIdSchema,
    pushToken: pushTokenSchema.optional(),
    pushEnvironment: pushEnvironmentSchema.optional(),
  }),
  pushFieldsPaired,
);

/** Confirms a registration and names the row the service minted or already held. */
export interface DeviceRegisterAnswer {
  deviceId: string;
}

export const deviceRegisterAnswerSchema: Schema<DeviceRegisterAnswer> = s.record(
  { deviceId: deviceWireIdSchema },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/**
 * A heartbeat moves the row's last-seen instant and may carry two optional
 * changes: the instant presence holds until (only a platform that can read
 * its own input activity sends one), and a push token change — a new token
 * with its gateway, or `null` to clear the one on file. A field left out
 * changes nothing.
 */
export interface DeviceHeartbeatRequest {
  deviceId: string;
  /** Epoch milliseconds; absent leaves presence as it stands. */
  activeUntil?: number;
  pushToken?: string | null;
  pushEnvironment?: PushEnvironment;
}

export const deviceHeartbeatRequestSchema: Schema<DeviceHeartbeatRequest> = s.refine(
  s.record({
    deviceId: deviceWireIdSchema,
    activeUntil: s.wholeNumber({ minimum: 0 }).optional(),
    pushToken: s.union([pushTokenSchema, s.literal(null)]).optional(),
    pushEnvironment: pushEnvironmentSchema.optional(),
  }),
  pushFieldsPaired,
);

/** Whether the heartbeat found the row; `false` tells the client to register again. */
export interface DeviceHeartbeatAnswer {
  seen: boolean;
}

export const deviceHeartbeatAnswerSchema: Schema<DeviceHeartbeatAnswer> = s.record(
  { seen: s.boolean() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** Forgets the row at sign-out. */
export interface DeviceForgetRequest {
  deviceId: string;
}

export const deviceForgetRequestSchema: Schema<DeviceForgetRequest> = s.record({
  deviceId: deviceWireIdSchema,
});

/** Confirms whether a sign-out found and removed the device's row. */
export interface DeviceForgetAnswer {
  deleted: boolean;
}

export const deviceForgetAnswerSchema: Schema<DeviceForgetAnswer> = s.record(
  { deleted: s.boolean() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

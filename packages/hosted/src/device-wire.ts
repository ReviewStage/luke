import { isWireString, SCHEMA_REFUSAL, type UnparsedWireValue } from "@sidecar/wire";
import { wireRefusal } from "@sidecar/wire/effect";
import { Schema as EffectSchema } from "effect";
import { isWireUuid, WIRE_UUID_LENGTH, wireUuidSchema } from "./service-wire.js";

/**
 * One device record per app installation, on every platform Luke runs on.
 * The three endpoints on one path — register, heartbeat, forget — take and
 * answer the shapes declared here, and the desktop, the service, and the
 * Swift transcription in `LukeKit/DeviceClient.swift` mirror this one file.
 *
 * Every request and answer below is composed directly with Effect's
 * `Schema.Struct` and exported under its own name; a caller reads one
 * through `readEither` and shows it through `emitJsonSchema`.
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
 * The one custom key a briefing's notification carries beside `aps`, and
 * what travels under it: the pushed message's own id, so a tap on the phone
 * opens the Conversation at that briefing rather than at whichever arrived
 * last. The id is Luke's own opaque UUID — it names no session, branch, path,
 * or error line, is unique to one message so it correlates nothing across
 * pushes, and means nothing to Apple — and it is the only identifier the
 * payload carries. Shared on the wire with the Swift `BriefingPushTap`.
 */
export const BRIEFING_PUSH_PAYLOAD_KEY = {
  MESSAGE_ID: "messageId",
} as const;

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

/** A text trimmed and refused when left with nothing. */
function trimmedText(maximumChars: number): EffectSchema.Schema<string, string> {
  return EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: (value) => value.trim(),
    encode: (value) => value,
  }).pipe(
    EffectSchema.filter((value) => value.trim().length > 0, {
      schemaId: EffectSchema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
    EffectSchema.maxLength(maximumChars),
  );
}

/** A push token as it travels: lowercased so one device never stands twice under two spellings. */
const pushToken = EffectSchema.transform(
  trimmedText(DEVICE_TOKEN_BOUNDS.MAX_LENGTH),
  EffectSchema.String,
  {
    strict: true,
    decode: (value) => value.toLowerCase(),
    encode: (value) => value,
  },
).pipe(EffectSchema.filter(deviceTokenIsStorable));

const pushEnvironment = EffectSchema.Literal(...PUSH_ENVIRONMENT_LIST);

/**
 * Every id on this wire is a UUID: the installation id a client mints once
 * and keeps, and the device id the service mints for its row. The shape is
 * the hosted wire's one UUID rule, the canonical lowercase hyphenated form,
 * which is the only one either side ever writes.
 */
export const DEVICE_ID_LENGTH = WIRE_UUID_LENGTH;

export const isDeviceWireId = isWireUuid;

/** The hosted wire's one UUID rule, which every id on this wire shares. */
export const deviceWireIdSchema = wireUuidSchema;

const deviceId = deviceWireIdSchema;

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

const deviceRegisterRequestCore = EffectSchema.Struct({
  platform: EffectSchema.Literal(...DEVICE_PLATFORM_LIST),
  installationId: deviceId,
  pushToken: EffectSchema.optionalWith(pushToken, { exact: true }),
  pushEnvironment: EffectSchema.optionalWith(pushEnvironment, { exact: true }),
}).pipe(EffectSchema.filter(pushFieldsPaired));

export const deviceRegisterRequestSchema = deviceRegisterRequestCore;

/** Confirms a registration and names the row the service minted or already held. */
export interface DeviceRegisterAnswer {
  deviceId: string;
}

const deviceRegisterAnswerCore = EffectSchema.Struct({ deviceId }).annotations({
  parseOptions: { onExcessProperty: "ignore" },
});

export const deviceRegisterAnswerSchema = deviceRegisterAnswerCore;

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

const deviceHeartbeatRequestCore = EffectSchema.Struct({
  deviceId,
  activeUntil: EffectSchema.optionalWith(
    EffectSchema.Int.pipe(EffectSchema.greaterThanOrEqualTo(0)),
    {
      exact: true,
    },
  ),
  pushToken: EffectSchema.optionalWith(
    EffectSchema.Union(pushToken, EffectSchema.Literal(null)).annotations(
      wireRefusal(SCHEMA_REFUSAL.MALFORMED),
    ),
    { exact: true },
  ),
  pushEnvironment: EffectSchema.optionalWith(pushEnvironment, { exact: true }),
}).pipe(EffectSchema.filter(pushFieldsPaired));

export const deviceHeartbeatRequestSchema = deviceHeartbeatRequestCore;

/** Whether the heartbeat found the row; `false` tells the client to register again. */
export interface DeviceHeartbeatAnswer {
  seen: boolean;
}

const deviceHeartbeatAnswerCore = EffectSchema.Struct({ seen: EffectSchema.Boolean }).annotations({
  parseOptions: { onExcessProperty: "ignore" },
});

export const deviceHeartbeatAnswerSchema = deviceHeartbeatAnswerCore;

/** Forgets the row at sign-out. */
export interface DeviceForgetRequest {
  deviceId: string;
}

const deviceForgetRequestCore = EffectSchema.Struct({ deviceId });

export const deviceForgetRequestSchema = deviceForgetRequestCore;

/** Confirms whether a sign-out found and removed the device's row. */
export interface DeviceForgetAnswer {
  deleted: boolean;
}

const deviceForgetAnswerCore = EffectSchema.Struct({ deleted: EffectSchema.Boolean }).annotations({
  parseOptions: { onExcessProperty: "ignore" },
});

export const deviceForgetAnswerSchema = deviceForgetAnswerCore;

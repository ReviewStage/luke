import { isWireString, SCHEMA_REFUSAL, type UnparsedWireValue } from "@sidecar/wire";
import { wireRefusal } from "@sidecar/wire/effect";
import { Schema as EffectSchema, SchemaTransformation } from "effect";
import { isWireUuid, WIRE_UUID_LENGTH, wireUuidSchema } from "./service-wire.js";

/**
 * One device record per app installation, on every platform Luke runs on.
 * The three endpoints on one path — register, heartbeat, forget — take and
 * answer the shapes declared here, and the desktop, the service, and the
 * Swift transcription in `LukeKit/DeviceClient.swift` mirror this one file.
 *
 * Every request and answer below is composed directly with Effect's
 * `Schema.Struct` and exported under its own name; a caller reads one
 * through `readEither` and shows it through `emitJsonSchema`. A request is
 * read as declared, refusing a key it does not name; an answer is read with
 * `{ excess: EXCESS_KEYS.DROP }`, which is where the tolerance for a key a
 * newer service added now lives.
 */

/** The platforms a device row may name. Shared on the wire with the Swift `DevicePlatform`. */
export const DEVICE_PLATFORM = {
  MACOS: "macos",
  IOS: "ios",
  WATCHOS: "watchos",
} as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];

const devicePlatformSchema = EffectSchema.Literals(Object.values(DEVICE_PLATFORM));

export const isDevicePlatform: (value: UnparsedWireValue) => value is DevicePlatform =
  EffectSchema.is(devicePlatformSchema);

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

const pushEnvironmentSchema = EffectSchema.Literals(Object.values(PUSH_ENVIRONMENT));

export const isPushEnvironment: (value: UnparsedWireValue) => value is PushEnvironment =
  EffectSchema.is(pushEnvironmentSchema);

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
function trimmedText(maximumChars: number): EffectSchema.Codec<string, string> {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** A push token as it travels: lowercased so one device never stands twice under two spellings. */
const pushToken = trimmedText(DEVICE_TOKEN_BOUNDS.MAX_LENGTH)
  .pipe(EffectSchema.decodeTo(EffectSchema.String, SchemaTransformation.toLowerCase()))
  .check(EffectSchema.makeFilter(deviceTokenIsStorable));

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
  platform: devicePlatformSchema,
  installationId: deviceId,
  pushToken: EffectSchema.optionalKey(pushToken),
  pushEnvironment: EffectSchema.optionalKey(pushEnvironmentSchema),
}).check(EffectSchema.makeFilter(pushFieldsPaired));

export const deviceRegisterRequestSchema = deviceRegisterRequestCore;

/** Confirms a registration and names the row the service minted or already held. */
export interface DeviceRegisterAnswer {
  deviceId: string;
}

const deviceRegisterAnswerCore = EffectSchema.Struct({ deviceId });

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
  activeUntil: EffectSchema.optionalKey(
    EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  ),
  pushToken: EffectSchema.optionalKey(
    EffectSchema.Union([pushToken, EffectSchema.Null]).annotate(
      wireRefusal(SCHEMA_REFUSAL.MALFORMED),
    ),
  ),
  pushEnvironment: EffectSchema.optionalKey(pushEnvironmentSchema),
}).check(EffectSchema.makeFilter(pushFieldsPaired));

export const deviceHeartbeatRequestSchema = deviceHeartbeatRequestCore;

/** Whether the heartbeat found the row; `false` tells the client to register again. */
export interface DeviceHeartbeatAnswer {
  seen: boolean;
}

const deviceHeartbeatAnswerCore = EffectSchema.Struct({ seen: EffectSchema.Boolean });

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

const deviceForgetAnswerCore = EffectSchema.Struct({ deleted: EffectSchema.Boolean });

export const deviceForgetAnswerSchema = deviceForgetAnswerCore;

import type { UnparsedWireValue } from "@sidecar/wire";
import { Schema as EffectSchema } from "effect";

/**
 * The device record's vocabulary: the platform a row names, the push gateway
 * its token belongs to, and the one key a briefing's notification carries.
 */

/** The platforms a device row may name. */
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
 * payload carries.
 */
export const BRIEFING_PUSH_PAYLOAD_KEY = {
  MESSAGE_ID: "messageId",
} as const;

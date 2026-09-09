import {
  isWireString,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
  type UnparsedWireValue,
} from "@sidecar/wire";

/**
 * The phone's push registration: which platforms and gateways the service
 * registers a token for, the bounds a token sits inside, and what the two
 * endpoints answer.
 */

/** The platforms whose push tokens the service registers. */
export const DEVICE_PLATFORM = {
  IOS: "ios",
} as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];

const DEVICE_PLATFORM_SET: ReadonlySet<string> = new Set(Object.values(DEVICE_PLATFORM));

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

const PUSH_ENVIRONMENT_SET: ReadonlySet<string> = new Set(Object.values(PUSH_ENVIRONMENT));

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

/** Confirms that a push registration landed. */
export interface DeviceTokenStoreAnswer {
  stored: true;
}

export const deviceTokenStoreAnswerSchema: Schema<DeviceTokenStoreAnswer> = s.record(
  { stored: s.literal(true) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** Confirms whether a sign-out found and removed the phone's registration. */
export interface DeviceTokenDeleteAnswer {
  deleted: boolean;
}

export const deviceTokenDeleteAnswerSchema: Schema<DeviceTokenDeleteAnswer> = s.record(
  { deleted: s.boolean() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/**
 * setup-place.ts -- where a new account stands in its setup after sign-in: who it is for, the step it is on, and the team's workspace once made.
 *
 * The place is the account's (`APP_SETTING_SCHEMA.setupPlace`), so setup
 * left partway on one machine resumes at the same step on another or on the
 * web. It is stored as its JSON, because a setting holds one plain value.
 */

import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

/** Who the account is set up for, as setup's first step asks, or a team's, which invited it, and asks nothing. */
export const SETUP_AUDIENCE = {
  ME: "me",
  TEAM: "team",
  INVITED: "invited",
} as const;

export type SetupAudience = (typeof SETUP_AUDIENCE)[keyof typeof SETUP_AUDIENCE];

/** The longest workspace id a place holds, well past any id the service mints. */
const SETUP_TEAM_MAX_CHARS = 200;

/** Where an account stands in setup: who it is for, the step it is on, and the team's workspace once made. */
const setupPlaceSchema = Schema.Struct({
  audience: Schema.Literals(Object.values(SETUP_AUDIENCE)),
  at: Schema.Int,
  team: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(SETUP_TEAM_MAX_CHARS))),
});

export type SetupPlace = typeof setupPlaceSchema.Type;

const setupPlaceJson = Schema.fromJsonString(setupPlaceSchema);

const decodePlace = Schema.decodeUnknownOption(setupPlaceJson);

const encodePlace = Schema.encodeSync(setupPlaceJson);

/** The place a stored value holds; nothing where it holds none. */
export function setupPlaceFrom(value: UnparsedWireValue): SetupPlace | undefined {
  return Option.getOrUndefined(decodePlace(value));
}

/** Guards a place arriving from storage or the wire, as its JSON. */
export function isSetupPlaceJson(value: UnparsedWireValue): value is string {
  return setupPlaceFrom(value) !== undefined;
}

/** A place as it is stored. */
export function setupPlaceStored(place: SetupPlace): string {
  return encodePlace(place);
}

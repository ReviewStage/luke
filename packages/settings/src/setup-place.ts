import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

export const SETUP_AUDIENCE = {
  ME: "me",
  TEAM: "team",
  INVITED: "invited",
} as const;

export type SetupAudience = (typeof SETUP_AUDIENCE)[keyof typeof SETUP_AUDIENCE];

const SETUP_TEAM_MAX_CHARS = 200;

const setupPlaceSchema = Schema.Struct({
  audience: Schema.Literals(Object.values(SETUP_AUDIENCE)),
  at: Schema.Int,
  team: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(SETUP_TEAM_MAX_CHARS))),
});

export type SetupPlace = typeof setupPlaceSchema.Type;

const setupPlaceJson = Schema.fromJsonString(setupPlaceSchema);

const decodePlace = Schema.decodeUnknownOption(setupPlaceJson);

const encodePlace = Schema.encodeSync(setupPlaceJson);

export function setupPlaceFrom(value: UnparsedWireValue): SetupPlace | undefined {
  return Option.getOrUndefined(decodePlace(value));
}

export function isSetupPlaceJson(value: UnparsedWireValue): value is string {
  return setupPlaceFrom(value) !== undefined;
}

export function setupPlaceStored(place: SetupPlace): string {
  return encodePlace(place);
}

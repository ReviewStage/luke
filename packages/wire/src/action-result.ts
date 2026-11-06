import { Result, Schema } from "effect";
import { readEither } from "./effect/json-schema.js";
import type { UnparsedWireValue } from "./json.js";
import { EXCESS_KEYS } from "./schema-vocabulary.js";

export const ACTION_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ActionResultStatus = (typeof ACTION_RESULT_STATUS)[keyof typeof ACTION_RESULT_STATUS];

export const UNKNOWN_ACTION_STATUS = "unknown";

export type UnknownActionResult = {
  readonly status: typeof UNKNOWN_ACTION_STATUS;
  readonly reason: string;
};

const ACCEPTED_ACTION_RESULT = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
});

const REJECTED_ACTION_RESULT = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.REJECTED),
  reason: Schema.String,
});

const UNSUPPORTED_ACTION_RESULT = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.UNSUPPORTED),
  reason: Schema.String,
});

const ActionResultSchema = Schema.Union([
  ACCEPTED_ACTION_RESULT,
  REJECTED_ACTION_RESULT,
  UNSUPPORTED_ACTION_RESULT,
]);

export type ActionResult = Schema.Schema.Type<typeof ActionResultSchema>;

const readsActionResult = readEither(ActionResultSchema, { excess: EXCESS_KEYS.REFUSE });

export function isActionResult(value: UnparsedWireValue): value is ActionResult {
  return Result.isSuccess(readsActionResult(value));
}

/**
 * The delegation vocabulary's fixed value set in Effect's own terms.
 * `child-records.ts` imports nothing from `effect`, so the `Schema.Literal`
 * beside its `as const` object lives here instead: the same shape
 * `queue.effect.ts` wraps its port in, reaching inside none of it.
 */
import { Schema } from "effect";
import { CHILD_RUN_STATUS } from "./child-records.js";

export const ChildRunStatusSchema = Schema.Literals(Object.values(CHILD_RUN_STATUS));

/**
 * The delegation vocabulary's fixed value sets in Effect's own terms.
 * `child-records.ts` is a port of OpenClaw `b7528507` and stays faithful to
 * it — it imports nothing from `effect` — so each `Schema.Literal` beside its
 * `as const` object lives here instead: the same shape `queue.effect.ts`
 * wraps its port in, reaching inside none of it. The port's own `is*` guards
 * stay exactly as they stand and keep being what the vocabulary door
 * re-exports; this sibling only adds the schema beside each set.
 */
import { Schema } from "effect";
import { CHILD_CLEANUP, CHILD_CONTEXT_MODE, CHILD_RUN_STATUS } from "./child-records.js";

export const ChildContextModeSchema = Schema.Literal(...Object.values(CHILD_CONTEXT_MODE));

export const ChildCleanupSchema = Schema.Literal(...Object.values(CHILD_CLEANUP));

export const ChildRunStatusSchema = Schema.Literal(...Object.values(CHILD_RUN_STATUS));

/**
 * report.ts -- a rollout worker's report handed to Luke as a turn on the plan's conversation, whether or not anyone is on a call.
 */

import { type Report, reportText } from "@sidecar/hosted/rollout-wire";
import { Effect, type Schema as EffectSchema, Option, Result } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { ASK_ORIGIN } from "../../core.js";
import { ASK_REFUSAL, type AskOutcome, type AskSeams, acceptAsk } from "../brain-ask.js";
import { openPlanConversation } from "../plan-store.js";

/**
 * A report reaches Luke the way an ask does, because it is one in every
 * respect the ask door keeps: it lands in the conversation the plan's
 * planning model runs in, opened now where the plan names none, it is
 * recorded once per conversation and key, and it is handed to the eve
 * session the conversation runs in, or the one opened for it where eve has
 * retired that session or never brought its inbox up. It opens under the
 * report's own turn kind, which the planning channel admits the deployment
 * alone to open, so the eve a caller hands in is the deployment acting for
 * the account on the planning brain's routes. The words are `reportText`'s,
 * so the line the turn receives starts with the fixed line the Work tab
 * shows above Luke's reply.
 */

/** A report as its caller hands it: the account and plan it is about, the report, and the key that makes it one report however often it is handed. */
export interface PlanReport {
  readonly userId: string;
  readonly planId: string;
  readonly report: Report;
  /**
   * The caller's own key for this report, unique in the plan's conversation:
   * a worker's tool call id, or the turn whose end the host reports. The
   * same key again answers the report already taken and hands eve nothing.
   */
  readonly clientKey: string;
}

/**
 * Hands one report to Luke on the plan's conversation. A plan the account
 * does not own is refused as not found, as an ask on a conversation it does
 * not own is; an eve that did not take the report is refused with eve's own
 * status, the record left standing for the same key to try again.
 */
export const reportToPlan = /* @__PURE__ */ Effect.fn("web/reportToPlan")(function* (
  seams: AskSeams,
  input: PlanReport,
): Effect.fn.Return<AskOutcome, SqlError | EffectSchema.SchemaError, SqlClient.SqlClient> {
  const conversation = yield* openPlanConversation(input.userId, input.planId);
  if (Option.isNone(conversation)) return Result.fail({ refusal: ASK_REFUSAL.NOT_FOUND });
  return yield* acceptAsk(seams, {
    userId: input.userId,
    question: reportText(input.report),
    origin: ASK_ORIGIN.REPORT,
    clientId: input.clientKey,
    conversationId: conversation.value,
  });
});

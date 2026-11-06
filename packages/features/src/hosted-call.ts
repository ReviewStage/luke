/**
 * hosted-call.ts -- one hosted procedure asked, answering its output or how it failed as its domain spells it, never a failure in the error channel.
 *
 * `hostedCall` is `askHosted` (`hosted-link.ts`) with the one translation
 * every domain shares: a refusal the procedure declares read as
 * `{ failure, ...the fields it carries }`, spelled as `hosted-failure.ts`
 * spells it (its slug, or the domain's rename under `as`); a refused bearer
 * read as signed out on a live read (`live`); and everything else, a
 * refusal any procedure may answer that the domain does not rename among
 * it, read as no answer with the facts of what failed beneath it as its
 * cause. A refusal the procedure does not declare never reaches here as a
 * refusal: the link reads it as no answer. The deadline and the idempotency
 * key are `askHosted`'s, handed on as they are.
 */

import type { ORPCError } from "@orpc/client";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { FailureFacts } from "./failure-facts.js";
import {
  HOSTED_CALL_FAILURE,
  type HostedFailed,
  type HostedReading,
  type HostedRenames,
  spelledFailure,
} from "./hosted-failure.js";
import {
  askHosted,
  type HostedDeadline,
  type HostedFailure,
  type HostedProcedure,
  hostedFailureFacts,
} from "./hosted-link.js";
import { LIVE_SIGNED_OUT } from "./live-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/** How one call is asked and its failure read. */
export interface HostedCallOptions<As extends HostedRenames, Live extends boolean>
  extends HostedReading<As, Live> {
  /** How long its answer may take; the usual deadline where none is named. */
  readonly deadline?: HostedDeadline;
  /** The key a write is sent under, on every attempt (`IDEMPOTENCY_KEY`). */
  readonly idempotencyKey?: string;
}

/** The refusals a procedure's client says it may fail with, by the slug each is coded as. */
type DeclaredBy<Failure> =
  Failure extends ORPCError<infer Code, infer _Data> ? Code & HostedApiError : never;

/** A call's failure as its domain reads it. */
function failedOf(
  failed: HostedFailure,
  reading: HostedReading<HostedRenames, boolean>,
): { readonly failure: string; readonly cause?: FailureFacts } {
  if (failed._tag === "HostedRefused") {
    if (reading.live === true && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN) {
      return LIVE_SIGNED_OUT;
    }
    const failure = spelledFailure(failed.refusal, reading);
    if (failure !== undefined) return { ...failed.data, failure };
  }
  return { failure: HOSTED_CALL_FAILURE.UNANSWERED, cause: hostedFailureFacts(failed) };
}

/**
 * One procedure asked on the calling fiber's services: its output, or how
 * it failed as its domain spells it (`HostedFailed`), typed from the
 * refusals the procedure's contract declares.
 */
export function hostedCall<
  Input,
  Output,
  Failure,
  const As extends HostedRenames = Readonly<Record<never, never>>,
  Live extends boolean = false,
>(
  procedure: HostedProcedure<Input, Output, Failure>,
  input: Input,
  options: HostedCallOptions<As, Live> = {},
): Effect.Effect<
  Output | HostedFailed<DeclaredBy<Failure>, As, Live>,
  never,
  HttpClient.HttpClient
> {
  return Effect.catch(
    askHosted(procedure, input, options.deadline, options.idempotencyKey),
    (failed) =>
      // SAFETY: `failedOf` spells the failure as `HostedFailed` types it, from the refusals the link let through, which are the procedure's declared ones.
      Effect.succeed(failedOf(failed, options) as HostedFailed<DeclaredBy<Failure>, As, Live>),
  );
}

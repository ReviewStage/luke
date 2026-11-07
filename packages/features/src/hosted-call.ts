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
 *
 * A live read may be polled (`poll`): asked for its rows inline, and, past
 * where they last stood (`after`), held until they move, under the held
 * deadline. `askLiveRead` asks a declared live read (`live-read.ts`) so.
 */

import type { ORPCError } from "@orpc/client";
import type { ORPCErrorFromErrorMap } from "@orpc/contract";
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
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedDeadline,
  type HostedFailure,
  type HostedProcedure,
  hostedFailureFacts,
  type LivePollInput,
} from "./hosted-link.js";
import type { AnyLiveRead, LiveReadAnswer, LiveReadAsked } from "./live-read.js";
import { LIVE_POLL, LIVE_SIGNED_OUT } from "./live-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/** How a live read is polled: its rows inline, held until they move past `after` where it names where they last stood. */
export interface HostedPoll {
  readonly after?: string | undefined;
}

/** How one call is asked and its failure read. */
export interface HostedCallOptions<As extends HostedRenames, Live extends boolean, Input = unknown>
  extends HostedReading<As, Live> {
  /** How long its answer may take; the usual deadline where none is named, or the held one for a poll held past `after`. */
  readonly deadline?: HostedDeadline;
  /** The key a write is sent under, on every attempt (`IDEMPOTENCY_KEY`). */
  readonly idempotencyKey?: string;
  /** The poll a live read is asked as; only a procedure whose input names a poll takes one. */
  readonly poll?: Input extends LivePollInput ? HostedPoll : never;
}

/** No renames. */
type NoRenames = Readonly<Record<never, never>>;

/** The refusals a procedure's client says it may fail with, by the slug each is coded as. */
type DeclaredBy<Failure> =
  Failure extends ORPCError<infer Code, infer _Data> ? Code & HostedApiError : never;

/** The input a poll asks with: the rows inline, past `after` where it names one. */
function polledInput<Input>(input: Input, poll: HostedPoll | undefined): Input {
  if (poll === undefined) return input;
  return {
    ...input,
    [LIVE_POLL.QUERY]: LIVE_POLL.ON,
    ...(poll.after === undefined ? undefined : { [LIVE_POLL.AFTER]: poll.after }),
  };
}

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
  options: HostedCallOptions<As, Live, Input> = {},
): Effect.Effect<
  Output | HostedFailed<DeclaredBy<Failure>, As, Live>,
  never,
  HttpClient.HttpClient
> {
  const { poll } = options;
  const held = poll?.after === undefined ? undefined : HOSTED_DEADLINE.HELD;
  return Effect.catch(
    askHosted(
      procedure,
      polledInput(input, poll),
      options.deadline ?? held,
      options.idempotencyKey,
    ),
    (failed) =>
      // SAFETY: `failedOf` spells the failure as `HostedFailed` types it, from the refusals the link let through, which are the procedure's declared ones.
      Effect.succeed(failedOf(failed, options) as HostedFailed<DeclaredBy<Failure>, As, Live>),
  );
}

/**
 * A declared live read asked for the params it is bound to, sealed for
 * following, or polled where `poll` asks: its answer, signed out where the
 * session is another account's, or how it failed as its declaration's
 * refusals spell it, each renamed where `as` names it, as a domain that
 * shipped another spelling, or read a refusal any procedure may answer as
 * its own, reads it.
 */
export function askLiveRead<Read extends AnyLiveRead, As extends HostedRenames = NoRenames>(
  live: HostedClient["live"],
  read: Read,
  params: LiveReadAsked<Read>,
  poll?: HostedPoll,
  as?: As,
): Effect.Effect<
  LiveReadAnswer<Read> | HostedFailed<DeclaredBy<ORPCErrorFromErrorMap<Read["errors"]>>, As, true>,
  never,
  HttpClient.HttpClient
> {
  // SAFETY: the live contract's procedure under a declared read's name is `liveProcedure` of that declaration (`contract/live.ts`), which the live reads' contract test holds.
  const procedure = live[read.name as keyof HostedClient["live"]] as unknown as HostedProcedure<
    LivePollInput,
    LiveReadAnswer<Read>,
    ORPCErrorFromErrorMap<Read["errors"]>
  >;
  // SAFETY: a read's params are the fields of its input its mode's poll fields stand beside, each as text.
  const input = params as LivePollInput;
  return hostedCall(procedure, input, {
    live: true,
    ...(poll === undefined ? {} : { poll }),
    ...(as === undefined ? {} : { as }),
  });
}

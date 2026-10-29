/**
 * failure-report.ts -- every failure the panel shows a person, handed with whether something named it and the app's state to whatever reports the window's failures, or to no one.
 *
 * A failure is shown by an error toast (`toast.tsx`), whose notice cannot be
 * built without the failure it says, or by a failure drawn in place of what
 * could not be (`FailureNote`), which takes it the same way; each hands it
 * here as it is shown, so no failure reaches a screen unreported. The
 * window's shell installs the reporter: the desktop's windows and the web's
 * tab answer it with their Sentry SDK (`@luke/features/shown-failure`),
 * which sends a log line for every failure and an issue besides for one
 * nothing named. A window with no reporter, a test's, reports nothing,
 * which is why this is a door of its own rather than a capability every
 * shell must answer, as `panel-spans.ts` is.
 *
 * What is handed on is what the failure names and nothing it does not:
 * where it was shown, the act it answered, its cause, the ids it was about,
 * and the app's state read here, whether the machine was online and where
 * the account stood. Note that nothing a person typed has a field to travel
 * in.
 */

import { AGENT_CALL_FAILURE } from "@luke/features/agent-view";
import {
  FAILURE_KIND,
  type FailureAbout,
  type FailureKind,
  type FailureSurface,
  type ShownFailureReport,
} from "@luke/features/shown-failure";
import { ACT_ERROR, type PortActKind } from "@luke/host/contract";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { ORPCError } from "@orpc/client";
import { Predicate } from "effect";
import { appStateNow } from "./use-app-state.js";

/**
 * A failure the panel shows: the surface showing it, what failed, and what
 * it was about. `cause` is what failed as it was caught or answered: an
 * error, a refused act's answer, or a failure value a read answered.
 */
export interface ShownFailure {
  readonly surface: FailureSurface;
  readonly cause: unknown;
  readonly about?: FailureAbout;
  /** The act whose failure this is, where an act failed. */
  readonly act?: PortActKind;
  /** Whether something named it as a refusal, where the cause alone cannot say so. */
  readonly refused?: true;
  /** The live stream's state as it was shown, where one stands under the surface. */
  readonly live?: string;
}

/** What a shell reports a shown failure through. */
export type ShownFailureReporter = (report: ShownFailureReport) => void;

/** The account's state where no document has been read yet. */
const ACCOUNT_UNREAD = "unread";

/** The answers an act refuses with: refused, or not supported where it was asked. */
const REFUSED_ANSWERS: ReadonlySet<unknown> = new Set([
  ACTION_RESULT_STATUS.REJECTED,
  ACTION_RESULT_STATUS.UNSUPPORTED,
]);

/**
 * The failures a client's answer names where the service, or GitHub behind
 * it, never answered: unexpected, where every other failure an answer names
 * is a refusal the service worded. Note that every client spells them as the
 * agents' client does.
 */
const UNANSWERED_FAILURES: ReadonlySet<unknown> = new Set([
  AGENT_CALL_FAILURE.UNANSWERED,
  AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
]);

/** How deep a cause's chain is searched for the act port's refusal. */
const CHAIN_BOUND = 5;

let reporter: ShownFailureReporter | undefined;

/** Whether `cause`, or a cause beneath it, is the act port's declared refusal. */
function carriesRefusal(cause: unknown): boolean {
  let next = cause;
  for (let depth = 0; depth < CHAIN_BOUND && next !== undefined; depth++) {
    if (next instanceof ORPCError && next.code === ACT_ERROR.REFUSED) return true;
    next = Predicate.hasProperty(next, "cause") ? next.cause : undefined;
  }
  return false;
}

/** Whether a client's answer names a failure the service worded, rather than none it could answer. */
function namesRefusal(cause: unknown): boolean {
  if (!Predicate.hasProperty(cause, "failure")) return false;
  return Predicate.isString(cause.failure) && !UNANSWERED_FAILURES.has(cause.failure);
}

/**
 * Whether a failure was named, and so expected: one its surface says was
 * refused, an act's answer that refused it, a client's answer naming a
 * failure the service worded, or the act port's refusal; any other failure
 * is unexpected.
 */
function kindOf(failure: ShownFailure): FailureKind {
  const { cause } = failure;
  const answered = Predicate.hasProperty(cause, "status") && REFUSED_ANSWERS.has(cause.status);
  return failure.refused === true || answered || namesRefusal(cause) || carriesRefusal(cause)
    ? FAILURE_KIND.REFUSED
    : FAILURE_KIND.UNEXPECTED;
}

/** Installs what this window reports its shown failures through, and answers what takes it back. */
export function installShownFailureReporter(installed: ShownFailureReporter): () => void {
  reporter = installed;
  return () => {
    if (reporter === installed) reporter = undefined;
  };
}

/**
 * Hands one failure just shown to the window's reporter, with the app's
 * state now; a window with none reports nothing. Note that a report that
 * throws is let go with a line on the console, because whoever showed the
 * failure is showing it as this runs, and the person must still see it.
 */
export function reportShownFailure(failure: ShownFailure): void {
  if (reporter === undefined) return;
  try {
    const state = appStateNow();
    reporter({
      surface: failure.surface,
      kind: kindOf(failure),
      cause: failure.cause,
      about: failure.about ?? {},
      act: failure.act,
      state: {
        online: state?.network.online ?? true,
        account: state?.account.status ?? ACCOUNT_UNREAD,
        live: failure.live,
      },
    });
  } catch (error) {
    console.error("A failure shown could not be reported.", error);
  }
}

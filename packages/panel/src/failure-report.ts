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
 *
 * Each report answers the details a person may copy from what showed the
 * failure (`shownFailureDetails`): the same facts, with the time, the app's
 * version, and the Sentry event id and trace the reporter answered, so what
 * they paste to an agent finds the very line and issue that were sent.
 *
 * A failure drawn in place (`@luke/ui`'s `ErrorState`, `FailureNote`,
 * `ErrorLine` and the rows and dialogs that draw one) is handed as
 * `failureShown` answers it, and stands for as long as what failed does,
 * drawn again on every render and on every remount, such as a tab switched
 * away and back. So it is reported once, as it first stands, and again only
 * for another failure, or for the same one come back. A failure is the same
 * one while it was shown on the same surface, about the same ids, with the
 * same cause: the very object, where the cause is an error or an answer,
 * since each failure caught is a fresh one; or the same condition, where a
 * site names one in its place. A site that names only a condition cannot
 * tell a remount of its standing failure from the failure come back, so a
 * failure no component has shown for `LAPSE` is taken for a new one: a
 * remount within it reports nothing, and a return after it is reported. A
 * cause built afresh as the site draws would be a fresh failure on every
 * render, so a site hands the cause it holds, never one it builds.
 */

import { AGENT_CALL_FAILURE } from "@luke/features/agent-view";
import {
  FAILURE_CONDITION,
  FAILURE_KIND,
  FAILURE_SURFACE,
  type FailureAbout,
  type FailureKind,
  type FailureSurface,
  type ShownFailureReport,
  type ShownFailureSent,
  shownFailureDetails,
} from "@luke/features/shown-failure";
import { ACT_ERROR, type PortActKind } from "@luke/host/contract";
import type { ConfirmFailure } from "@luke/ui/confirm-state";
import type { PictureUnread } from "@luke/ui/picture-cache";
import type { ReportedFailure, ShownError } from "@luke/ui/reported-failure";
import type { SettingRefusal } from "@luke/ui/use-setting-write";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { ORPCError } from "@orpc/client";
import { Clock, Context, Predicate } from "effect";
import type { ReactNode } from "react";
import { appPlatform } from "./app-platform.js";
import { rendererServicesNow } from "./renderer-runtime.js";
import { appStateNow } from "./use-app-state.js";

/**
 * A failure the panel shows: the surface showing it, what failed, and what
 * it was about. `cause` is what failed as it was caught or answered: an
 * error, a refused act's answer, or a failure value a read answered.
 */
export interface ShownFailure {
  readonly surface: FailureSurface;
  readonly cause: unknown;
  readonly about?: FailureAbout | undefined;
  /** The act whose failure this is, where an act failed. */
  readonly act?: PortActKind;
  /** Whether something named it as a refusal, where the cause alone cannot say so. */
  readonly refused?: true;
  /** The live stream's state as it was shown, where one stands under the surface. */
  readonly live?: string;
}

/** What a shell reports a shown failure through, answering what Sentry answered where its SDK stands. */
export type ShownFailureReporter = (report: ShownFailureReport) => ShownFailureSent | undefined;

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

/** How long a failure drawn in place stays the same one once no component shows it; past it, it is a new one. */
const LAPSE_MS = 5 * 60 * 1000;

/** How many failures drawn in place are kept, as the ones they are, before the longest unseen is let go. */
const KEPT_BOUND = 200;

/** Every id a failure may be about, which two failures must agree on to be the same. */
const ABOUT_KEYS = [
  "workspaceId",
  "taskId",
  "agentId",
  "conversationId",
  "turnId",
  "inboxItemId",
  "automationId",
  "channelId",
  "pullRequest",
] as const satisfies readonly (keyof FailureAbout)[];

/** A failure drawn in place as it is kept: the failure, and what the component showing it was handed. */
interface KeptFailure {
  readonly failure: ShownFailure;
  readonly reported: ReportedFailure;
}

let reporter: ShownFailureReporter | undefined;

/** The failures drawn in place, the one seen last at the end. */
let kept: readonly KeptFailure[] = [];

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
 * is unexpected. An act's refused answer that carries what failed beneath
 * it is judged by that.
 */
function kindOf(failure: ShownFailure): FailureKind {
  const { cause } = failure;
  const answered = Predicate.hasProperty(cause, "status") && REFUSED_ANSWERS.has(cause.status);
  // Note that a refused answer settled from what failed beneath it, an act that never arrived among them, is judged by what is beneath.
  if (answered && Predicate.hasProperty(cause, "cause") && cause.cause !== undefined) {
    return kindOf({ ...failure, cause: cause.cause });
  }
  return failure.refused === true || answered || namesRefusal(cause) || carriesRefusal(cause)
    ? FAILURE_KIND.REFUSED
    : FAILURE_KIND.UNEXPECTED;
}

/** Whether `one` and `other` are the same failure: shown on the same surface, about the same ids, with the same cause. */
function sameFailure(one: ShownFailure, other: ShownFailure): boolean {
  const about = one.about ?? {};
  const otherAbout = other.about ?? {};
  return (
    one.surface === other.surface &&
    Object.is(one.cause, other.cause) &&
    ABOUT_KEYS.every((key) => about[key] === otherAbout[key])
  );
}

/** The time now on the window's clock, which a test turns by hand. */
function now(): number {
  return Context.get(rendererServicesNow(), Clock.Clock).currentTimeMillisUnsafe();
}

/**
 * What a component showing `failure` is handed: reported the first time it
 * says it stands, answering the same details every time after while it
 * stands, and reported anew once it stood unshown for `LAPSE_MS`.
 */
function keptFailure(failure: ShownFailure): ReportedFailure {
  let details: { readonly copied: string | undefined } | undefined;
  let standing = 0;
  let hiddenAt: number | undefined;
  return {
    shown: () => {
      const at = now();
      const lapsed = standing === 0 && hiddenAt !== undefined && at - hiddenAt >= LAPSE_MS;
      if (details === undefined || lapsed) details = { copied: reportShownFailure(failure, at) };
      standing += 1;
      hiddenAt = undefined;
      return details.copied;
    },
    hidden: () => {
      standing = Math.max(0, standing - 1);
      if (standing === 0) hiddenAt = now();
    },
    copy: (text) => appPlatform().copyText(text),
  };
}

/**
 * A failure drawn in place, as its component takes it: the same one for as
 * long as it is the same failure, so it is reported once, as it first
 * stands, however often it is drawn, and anew for another. Note that it may
 * be called as a component renders, because it only finds or keeps.
 */
export function failureShown(failure: ShownFailure): ReportedFailure {
  const found = kept.find((one) => sameFailure(one.failure, failure));
  const entry = found ?? { failure, reported: keptFailure(failure) };
  kept = [...kept.filter((one) => one !== found), entry].slice(-KEPT_BOUND);
  return entry.reported;
}

/** A read that answered nothing to show on `surface`, about `about`, drawn in place, which names no cause of its own. */
export function unreadShown(surface: FailureSurface, about?: FailureAbout): ReportedFailure {
  return failureShown({ surface, cause: FAILURE_CONDITION.UNREAD, about });
}

/** A picture's read that did not land, as the place drawing it reports it. */
export function pictureUnread(unread: PictureUnread): ReportedFailure {
  return failureShown({ surface: FAILURE_SURFACE.PICTURE_READ, cause: unread });
}

/** What a confirmed act refused on `surface`, about `about`, is reported as: the answer that refused it. */
export function confirmFailure(surface: FailureSurface, about?: FailureAbout): ConfirmFailure {
  return (refused) => failureShown({ surface, cause: refused, about });
}

/** A setting's refused write on `surface`, as its row says it: its words, and the answer or error that refused it. */
export function refusalShown(
  refusal: SettingRefusal | undefined,
  surface: FailureSurface,
  about?: FailureAbout,
): ShownError | undefined {
  if (refusal === undefined) return undefined;
  return { words: refusal.words, failure: failureShown({ surface, cause: refusal.cause, about }) };
}

/**
 * A refusal a site holds only as its words, on `surface`, about `about`, as
 * a line says it: the words, and the refusal reported under its condition,
 * never under the words, which may name what a person wrote; or nothing
 * while the words say nothing.
 */
export function refusedShown(
  words: ReactNode,
  surface: FailureSurface,
  about?: FailureAbout,
): ShownError | undefined {
  if (words === undefined || words === null || words === false || words === "") return undefined;
  const failure = failureShown({ surface, cause: FAILURE_CONDITION.REFUSED, about, refused: true });
  return { words, failure };
}

/** Installs what this window reports its shown failures through, and answers what takes it back. */
export function installShownFailureReporter(installed: ShownFailureReporter): () => void {
  reporter = installed;
  return () => {
    if (reporter === installed) reporter = undefined;
  };
}

/** Sends `report` through the window's reporter, where it has one; a report that throws answers nothing. */
function sent(report: ShownFailureReport): ShownFailureSent | undefined {
  try {
    return reporter?.(report);
  } catch (error) {
    console.error("A failure shown could not be reported.", error);
    return undefined;
  }
}

/**
 * Hands one failure just shown at `at` to the window's reporter, with the
 * app's state now, and answers the details a person may copy of it; a
 * window with no reporter reports nothing and answers them without what
 * Sentry would have answered. Note that a report or a reading that throws is
 * let go with a line on the console, answering no details, because whoever
 * showed the failure is showing it as this runs, and the person must still
 * see it.
 */
export function reportShownFailure(failure: ShownFailure, at: number): string | undefined {
  try {
    const state = appStateNow();
    const report: ShownFailureReport = {
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
    };
    return shownFailureDetails(report, { at, version: state?.run.appVersion, sent: sent(report) });
  } catch (error) {
    console.error("A failure shown could not be reported.", error);
    return undefined;
  }
}

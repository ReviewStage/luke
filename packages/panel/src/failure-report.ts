import { ORPCError } from "@orpc/client";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
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
} from "@repo/features/shown-failure";
import { networkConnected } from "@repo/host/app-state";
import { ACT_ERROR, type PortActKind } from "@repo/host/contract";
import type { ConfirmFailure } from "@repo/ui/confirm-state";
import type { PictureUnread } from "@repo/ui/picture-read";
import type { ReportedFailure, ShownError } from "@repo/ui/reported-failure";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Clock, Context, Predicate } from "effect";
import type { ReactNode } from "react";
import { appPlatform } from "./app-platform.js";
import { rendererServicesNow } from "./renderer-runtime.js";
import type { SettingRefusal } from "./settings/row-write.js";
import { appStateNow } from "./use-app-state.js";

export interface ShownFailure {
  readonly surface: FailureSurface;
  readonly cause: unknown;
  readonly about?: FailureAbout | undefined;
  readonly act?: PortActKind;
  readonly refused?: true;
  readonly live?: string;
}

export type ShownFailureReporter = (report: ShownFailureReport) => ShownFailureSent | undefined;

const ACCOUNT_UNREAD = "unread";

const REFUSED_ANSWERS: ReadonlySet<unknown> = new Set([
  ACTION_RESULT_STATUS.REJECTED,
  ACTION_RESULT_STATUS.UNSUPPORTED,
]);

const UNANSWERED_FAILURES: ReadonlySet<unknown> = new Set([
  AGENT_CALL_FAILURE.UNANSWERED,
  AGENT_CALL_FAILURE.GITHUB_UNANSWERED,
]);

const CHAIN_BOUND = 5;

const LAPSE_MS = 5 * 60 * 1000;

const KEPT_BOUND = 200;

const ABOUT_KEYS = [
  "workspaceId",
  "taskId",
  "agentId",
  "conversationId",
  "turnId",
  "callId",
  "inboxItemId",
  "automationId",
  "pullRequest",
] as const satisfies readonly (keyof FailureAbout)[];

interface KeptFailure {
  readonly failure: ShownFailure;
  readonly reported: ReportedFailure;
}

let reporter: ShownFailureReporter | undefined;

let kept: readonly KeptFailure[] = [];

function carriesRefusal(cause: unknown): boolean {
  let next = cause;
  for (let depth = 0; depth < CHAIN_BOUND && next !== undefined; depth++) {
    if (next instanceof ORPCError && next.code === ACT_ERROR.REFUSED) return true;
    next = Predicate.hasProperty(next, "cause") ? next.cause : undefined;
  }
  return false;
}

function namesRefusal(cause: unknown): boolean {
  if (!Predicate.hasProperty(cause, "failure")) return false;
  return Predicate.isString(cause.failure) && !UNANSWERED_FAILURES.has(cause.failure);
}

function kindOf(failure: ShownFailure): FailureKind {
  const { cause } = failure;
  const answered = Predicate.hasProperty(cause, "status") && REFUSED_ANSWERS.has(cause.status);
  if (answered && Predicate.hasProperty(cause, "cause") && cause.cause !== undefined) {
    return kindOf({ ...failure, cause: cause.cause });
  }
  return failure.refused === true || answered || namesRefusal(cause) || carriesRefusal(cause)
    ? FAILURE_KIND.REFUSED
    : FAILURE_KIND.UNEXPECTED;
}

function sameFailure(one: ShownFailure, other: ShownFailure): boolean {
  const about = one.about ?? {};
  const otherAbout = other.about ?? {};
  return (
    one.surface === other.surface &&
    Object.is(one.cause, other.cause) &&
    ABOUT_KEYS.every((key) => about[key] === otherAbout[key])
  );
}

function now(): number {
  return Context.get(rendererServicesNow(), Clock.Clock).currentTimeMillisUnsafe();
}

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

export function failureShown(failure: ShownFailure): ReportedFailure {
  const found = kept.find((one) => sameFailure(one.failure, failure));
  const entry = found ?? { failure, reported: keptFailure(failure) };
  kept = [...kept.filter((one) => one !== found), entry].slice(-KEPT_BOUND);
  return entry.reported;
}

export function unreadShown(surface: FailureSurface, about?: FailureAbout): ReportedFailure {
  return failureShown({ surface, cause: FAILURE_CONDITION.UNREAD, about });
}

export function pictureUnread(unread: PictureUnread): ReportedFailure {
  return failureShown({ surface: FAILURE_SURFACE.PICTURE_READ, cause: unread });
}

export function confirmFailure(surface: FailureSurface, about?: FailureAbout): ConfirmFailure {
  return (refused) => failureShown({ surface, cause: refused, about });
}

export function refusalShown(
  refusal: SettingRefusal | undefined,
  surface: FailureSurface,
  about?: FailureAbout,
): ShownError | undefined {
  if (refusal === undefined) return undefined;
  return { words: refusal.words, failure: failureShown({ surface, cause: refusal.cause, about }) };
}

export function refusedShown(
  words: ReactNode,
  surface: FailureSurface,
  about?: FailureAbout,
): ShownError | undefined {
  if (words === undefined || words === null || words === false || words === "") return undefined;
  const failure = failureShown({ surface, cause: FAILURE_CONDITION.REFUSED, about, refused: true });
  return { words, failure };
}

export function failureOfConnection(failure: ShownFailure): boolean {
  if (kindOf(failure) === FAILURE_KIND.REFUSED) return false;
  const state = appStateNow();
  return state !== undefined && !networkConnected(state.network);
}

export function installShownFailureReporter(installed: ShownFailureReporter): () => void {
  reporter = installed;
  return () => {
    if (reporter === installed) reporter = undefined;
  };
}

function sent(report: ShownFailureReport): ShownFailureSent | undefined {
  try {
    return reporter?.(report);
  } catch (error) {
    console.error("A failure shown could not be reported.", error);
    return undefined;
  }
}

export function reportShownFailure(failure: ShownFailure, at: number): string | undefined {
  if (reporter === undefined) return undefined;
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
    const told = { at, version: state?.run.appVersion, sent: sent(report) };
    return report.kind === FAILURE_KIND.UNEXPECTED ? shownFailureDetails(report, told) : undefined;
  } catch (error) {
    console.error("A failure shown could not be reported.", error);
    return undefined;
  }
}

import { GITHUB_FAILURE, type GitHubRepository } from "@sidecar/hosted/github-wire";
import type { Plan, PlanDocument, PlanRepository } from "@sidecar/hosted/plan-wire";
import {
  type GitHubCallFailure,
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "#shared/messages/audio";
import type { VoiceView } from "#shared/messages/voice-view";
import { planMarkdown } from "#shared/plan-markdown";
import { microphoneAccessRow, VOICE_KEYLESS_NOTE } from "../microphone-access";

/**
 * planning-model.ts -- what the panel's Plans tab draws, decided from the document and the voice view alone.
 *
 * Every decision the tab makes is here and pure, so the components only lay
 * it out: which page shows, which state the document region is in, how a
 * repository and its commit read in the header, what a GitHub refusal tells
 * the developer to do, what Copy shows, and the word beside the microphone.
 */

/** What the assumptions' section says while the list is empty, the words Copy writes there. */
export const NO_ASSUMPTIONS_LINE = "None recorded";

/** How many characters of a commit the header shows, the length `git` abbreviates to. */
const SHORT_COMMIT_CHARS = 7;

/** Which of the Plans tab's pages shows. */
export const PLANS_PAGE = {
  /** Every plan the account owns, and New plan. */
  LIST: "list",
  /** The new plan's name, repository, and Connect GitHub. */
  NEW: "new",
  /** The open plan's saved document and its microphone. */
  DOCUMENT: "document",
} as const;

export type PlansPage = (typeof PLANS_PAGE)[keyof typeof PLANS_PAGE];

/**
 * The page the tab shows. An open plan is the document page, in every panel
 * alike, because the plan open is the host's and not one panel's: it stands
 * until the developer leaves it, whatever tab or shape the panel is in.
 * With none open, the new-plan form shows while this panel is composing one.
 */
export function plansPage(view: PlanningView, composing: boolean): PlansPage {
  if (view.activePlanId !== undefined) return PLANS_PAGE.DOCUMENT;
  return composing ? PLANS_PAGE.NEW : PLANS_PAGE.LIST;
}

/** Which state the document region draws. */
export const DOCUMENT_REGION = {
  /** No plan is open: the tab shows the list instead. */
  NONE: "none",
  READING: "reading",
  /** The saved document, read. */
  READY: "ready",
  /** The read failed and nothing is held: the failure and Try again. */
  FAILED: "failed",
  /** The plan is gone. */
  MISSING: "missing",
} as const;

export type DocumentRegion =
  | { readonly kind: typeof DOCUMENT_REGION.NONE }
  | { readonly kind: typeof DOCUMENT_REGION.READING }
  | { readonly kind: typeof DOCUMENT_REGION.READY; readonly plan: Plan }
  | { readonly kind: typeof DOCUMENT_REGION.FAILED }
  | { readonly kind: typeof DOCUMENT_REGION.MISSING };

/**
 * The document region's state. The tab never draws a document it did not
 * read: a plan is drawn only when the held document is the active plan's.
 */
export function documentRegion(view: PlanningView): DocumentRegion {
  const { activePlanId, document } = view;
  if (activePlanId === undefined) return { kind: DOCUMENT_REGION.NONE };
  if (document.status === PLANNING_READ.MISSING) return { kind: DOCUMENT_REGION.MISSING };
  const plan = document.plan;
  if (plan !== undefined && plan.id === activePlanId) return { kind: DOCUMENT_REGION.READY, plan };
  if (document.status === PLANNING_READ.FAILED) return { kind: DOCUMENT_REGION.FAILED };
  return { kind: DOCUMENT_REGION.READING };
}

/** The header's repository line: `owner/name · branch @ short commit`. */
export function repositoryLine(repository: PlanRepository): string {
  const commit = repository.commit.slice(0, SHORT_COMMIT_CHARS);
  return `${repository.owner}/${repository.name} · ${repository.branch} @ ${commit}`;
}

/** What the Copy button shows: its resting glyph, the check mark, or the failure beside it. */
export const COPY_SHOWN = {
  IDLE: "idle",
  COPIED: "copied",
  FAILED: "failed",
} as const;

export type CopyShown = (typeof COPY_SHOWN)[keyof typeof COPY_SHOWN];

/** What the last Copy press came to, and the Markdown it handed the clipboard. */
export interface CopyOutcome {
  readonly shown: typeof COPY_SHOWN.COPIED | typeof COPY_SHOWN.FAILED;
  readonly words: string;
}

/** The sentence the header shows when the clipboard refused the copy. */
export const COPY_FAILED_NOTE = "The plan could not be copied to the clipboard. Try again.";

/**
 * Copies the document as Markdown through the clipboard the caller hands in,
 * and answers what came of it. A refusal from the clipboard is the failed
 * outcome, never a rejection, so the header always has something to show.
 */
export async function copyPlanDocument(
  document: PlanDocument,
  writeClipboard: (words: string) => Promise<void>,
): Promise<CopyOutcome> {
  const words = planMarkdown(document);
  try {
    await writeClipboard(words);
    return { shown: COPY_SHOWN.COPIED, words };
  } catch {
    return { shown: COPY_SHOWN.FAILED, words };
  }
}

/**
 * What Copy shows for the document drawn now. An outcome speaks only for the
 * text it copied: once a save changes the document, the check mark no longer
 * says what the clipboard holds, so the button returns to its resting glyph.
 * Note that we compare the text rather than the document object, because
 * every snapshot main sends is a fresh copy of the same document.
 */
export function copyShown(outcome: CopyOutcome | undefined, document: PlanDocument): CopyShown {
  return outcome !== undefined && outcome.words === planMarkdown(document)
    ? outcome.shown
    : COPY_SHOWN.IDLE;
}

/**
 * A run of reads where only the newest one's answer is applied: an answer
 * from a read that another read has since replaced is dropped, whenever it
 * lands. A read that fails applies nothing.
 */
export function newestReadOnly<A>(): (read: Promise<A>, apply: (answer: A) => void) => void {
  let newest = 0;
  return (read, apply) => {
    newest += 1;
    const mine = newest;
    read.then(
      (answer) => {
        if (mine === newest) apply(answer);
      },
      () => undefined,
    );
  };
}

/**
 * Runs `returned` each time the panel takes focus again, which is the
 * developer coming back from the Connect GitHub page in the browser, perhaps
 * before the link finished. Answers the cancel, for a wait that ended.
 */
export function onEachReturn(window: EventTarget, returned: () => void): () => void {
  window.addEventListener("focus", returned);
  return () => window.removeEventListener("focus", returned);
}

/** Whether the new-plan form should offer to connect GitHub rather than a list. */
export function offersGitHubConnect(failure: GitHubCallFailure): boolean {
  return failure === GITHUB_FAILURE.NOT_CONNECTED || failure === GITHUB_FAILURE.ACCESS_DENIED;
}

/** What a GitHub refusal tells the developer, in the new-plan form's words. */
export function githubFailureNote(failure: GitHubCallFailure): string {
  switch (failure) {
    case GITHUB_FAILURE.NOT_CONNECTED:
      return "Connect GitHub to choose a repository.";
    case GITHUB_FAILURE.ACCESS_DENIED:
      return "GitHub no longer accepts Luke's connection. Connect GitHub again.";
    case GITHUB_FAILURE.NOT_FOUND:
      return "That repository could not be read. It may be gone, or the connection cannot see it.";
    case GITHUB_FAILURE.EMPTY_REPOSITORY:
      return "That repository has no commits on its default branch to plan against.";
    case GITHUB_FAILURE.RATE_LIMITED:
      return "GitHub is limiting requests right now. Try again in a minute.";
    case GITHUB_FAILURE.FAILED:
      return "GitHub could not be reached. Try again.";
    case PLAN_CALL_FAILURE.UNANSWERED:
      return "Luke's service could not be reached. Try again.";
  }
}

/** The repositories whose `owner/name` holds the filter, case-blind; the filter narrows and nothing else. */
export function repositoriesMatching(
  repositories: readonly GitHubRepository[],
  filter: string,
): readonly GitHubRepository[] {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return repositories;
  return repositories.filter((repository) =>
    `${repository.owner}/${repository.name}`.toLowerCase().includes(needle),
  );
}

/** The status word beside the microphone for a call, or nothing where none stands. */
const STATUS_WORD = {
  [LIVE_STATUS.UNAVAILABLE]: undefined,
  [LIVE_STATUS.IDLE]: undefined,
  [LIVE_STATUS.CONNECTING]: "Connecting",
  [LIVE_STATUS.MUTED]: "Muted",
  [LIVE_STATUS.LISTENING]: "Listening",
  [LIVE_STATUS.SPEAKING]: "Speaking",
  [LIVE_STATUS.CLOSING]: "Closing",
  [LIVE_STATUS.FAILED]: undefined,
} as const satisfies Record<LiveStatus, string | undefined>;

/**
 * The word beside the microphone: the call's status while one stands about
 * the open plan, and nothing otherwise. A voice error or notice is not
 * repeated here, since the panel's own strip already carries it under the
 * shape, exactly as it does for any call.
 */
export function microphoneStatusWord(
  view: Pick<VoiceView, "voiceStatus" | "callPlanId">,
  activePlanId: string | undefined,
): string | undefined {
  if (activePlanId === undefined || view.callPlanId !== activePlanId) return undefined;
  return STATUS_WORD[view.voiceStatus];
}

/** What the microphone button does when pressed. */
export const MICROPHONE_PRESS = {
  /** Nothing: voice cannot run, or no plan is open. */
  NONE: "none",
  /** Raises macOS's own microphone prompt. */
  ASK_ACCESS: "ask-access",
  /** Opens System Settings, the one place a denial can be changed. */
  OPEN_SETTINGS: "open-settings",
  /** Talks to Luke about the open plan: opens the plan's call and hears it, or toggles its microphone. */
  TALK: "talk",
} as const;

type MicrophonePress = (typeof MICROPHONE_PRESS)[keyof typeof MICROPHONE_PRESS];

export interface MicrophoneButton {
  readonly press: MicrophonePress;
  /** The button's name for a reader and its hover. */
  readonly label: string;
}

/**
 * The microphone button, from what voice can run on and which plan is open.
 * The microphone permission comes first, on the panel's own rules, because a
 * press that cannot be heard is no press; then the plan, since a call is
 * always about the open plan. The press toggles: while the developer is
 * heard on this plan's own call it mutes, and otherwise it opens the plan's
 * call or hears it again, hanging up a desk call or another plan's first,
 * which is also how a call that failed or was lost is tried again.
 */
export function microphoneButton(input: {
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  activePlanId: string | undefined;
  listening: boolean;
  /** The plan the standing call is about, as the voice window reports it. */
  callPlanId: string | undefined;
}): MicrophoneButton {
  if (!input.voiceAvailable) return { press: MICROPHONE_PRESS.NONE, label: VOICE_KEYLESS_NOTE };
  const row = microphoneAccessRow({ voiceAvailable: true, status: input.microphoneStatus });
  if (row.offerAccess) return { press: MICROPHONE_PRESS.ASK_ACCESS, label: "Allow the microphone" };
  if (input.microphoneStatus === MICROPHONE_STATUS.DENIED) {
    return {
      press: MICROPHONE_PRESS.OPEN_SETTINGS,
      label: "Allow the microphone in System Settings",
    };
  }
  if (!row.ready) return { press: MICROPHONE_PRESS.NONE, label: row.detail ?? VOICE_KEYLESS_NOTE };
  if (input.activePlanId === undefined) {
    return { press: MICROPHONE_PRESS.NONE, label: "Open a plan to talk about it" };
  }
  if (input.listening && input.callPlanId === input.activePlanId) {
    return { press: MICROPHONE_PRESS.TALK, label: "Mute the microphone" };
  }
  return { press: MICROPHONE_PRESS.TALK, label: "Talk about this plan" };
}

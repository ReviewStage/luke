import type { Plan, PlanDocument } from "@sidecar/hosted/plan-wire";
import {
  PLANNING_READ,
  type PlanningView,
  VOICE_PHASE,
  type VoicePhase,
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
 * it out: which page shows, which state the document region is in, how the
 * plan's folder reads in the header, what Copy shows, and the word beside the
 * microphone.
 */

/** What the assumptions' section says while the list is empty, the words Copy writes there. */
export const NO_ASSUMPTIONS_LINE = "None recorded";

/** A macOS home folder at the head of a path, which the header shows as `~`. */
const HOME_PREFIX = /^\/Users\/[^/]+(?=\/|$)/u;

/** How many recent folders the new-plan page offers. */
const RECENT_FOLDER_LIMIT = 5;

/** Which of the Plans tab's pages shows. */
export const PLANS_PAGE = {
  /** The new plan's name and folder: the tab's home, whenever no plan is open. */
  NEW: "new",
  /** The open plan's saved document and its microphone. */
  DOCUMENT: "document",
} as const;

export type PlansPage = (typeof PLANS_PAGE)[keyof typeof PLANS_PAGE];

/**
 * The page the tab shows. An open plan is the document page, in every panel
 * alike, because the plan open is the host's and not one panel's: it stands
 * until the developer leaves it, whatever tab or shape the panel is in.
 * With none open, the tab is the new-plan page: the plan list is the
 * sidebar's, so there is no empty page to stand between them.
 */
export function plansPage(view: PlanningView): PlansPage {
  return view.activePlanId === undefined ? PLANS_PAGE.NEW : PLANS_PAGE.DOCUMENT;
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

/** The header's folder line: the folder's path, with the home folder as `~`. */
export function folderLine(folderPath: string): string {
  return folderPath.replace(HOME_PREFIX, "~");
}

/** The last segment of a folder's path, the way a chip names it. */
export function folderName(folderPath: string): string {
  return folderPath.replace(/\/+$/u, "").split("/").pop() || folderPath;
}

/**
 * The folders this Mac's plans read, the newest started plan's first and each
 * once, so the new-plan page can offer the folder the last plan was started
 * in and a few before it. The list is already newest started first, and a
 * plan with no folder here adds none.
 */
export function recentFolders(
  plans: PlanningView["plans"],
  folders: PlanningView["folders"],
): string[] {
  const recent: string[] = [];
  for (const plan of plans) {
    const folderPath = folders[plan.id];
    if (folderPath !== undefined && !recent.includes(folderPath)) recent.push(folderPath);
    if (recent.length === RECENT_FOLDER_LIMIT) break;
  }
  return recent;
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

/** What the new-plan form says when the service answered no plan. */
export const START_FAILED_NOTE = "Luke's service could not be reached. Try again.";

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

/** The voice's word for each of its waits the service names, in place of the call's own. */
const VOICE_PHASE_WORD = {
  [VOICE_PHASE.HANDING_OFF]: "Handing off",
  [VOICE_PHASE.ABOUT_TO_ANSWER]: "About to answer",
} as const satisfies Record<VoicePhase, string>;

/** The statuses whose own word gives way to the voice's wait: Luke is not speaking, and the call is not opening or closing. */
const VOICE_PHASE_SHOWN: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
]);

/**
 * The open plan's call as the microphone row draws it: the voice's word, and
 * the backend's line, which is the planning model while it works, with its
 * pending command where it has one, and whether the notetaker is writing.
 */
export interface CallStatus {
  voiceWord: string;
  backend: { planner: { action: string | undefined } | undefined; notes: boolean };
}

/**
 * The microphone row's two lines while a call stands about the open plan,
 * and nothing otherwise. A voice error or notice is not repeated here, since
 * the panel's own strip already carries it under the shape, exactly as it
 * does for any call. The voice line is the call's status, except that a
 * listening or muted call reads the wait the service says the voice is in;
 * speaking, connecting, and closing keep their own word, since each says
 * more. The backend line is each backend part's own, so neither stands in
 * for the voice.
 */
export function callStatus(
  view: Pick<VoiceView, "voiceStatus" | "callPlanId">,
  planning: Pick<PlanningView, "activePlanId" | "activity">,
): CallStatus | undefined {
  const { activePlanId, activity } = planning;
  if (activePlanId === undefined || view.callPlanId !== activePlanId) return undefined;
  const word = STATUS_WORD[view.voiceStatus];
  if (word === undefined) return undefined;
  const phase = VOICE_PHASE_SHOWN.has(view.voiceStatus) ? activity?.voice : undefined;
  const planner = activity?.planner;
  return {
    voiceWord: phase === undefined ? word : VOICE_PHASE_WORD[phase],
    backend: {
      planner: planner === undefined ? undefined : { action: planner.action },
      notes: activity?.notes ?? false,
    },
  };
}

/** The statuses of a call still in progress, the ones a planning call holds the panel open through. */
const CALL_IN_PROGRESS: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.CONNECTING,
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
  LIVE_STATUS.SPEAKING,
]);

/**
 * Whether a planning call is in progress, which holds the expanded panel
 * against the pointer leaving: the developer is talking a plan through and
 * reading the document it writes, often with their hands elsewhere. A call
 * closing or failed holds nothing.
 */
export function planningCallHoldsPanel(
  view: Pick<VoiceView, "voiceStatus" | "callPlanId">,
): boolean {
  return view.callPlanId !== undefined && CALL_IN_PROGRESS.has(view.voiceStatus);
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
  /** Whether the open plan's call stands with the developer not heard, which the button draws struck through. */
  readonly muted: boolean;
}

/** The statuses of a call that has a session, the ones whose microphone is either heard or muted. */
const CALL_STANDING: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
  LIVE_STATUS.SPEAKING,
]);

/**
 * The microphone button, from what voice can run on and which plan is open.
 * The microphone permission comes first, on the panel's own rules, because a
 * press that cannot be heard is no press; then the plan, since a call is
 * always about the open plan. The press toggles: while the developer is
 * heard on this plan's own call it mutes, and otherwise it opens the plan's
 * call or hears it again, hanging up another plan's first,
 * which is also how a call that failed or was lost is tried again. Muted is
 * this plan's own call standing with the developer not heard, so the button
 * says so rather than reading as a call not yet begun.
 */
export function microphoneButton(input: {
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  activePlanId: string | undefined;
  listening: boolean;
  /** The plan the standing call is about, as the voice window reports it. */
  callPlanId: string | undefined;
  voiceStatus: LiveStatus;
}): MicrophoneButton {
  if (!input.voiceAvailable) {
    return { press: MICROPHONE_PRESS.NONE, label: VOICE_KEYLESS_NOTE, muted: false };
  }
  const row = microphoneAccessRow({ voiceAvailable: true, status: input.microphoneStatus });
  if (row.offerAccess) {
    return { press: MICROPHONE_PRESS.ASK_ACCESS, label: "Allow the microphone", muted: false };
  }
  if (input.microphoneStatus === MICROPHONE_STATUS.DENIED) {
    return {
      press: MICROPHONE_PRESS.OPEN_SETTINGS,
      label: "Allow the microphone in System Settings",
      muted: false,
    };
  }
  if (!row.ready) {
    return { press: MICROPHONE_PRESS.NONE, label: row.detail ?? VOICE_KEYLESS_NOTE, muted: false };
  }
  if (input.activePlanId === undefined) {
    return { press: MICROPHONE_PRESS.NONE, label: "Open a plan to talk about it", muted: false };
  }
  const ownCall = input.callPlanId === input.activePlanId;
  if (ownCall && input.listening) {
    return { press: MICROPHONE_PRESS.TALK, label: "Mute the microphone", muted: false };
  }
  if (ownCall && CALL_STANDING.has(input.voiceStatus)) {
    return { press: MICROPHONE_PRESS.TALK, label: "Unmute the microphone", muted: true };
  }
  return { press: MICROPHONE_PRESS.TALK, label: "Talk about this plan", muted: false };
}

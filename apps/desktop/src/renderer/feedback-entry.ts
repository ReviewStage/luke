import { ACCOUNT_STATUS, type AccountSnapshot } from "../shared/contracts";
import type { FeedbackImage, FeedbackKind } from "../shared/feedback";
import { FEEDBACK_KIND, FEEDBACK_LIMITS } from "../shared/feedback";

/**
 * A note to the founders being written, wherever the panel happens to be.
 * Like a credential entry, it is app state rather than field state: the
 * pointer leaving, the panel closing, or a visit to the sessions tab must not
 * discard words someone is in the middle of — only Cancel and a landed send
 * end an entry. Unlike a credential it carries no secret, so what it holds is
 * only ever the user's own words, their optional signature, and the
 * screenshots they chose.
 */
export interface FeedbackEntry {
  kind: FeedbackKind;
  /** What has been written so far. Empty until it has been. */
  message: string;
  /**
   * Optional credit. A fresh note starts signed with the account the user is
   * signed in as; both fields stay theirs to edit or clear, and empty means
   * unsigned. Kept as edited for the life of the note.
   */
  name: string;
  email: string;
  images: readonly FeedbackImage[];
  /** True while the note is being sent. */
  busy: boolean;
  /**
   * Whether the composer was last asked for from inside the panel. It is the
   * difference between someone partway down the settings tab and a spoken ask,
   * so it decides whether leaving the shape returns to the panel or nothing.
   */
  fromPanel: boolean;
  /** Why the last attempt was refused, if it was. */
  rejection?: string;
}

/**
 * The one way to act on the note being written. The state lives above both of
 * its views — the settings section that offers it and the shape it is written
 * in — for the same reason a credential's does: a view can leave the screen,
 * and the entry must not go with it.
 */
export interface FeedbackEntryControl {
  entry?: FeedbackEntry;
  /** The line drawn after a send lands, in place of the composer it ended. */
  notice?: string;
  /** Opens the composer for a kind, or brings back the one already open. */
  begin(kind: FeedbackKind): void;
  changeMessage(message: string): void;
  changeName(name: string): void;
  changeEmail(email: string): void;
  /** Takes picked or pasted files aboard, encoding what needs it. */
  attach(files: readonly File[]): void;
  removeImage(index: number): void;
  /** Leaves the shape and keeps the draft, for the way back to it later. */
  dismiss(): void;
  /** Gives the note up. The one way a draft is discarded. */
  cancel(): void;
  commit(): void;
}

/**
 * The credit a fresh note starts with: the signed-in account's own name and
 * address. It lands in the composer's visible fields rather than riding a
 * send, so what a submission carries is always exactly what its fields
 * showed — prefilled, but the user's to edit or clear before anything leaves.
 */
export interface FeedbackSignature {
  name?: string;
  email?: string;
}

/** What the account offers a fresh note as its signature: nothing, signed out. */
export function accountSignature(
  account: AccountSnapshot | undefined,
): FeedbackSignature | undefined {
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return undefined;
  return { ...(account.name ? { name: account.name } : {}), email: account.email };
}

export function freshFeedbackEntry(
  kind: FeedbackKind,
  fromPanel: boolean,
  signature?: FeedbackSignature,
): FeedbackEntry {
  return {
    kind,
    message: "",
    name: signature?.name ?? "",
    email: signature?.email ?? "",
    images: [],
    busy: false,
    fromPanel,
  };
}

/**
 * One request to open the composer, wherever it came from — the settings
 * section's buttons or a spoken ask carried through the same path.
 * `draft` is starting text for the note, and it is only ever the user's own
 * words: the section never sends one, and the spoken tool's
 * contract forbids anything the user did not say. `signature` is the
 * signed-in account's credit, and it seeds only a note that does not exist
 * yet: a note already there keeps its fields exactly as its author left
 * them, cleared ones included.
 */
export interface FeedbackOpenAsk {
  kind: FeedbackKind;
  fromPanel: boolean;
  draft?: string;
  signature?: FeedbackSignature;
}

/**
 * What opening the composer does to the note already there. A draft in
 * progress is never discarded by asking again: opening over a half-written
 * note brings that note back, only a note with nothing in it yet is
 * re-labelled to the kind that was just asked for, and starting text lands
 * only in that same empty note — words someone typed are never overwritten by
 * words someone said. A note mid-send belongs to the reply on its way back,
 * so it is not touched at all. Where leaving returns you follows the latest
 * ask, not the first. `drafted` reports whether the starting text was placed,
 * so a spoken open can say honestly what it found.
 */
export function openedFeedbackEntry(
  current: FeedbackEntry | undefined,
  ask: FeedbackOpenAsk,
): { entry?: FeedbackEntry; drafted: boolean } {
  if (current?.busy) return { drafted: false };
  const blank = (current?.message ?? "").trim().length === 0;
  const drafted = ask.draft !== undefined && blank;
  const base = current ?? freshFeedbackEntry(ask.kind, ask.fromPanel, ask.signature);
  return {
    entry: {
      ...base,
      ...(blank ? { kind: ask.kind } : {}),
      ...(drafted && ask.draft !== undefined ? { message: ask.draft } : {}),
      fromPanel: ask.fromPanel,
    },
    drafted,
  };
}

/**
 * Each kind in its own words: the button that offers it in settings, and the
 * label, hint, and field the shape opens with. Two kinds rather than one form
 * with a switch, because they are read differently on arrival — feedback is
 * about Luke, and a prompt is a candidate for the product itself.
 */
export const FEEDBACK_COPY: Record<
  FeedbackKind,
  { title: string; label: string; placeholder: string; detail?: string }
> = {
  [FEEDBACK_KIND.FEEDBACK]: {
    title: "Send feedback",
    label: "Feedback",
    placeholder: "What happened, and what did you expect?",
  },
  [FEEDBACK_KIND.PROMPT]: {
    title: "Submit a prompt",
    label: "The prompt",
    placeholder: "Describe a feature…",
    detail:
      "Send a prompt to a coding agent. If we like the result, we'll add it in the next release.",
  },
};

/** A note worth sending: words, not whitespace, and not one already in flight. */
export function isSendable(entry: FeedbackEntry | undefined): entry is FeedbackEntry {
  return entry !== undefined && !entry.busy && entry.message.trim().length > 0;
}

/**
 * Why an attachment did not come along, in the composer's own words. Said
 * beside the field rather than thrown, because attaching is the user's act.
 */
export const IMAGE_REFUSAL = {
  UNREADABLE: "That file could not come along as a screenshot.",
  FULL: `Up to ${FEEDBACK_LIMITS.MAX_IMAGES} screenshots can come along.`,
} as const;

/** What the chips draw. Built here so the format lives beside the type it reads. */
export function feedbackImageUrl(image: FeedbackImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

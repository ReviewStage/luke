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
  /** Optional credit, kept as typed; empty means unsigned. */
  name: string;
  email: string;
  images: readonly FeedbackImage[];
  /** True while the note is being sent. */
  busy: boolean;
  /**
   * Whether the composer was last asked for from inside the panel. It is the
   * difference between someone partway down the settings tab and someone who
   * came straight from the menu bar, so it decides where leaving the shape
   * returns them: to the panel, or to nothing at all.
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

export function freshFeedbackEntry(kind: FeedbackKind, fromPanel: boolean): FeedbackEntry {
  return { kind, message: "", name: "", email: "", images: [], busy: false, fromPanel };
}

/**
 * Each kind in its own words: the line that offers it in settings, and the
 * label, hint, and field the shape opens with. Two kinds rather than one form
 * with a switch, because they are read differently on arrival — feedback is
 * about Luke, and a prompt is a candidate for the product itself.
 */
export const FEEDBACK_COPY: Record<
  FeedbackKind,
  { title: string; opener: string; label: string; placeholder: string; detail?: string }
> = {
  [FEEDBACK_KIND.FEEDBACK]: {
    title: "Send feedback",
    opener: "Write feedback",
    label: "Feedback",
    placeholder: "What happened, and what did you expect?",
  },
  [FEEDBACK_KIND.PROMPT]: {
    title: "Submit a prompt",
    opener: "Share a prompt",
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

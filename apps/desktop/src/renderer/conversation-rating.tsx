import { FEEDBACK_LIMITS } from "@sidecar/feedback";
import { CONVERSATION_RATE_STATUS, type ConversationRateStatus } from "@sidecar/gateway";
import { ThumbsDownIcon, ThumbsUpIcon } from "@sidecar/panel";
import { MESSAGE_RATING, type MessageRating } from "@sidecar/wire";
import { useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";

/**
 * Two thumbs under one of Luke's messages, the way a chat rates a reply: the
 * one the developer chose is filled, a press on the other moves the verdict,
 * and a press on the filled one sends the same verdict again, since a rating
 * is a fact stated and never an edit. The press is one act, carried to the
 * host, which writes it to the service and shows the verdict back through
 * the view every window draws — nothing here holds the verdict itself, only
 * the press still in flight and the refusal the last one met. A thumbs down
 * offers the feedback composer, never opens it: the offer stands beside the
 * thumbs for as long as the verdict does, one press away, prefilled with the
 * rated message and the developer's ask before it, and what it holds leaves
 * only by the composer's own Send.
 */

/** One of Luke's messages as the offered draft quotes it: the row a thumb rates, its words, and the ask it answered, where the turn had one. */
export interface RatedMessageDraft {
  readonly messageId: string;
  readonly words: string;
  readonly ask?: string;
}

/** What each thumb is called for a reader; the glyph alone speaks to the sighted. */
export const RATING_LABEL = {
  [MESSAGE_RATING.UP]: "Thumbs up",
  [MESSAGE_RATING.DOWN]: "Thumbs down",
} as const satisfies Record<MessageRating, string>;

/** What a refused press says, fixed by the build, one sentence per refusal the host can answer. */
const RATE_REFUSAL_COPY = {
  [CONVERSATION_RATE_STATUS.RATED]: undefined,
  [CONVERSATION_RATE_STATUS.UNAVAILABLE]: "Could not record that rating right now.",
  [CONVERSATION_RATE_STATUS.NOT_FOUND]: "That message is no longer in the conversation.",
  [CONVERSATION_RATE_STATUS.NOT_RATEABLE]: "That message cannot be rated.",
} as const satisfies Record<ConversationRateStatus, string | undefined>;

const OFFER_LABEL = "Say what went wrong";

/**
 * The most characters each quoted line of the offered draft carries. The
 * whole draft has to fit the composer's own bound with room left for the
 * developer's words, so a long reply is cut rather than filling it.
 */
export const DRAFT_QUOTE_MAX_LENGTH = Math.floor(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH / 4);

const DRAFT_ELLIPSIS = "…";

export const DRAFT_SPEAKER = {
  YOU: "You said:",
  LUKE: "Luke said:",
} as const;

/** Cut on code points, so a quote never ends in half a character before its ellipsis. */
function cutQuote(text: string): string {
  const points = [...text.trim()];
  return points.length <= DRAFT_QUOTE_MAX_LENGTH
    ? points.join("")
    : `${points.slice(0, DRAFT_QUOTE_MAX_LENGTH - DRAFT_ELLIPSIS.length).join("")}${DRAFT_ELLIPSIS}`;
}

/**
 * What the offered composer starts with: the developer's ask where the turn
 * had one, then the rated message, each in its speaker's name and cut to the
 * quote bound, over a blank line for the developer to write under. Only
 * words already on the screen enter it, and it is placed only in an empty
 * note — the composer keeps a draft in progress over it.
 */
export function ratingFeedbackDraft(rated: RatedMessageDraft): string {
  return [
    ...(rated.ask === undefined ? [] : [`${DRAFT_SPEAKER.YOU} ${cutQuote(rated.ask)}`, ""]),
    `${DRAFT_SPEAKER.LUKE} ${cutQuote(rated.words)}`,
    "",
    "",
  ].join("\n");
}

export function ConversationRatingControl({
  rated,
  rating,
  onOfferFeedback,
}: {
  rated: RatedMessageDraft;
  /** The developer's latest verdict on the message, as the view holds it; absent where none was given. */
  rating: MessageRating | undefined;
  /** Opens the composer on the draft; absent where no composer can be offered, and a thumbs down offers nothing. */
  onOfferFeedback?: (draft: string) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [pending, setPending] = useState<MessageRating | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // A verdict that moved — this press landing, or another device's read back — is the refusal's answer.
  useEffect(() => setRefusal(undefined), [rating]);

  const rate = (verdict: MessageRating) => {
    if (pending !== undefined) return;
    setPending(verdict);
    setRefusal(undefined);
    void act(ACT_KIND.CONVERSATION_RATE_MESSAGE, { messageId: rated.messageId, rating: verdict })
      .then((result) => setRefusal(RATE_REFUSAL_COPY[result.status]))
      // The act's own rejection carries the refusal sentence the build fixed.
      .catch((refused: Error) => setRefusal(refused.message))
      .finally(() => setPending(undefined));
  };

  const thumb = (verdict: MessageRating, Icon: () => React.JSX.Element) => (
    <button
      type="button"
      className="conversation-rating-thumb"
      aria-label={RATING_LABEL[verdict]}
      aria-pressed={rating === verdict}
      data-pending={pending === verdict ? "true" : undefined}
      onClick={() => rate(verdict)}
    >
      <Icon />
    </button>
  );

  return (
    <span
      className="conversation-rating"
      data-rating={rating}
      aria-busy={pending === undefined ? undefined : "true"}
    >
      {thumb(MESSAGE_RATING.UP, ThumbsUpIcon)}
      {thumb(MESSAGE_RATING.DOWN, ThumbsDownIcon)}
      {rating === MESSAGE_RATING.DOWN && onOfferFeedback !== undefined ? (
        <button
          type="button"
          className="conversation-rating-offer"
          onClick={() => onOfferFeedback(ratingFeedbackDraft(rated))}
        >
          {OFFER_LABEL}
        </button>
      ) : null}
      {refusal === undefined ? null : (
        <span className="conversation-rating-refusal" role="status">
          {refusal}
        </span>
      )}
    </span>
  );
}

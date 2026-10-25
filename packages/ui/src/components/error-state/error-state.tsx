/**
 * error-state.tsx -- something that did not land: its sentence, Retry, and the few other presses a failure offers, as a quiet line among the rows or as the empty state of the region it would have filled.
 *
 * Every place that fails says so the same way: one sentence, "The inbox
 * could not be read.", then, where trying again can mend it, Retry as a
 * quiet button with its turning glyph. The sentence is in the muted ink of
 * the words around it, and the fault's red marks only the glyph before it,
 * because a read that did not land is most often a passing fault the next
 * try mends, and a line of red reads as something broken for good. The
 * sentence and its Retry are one alert, so a reader hears the failure land
 * where the rows or the region would have stood, and Retry is the next stop
 * of the keyboard after it.
 *
 * Only where it stands differs. Among rows, in a card, or under a
 * transcript it is a row of its own at a caption's size, laid out as a row
 * is (`ROWS` stands it at a sidebar's or a list pane's rows' inset by a
 * margin of its own, as `NoteLine`'s `ROWS` does, a little short of the
 * row's end so Retry's glyph stands under the head's buttons'): the glyph where a row's glyph stands, the sentence where a row's words
 * stand, and Retry at the row's end, where a row's own buttons stand. Where
 * the row is narrow, a sidebar's or a list pane's, Retry is its glyph alone,
 * still named Retry, so the sentence keeps the room.
 *
 * A failure among rows may offer a few presses beside Retry, always in one
 * order: the remedy that mends it where trying again alone cannot ("Connect
 * GitHub"), outlined since it is the act the line is there for, then Retry,
 * then Remove, which lets go of what failed, then Dismiss, a cross at the
 * row's end, which puts the line away. Where they would take more than half
 * the row they go onto the line under the sentence, at its end, whole.
 *
 * On a toolbar's one line it keeps to that line and is as wide as it says:
 * the presses stay whole, and where the toolbar has less room the sentence
 * gives way to them, cut short with an ellipsis, still said whole to a
 * reader and as its hint to the pointer, so it never runs under what stands
 * beside it. Alone in a region it would have filled, a tab or a page, it is that region's empty state (`EmptyState`):
 * the glyph large and faint over the sentence, and Retry under it, standing
 * a little above the room's middle. The container places it and lends it no
 * colour of its own. Where trying the read again cannot mend it, because
 * what failed is the drawing of the place itself (`ErrorBoundary`), Reload
 * stands there in Retry's place, with Retry's glyph, and draws the place
 * again from the start.
 *
 * A row that is itself the press, a list's foot such as "Show older
 * versions" turned failure, cannot hold a Retry button of its own, so it
 * says its sentence and then Retry's glyph and word (`RetryRowLabel`), and
 * its own press is the retry. The sentence wraps as words do, and the glyph
 * and word stay together after it. The sentence is an alert for the same
 * reason, because it appears in the row's place after a press or a scroll.
 *
 * A line is a paragraph of its own, but one standing inside words, as a
 * picture that failed to read stands inside the paragraph that names it, is
 * a span (`ERROR_STATE_ELEMENT.SPAN`), since a paragraph holds no other.
 *
 * A line is drawn in Tailwind utilities over the theme with no shadcn base,
 * each placement's classes picked here (`LINE`): shadcn's alert is a block
 * of its own, Luke's `Banner`, where a failure among rows is laid out as a
 * row, and alone in its region it is `EmptyState`, which stands on shadcn's
 * empty. Every part stands on the row's first line, a control tall, so the
 * glyph, the words, and Retry share one middle; a sentence too long for its
 * room wraps in its own column under its first line, and the words keep at
 * least half the row, so presses that would take more go, whole, onto the
 * line under them. Among rows, the row is the container its narrow look
 * asks about, which `error-state.css` answers, since that look reaches into
 * Retry's button; on a toolbar it is no container, so the toolbar can size
 * it, and its sentence gives way to its presses, cut short with an ellipsis
 * the sheet draws.
 */

import type { ReactNode } from "react";
import { CloseIcon } from "../../face/glyphs.js";
import { AlertIcon, RetryIcon } from "../../icons/lucide-glyphs.js";
import { BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { EmptyState } from "../empty-state/empty-state.js";
import { Tooltip } from "../tooltip/hint.js";

/** Where a failure stands: among the rows it failed to draw, at a list's rows' inset among them, alone in the region it would have filled, or on one line of a toolbar. */
export const ERROR_STATE_PLACEMENT = {
  INLINE: "inline",
  ROWS: "rows",
  CENTRED: "centred",
  TOOLBAR: "toolbar",
} as const;

export type ErrorStatePlacement =
  (typeof ERROR_STATE_PLACEMENT)[keyof typeof ERROR_STATE_PLACEMENT];

/** What a failure on a line stands as: a paragraph of its own, or a span inside the words it stands among. */
export const ERROR_STATE_ELEMENT = {
  PARAGRAPH: "p",
  SPAN: "span",
} as const;

export type ErrorStateElement = (typeof ERROR_STATE_ELEMENT)[keyof typeof ERROR_STATE_ELEMENT];

/** The press that mends a failure where trying again alone cannot: its words and what it does. */
export interface ErrorStateRemedy {
  /** What it does, as "Connect GitHub". */
  readonly label: string;
  readonly onClick: () => void;
}

/** The presses only a failure on a line offers, since a region's empty state has room for one. */
interface LineActions {
  /** The remedy, drawn first. */
  remedy?: ErrorStateRemedy | undefined;
  /** Remove's press, which lets go of what failed. */
  onRemove?: (() => void) | undefined;
  /** Dismiss's press, which puts the line away. */
  onDismiss?: (() => void) | undefined;
  /** What the line stands as: a paragraph unless it stands inside words. */
  as?: ErrorStateElement | undefined;
}

/** Where a failure stands, with what it says and the presses it may offer there. */
type Placed =
  | (LineActions & {
      placement?: typeof ERROR_STATE_PLACEMENT.INLINE | typeof ERROR_STATE_PLACEMENT.ROWS;
      /** What did not land, as "The inbox could not be read." */
      children: ReactNode;
      onReload?: undefined;
    })
  | (LineActions & {
      placement: typeof ERROR_STATE_PLACEMENT.TOOLBAR;
      /** What did not land, words alone, since a sentence cut short is said whole as its hint. */
      children: string;
      onReload?: undefined;
    })
  | {
      placement: typeof ERROR_STATE_PLACEMENT.CENTRED;
      /** The way out of the place the failure left empty, under Retry. */
      exit?: ErrorStateRemedy | undefined;
      /** Reload's press, drawn in Retry's place, which draws the place again from the start. */
      onReload?: (() => void) | undefined;
      children: ReactNode;
      remedy?: undefined;
      onRemove?: undefined;
      onDismiss?: undefined;
      as?: undefined;
    };

/**
 * Each placement's line, words, and presses. Note that at a list's rows'
 * inset the line takes the room its margins leave, as a note line does
 * among a sidebar's rows, and ends a little short of the row's end, so
 * Retry's glyph stands under the head's buttons'; and that the presses
 * stand together at the row's end, on its first line or, wrapped, under the
 * words, never wider than the row, but on a toolbar keep to its one line
 * whole.
 */
const LINE = {
  [ERROR_STATE_PLACEMENT.INLINE]: {
    line: "w-full m-0 flex-wrap items-start @container/luke-error-state",
    words: "min-w-1/2 flex-[1_1_0]",
    actions: "max-w-full flex-[0_1_auto] flex-wrap justify-end ms-auto",
  },
  [ERROR_STATE_PLACEMENT.ROWS]: {
    line: "w-auto mt-luke-4 mr-luke-4 mb-luke-4 ml-row-inset flex-wrap items-start @container/luke-error-state",
    words: "min-w-1/2 flex-[1_1_0]",
    actions: "max-w-full flex-[0_1_auto] flex-wrap justify-end ms-auto",
  },
  [ERROR_STATE_PLACEMENT.TOOLBAR]: {
    line: "w-auto m-0 flex-nowrap items-center",
    words: "min-w-0 flex-[0_1_auto] overflow-hidden whitespace-nowrap",
    actions: "max-w-full flex-none flex-nowrap justify-end ms-0",
  },
} as const satisfies Record<
  Exclude<ErrorStatePlacement, typeof ERROR_STATE_PLACEMENT.CENTRED>,
  { line: string; words: string; actions: string }
>;

const WORDS = {
  RETRY: "Retry",
  RELOAD: "Reload",
  REMOVE: "Remove",
  DISMISS: "Dismiss",
} as const;

/**
 * A failure's sentence, `children`, and, where `onRetry` is given, the
 * Retry that tries again, said together as an alert and drawn at
 * `placement`; among rows, with the remedy, Remove, and Dismiss where each
 * is given; alone in its region, with Reload in Retry's place where
 * `onReload` is given.
 */
export function ErrorState(
  props: {
    /** Retry's press; with none, the failure says its sentence alone. */
    onRetry?: (() => void) | undefined;
  } & Placed,
): React.JSX.Element {
  const { onRetry, onReload, remedy, onRemove, onDismiss, children } = props;
  const Line = props.as ?? ERROR_STATE_ELEMENT.PARAGRAPH;
  const placement = props.placement ?? ERROR_STATE_PLACEMENT.INLINE;
  if (placement === ERROR_STATE_PLACEMENT.CENTRED) {
    const again =
      onReload === undefined
        ? onRetry === undefined
          ? undefined
          : { label: WORDS.RETRY, onClick: onRetry }
        : { label: WORDS.RELOAD, onClick: onReload };
    return (
      <EmptyState
        icon={<AlertIcon />}
        alert
        action={again === undefined ? undefined : { ...again, icon: <RetryIcon />, turns: true }}
        secondary={props.placement === ERROR_STATE_PLACEMENT.CENTRED ? props.exit : undefined}
      >
        {children}
      </EmptyState>
    );
  }
  const look = LINE[placement];
  return (
    <Line
      className={`luke-error-state box-border flex min-w-0 gap-icon-gap text-caption text-muted-foreground ${look.line}`}
      data-placement={placement}
      role="alert"
    >
      <span className="luke-error-state-glyph flex h-control flex-none items-center text-danger [&_svg]:size-control-icon">
        <AlertIcon />
      </span>
      <span
        className={`luke-error-state-words py-state-row-inset ${look.words}`}
        title={props.placement === ERROR_STATE_PLACEMENT.TOOLBAR ? props.children : undefined}
      >
        {children}
      </span>
      {remedy === undefined &&
      onRetry === undefined &&
      onRemove === undefined &&
      onDismiss === undefined ? null : (
        <span className={`luke-error-state-actions flex min-w-0 gap-control-gap ${look.actions}`}>
          {remedy === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={remedy.onClick}>
              {remedy.label}
            </Button>
          )}
          {onRetry === undefined ? null : (
            <span className="luke-error-state-retry contents">
              <Button variant={BUTTON_VARIANT.QUIET} icon={<RetryIcon />} turns onClick={onRetry}>
                {WORDS.RETRY}
              </Button>
            </span>
          )}
          {onRemove === undefined ? null : (
            <Button variant={BUTTON_VARIANT.QUIET} onClick={onRemove}>
              {WORDS.REMOVE}
            </Button>
          )}
          {onDismiss === undefined ? null : (
            <Tooltip label={WORDS.DISMISS}>
              <IconButton icon={<CloseIcon />} label={WORDS.DISMISS} onClick={onDismiss} />
            </Tooltip>
          )}
        </span>
      )}
    </Line>
  );
}

/**
 * A failed row's words, `failure`, then Retry's glyph and word, for a row
 * that is itself the button its press retries with. The row lends it its
 * type and ink.
 */
export function RetryRowLabel({ failure }: { failure: string }): React.JSX.Element {
  return (
    <>
      <span role="alert">{failure}</span>{" "}
      <span className="luke-retry-row-label ml-luke-4 inline-flex items-baseline gap-luke-4 font-emphasis">
        <RetryIcon />
        {WORDS.RETRY}
      </span>
    </>
  );
}

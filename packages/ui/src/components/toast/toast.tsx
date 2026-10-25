import { Duration } from "effect";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { AlertIcon, CircleCheckIcon, InboxIcon } from "../../icons/lucide-glyphs.js";
import { STATUS_TONE } from "../../status-tone.js";
import { SpinnerRing } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text, type TextVariant } from "../text/text.js";
import { useToastSwipe } from "./toast-swipe.js";

/**
 * toast.tsx -- one passing notice: a glyph for what it reports, its words, an optional second line under them, and at most one action at its end.
 *
 * A toast is a card of its words, each cut at two lines, led by the glyph its
 * tone picks: a check for what was done, an alert for what was refused, the
 * Inbox's tray for an ask, and the spinner's ring for work still under way;
 * or by a `glyph` of its own, in its tone's ink, where what it says has a
 * glyph that names it better, as the speaker names the Mac's sound.
 * A working toast turns into what came of the work in place, its tone,
 * words, and actions changed on the same card: the glyph it led with fades
 * out under the one it now leads with, which grows in on the spring, and its
 * words fade in anew. One with no action is never pointed at, so
 * clicks pass through it; one with an action (`ToastActions`, passed as
 * `actions`) takes the pointer, pauses its hold while the pointer is over it
 * or focus is in it, each of which it keeps apart so that one ending while
 * the other stands lets nothing run, and is dismissed by Escape while focus
 * is in it, or swiped sideways (`useToastSwipe`). One whose hold runs down by
 * itself is handed that hold as `countdown`, and drains a thin bar along its
 * foot over it, paused while it is held. It arrives on the pair every
 * arriving element rides and leaves
 * first, over `--luke-duration-exit`, once `leaving` says so; whoever owns
 * its life holds it mounted through that.
 *
 * What it says aloud is the stack's (`ToastStack`), so the words here are
 * plain text. The toast takes no class or style; where it stands is the
 * stack's.
 *
 * Where the window is too small for the card, as the floating call window
 * is, a toast is drawn in its `TOAST_LOOK.COMPACT` look: one line of its glyph
 * and words, faded where the line's end cuts them, its second line left to
 * the announcer,
 * on a card no taller than a control, with the shadow kept within the room
 * such a window leaves it.
 *
 * It is drawn in Tailwind utilities over the theme; `toast.css` keeps what
 * those cannot say: its arrival, turn, departure, and countdown, which are
 * keyframes or read the custom properties its swipe and countdown write, and
 * what answers the pointer, which reads `:has()` and the screen's hover.
 */

/** What a toast reports, of the status tones: the act done, the act refused, something asked of the developer, or work still under way. */
export type ToastTone =
  | typeof STATUS_TONE.COMPLETE
  | typeof STATUS_TONE.DANGER
  | typeof STATUS_TONE.ATTENTION
  | typeof STATUS_TONE.WORKING;

/**
 * How long a toast stands, by what it reports, and the only holds a toast
 * names: a change carried, which is short; one carried that its Undo takes
 * back, long enough to reach for Undo, and what any toast with an action
 * stands for where it names no hold; one refused, which takes longer to read
 * and to act on; or news an agent or an automation sent while the developer
 * was looking elsewhere in the window, which has the longest, since it
 * arrives unbidden and carries a View to reach for. A confirmation drawn on
 * its own control, a `CopyButton`'s check, stands for `DONE` too, so a copy
 * answered on its button and one answered by a toast last the same.
 */
export const TOAST_HOLD = {
  DONE: Duration.seconds(3),
  UNDO: Duration.seconds(5),
  FAILED: Duration.seconds(6),
  NEWS: Duration.seconds(8),
} as const;

/** How a toast is drawn: the window's card, or a compact strip in a window too small for the card (the floating call window). */
export const TOAST_LOOK = {
  CARD: "card",
  COMPACT: "compact",
} as const;

export type ToastLook = (typeof TOAST_LOOK)[keyof typeof TOAST_LOOK];

/** A second, in milliseconds: the notch a countdown drains by under reduced motion. */
const SECOND_MS = 1000;

/** Which of a toast's glyphs is which: the one it leads with now, and the one it led with before its tone last changed. */
const GLYPH_TURN = {
  NOW: "now",
  WAS: "was",
} as const;

/** The ink each glyph is drawn in: its tone's for what was done and what was refused, and the muted ink for an ask, which is the developer's to answer, and for work not done yet, which a toast says no louder than its words. */
const GLYPH_INK = {
  [STATUS_TONE.COMPLETE]: "text-tone-ink",
  [STATUS_TONE.DANGER]: "text-tone-ink",
  [STATUS_TONE.ATTENTION]: "text-muted-foreground",
  [STATUS_TONE.WORKING]: "text-muted-foreground",
} as const satisfies Record<ToastTone, string>;

/**
 * The card: its glyph, its words' first line, and its action share a first
 * row as tall as a control, each centred on it; its words wrap at the card's
 * own line. One with an action ends a step closer to it, and a finger's
 * sideways drag on it is the toast's while its up and down stay the page's.
 */
const TOAST_CARD =
  "luke-toast relative flex items-start gap-icon-gap rounded-toast border border-border-strong bg-background px-list-inset py-row-inset shadow-toast data-[action=true]:touch-pan-y data-[action=true]:pr-toast-gap";

/** The compact strip: its glyph, words, and any action on one row at least a step taller than a control, so it covers a row of controls under it whole, and taller where its words take two lines; its shadow the call card's own in its window. */
const TOAST_COMPACT =
  "luke-toast relative flex min-h-toast-compact items-center py-luke-4 gap-icon-gap rounded-toast border border-border-strong bg-background px-toast-gap shadow-toast-compact data-[action=true]:touch-pan-y";

/** Each look's card. */
const TOAST_FRAME = {
  [TOAST_LOOK.CARD]: TOAST_CARD,
  [TOAST_LOOK.COMPACT]: TOAST_COMPACT,
} as const satisfies Record<ToastLook, string>;

/** The one cell its glyphs share, so a turn of tone crossfades them with the card unmoved: on the card, centred on its first row; on the strip, on its middle. */
const TOAST_GLYPH = {
  [TOAST_LOOK.CARD]:
    "luke-toast-glyph mt-toast-glyph-inset grid size-control-icon flex-none [&_svg]:size-full",
  [TOAST_LOOK.COMPACT]: "luke-toast-glyph grid size-control-icon flex-none [&_svg]:size-full",
} as const satisfies Record<ToastLook, string>;

/** Its words and the line under them, a title's step apart, the column standing as far below its last line as above its first; on the strip, its words alone. */
const TOAST_TEXT = {
  [TOAST_LOOK.CARD]:
    "luke-toast-text flex min-w-0 flex-1 flex-col gap-toast-line-gap py-toast-text-inset",
  [TOAST_LOOK.COMPACT]: "luke-toast-text flex min-w-0 flex-1",
} as const satisfies Record<ToastLook, string>;

/** Its words, cut at two lines on the card and on the strip alike. */
const TOAST_WORDS = {
  [TOAST_LOOK.CARD]: "luke-toast-words line-clamp-2 wrap-anywhere",
  [TOAST_LOOK.COMPACT]: "luke-toast-words line-clamp-2 wrap-anywhere",
} as const satisfies Record<ToastLook, string>;

/** Its words' type: a section's on the card, and a label's on the strip, so two lines of it hold a refusal's sentence. */
const TOAST_WORDS_TYPE = {
  [TOAST_LOOK.CARD]: TEXT_VARIANT.SECTION,
  [TOAST_LOOK.COMPACT]: TEXT_VARIANT.LABEL,
} as const satisfies Record<ToastLook, TextVariant>;

/** A bar along its foot, in the muted ink, faint, draining toward its start. */
const TOAST_COUNTDOWN =
  "luke-toast-countdown pointer-events-none absolute inset-x-toast-inset bottom-0 h-toast-line-gap origin-left rounded-full bg-muted-foreground opacity-40";

/** The glyph a toast leads with: a check for what was done, an alert for what was refused, the Inbox's tray for an ask, and the spinner's ring for work under way. */
function ToneGlyph({ tone }: { tone: ToastTone }): React.JSX.Element {
  switch (tone) {
    case STATUS_TONE.COMPLETE:
      return <CircleCheckIcon />;
    case STATUS_TONE.DANGER:
      return <AlertIcon />;
    case STATUS_TONE.ATTENTION:
      return <InboxIcon />;
    case STATUS_TONE.WORKING:
      return <SpinnerRing />;
  }
}

/**
 * The tone a toast leads with now and the one it led with before, kept
 * while the card stands so a change of tone crossfades the two glyphs in
 * one cell rather than swapping them.
 */
function useToneTurn(tone: ToastTone): { now: ToastTone; was: ToastTone | undefined } {
  const [turn, setTurn] = useState<{ now: ToastTone; was: ToastTone | undefined }>({
    now: tone,
    was: undefined,
  });
  if (turn.now === tone) return turn;
  const next = { now: tone, was: turn.now };
  setTurn(next);
  return next;
}

/** One toast: its tone, words and detail, and the actions at its end, if it has any, in the look its window has room for. */
export function Toast({
  tone,
  glyph,
  words,
  detail,
  look = TOAST_LOOK.CARD,
  leaving = false,
  actions,
  countdown,
  onHold,
  onEscape,
}: {
  tone: ToastTone;
  /** The glyph it leads with in place of its tone's, where what it says has one of its own. */
  glyph?: (() => React.JSX.Element) | undefined;
  words: string;
  /** A second line under the words, which the compact look leaves to the announcer. */
  detail?: string | undefined;
  /** The card, or the compact strip in a window too small for it. */
  look?: ToastLook;
  /** Whether it is on its way out. */
  leaving?: boolean;
  /** Its action and dismiss, as `ToastActions` draws them; a toast with none is never pointed at. */
  actions?: ReactNode;
  /** The hold it runs down by itself, in milliseconds, drawn as a bar that drains over it; none where it stands until dismissed. */
  countdown?: number | undefined;
  /** Told when the pointer or focus first rests on the toast, and when both have left it. Only a toast with actions holds. */
  onHold?: (holding: boolean) => void;
  /** Told when Escape is pressed while focus is in the toast, or it is swiped away: dismiss it. */
  onEscape?: () => void;
}): React.JSX.Element {
  const held = useRef({ pointer: false, focus: false });
  const [holding, setHolding] = useState(false);
  const turn = useToneTurn(tone);
  const swipe = useToastSwipe(actions === undefined ? undefined : onEscape);
  const hold = (by: keyof typeof held.current, on: boolean) => {
    const was = held.current.pointer || held.current.focus;
    held.current = { ...held.current, [by]: on };
    const now = held.current.pointer || held.current.focus;
    if (now === was) return;
    setHolding(now);
    onHold?.(now);
  };
  const glyphs = turn.was === undefined ? [turn.now] : [turn.was, turn.now];
  const Lead = glyph;
  return (
    <li
      ref={swipe.ref}
      className={TOAST_FRAME[look]}
      data-tone={tone}
      data-look={look}
      data-action={actions === undefined ? undefined : "true"}
      data-leaving={leaving ? "true" : undefined}
      data-held={holding ? "true" : undefined}
      data-turned={turn.was === undefined ? undefined : "true"}
      {...(actions === undefined
        ? undefined
        : {
            onPointerDown: swipe.onPointerDown,
            onPointerMove: swipe.onPointerMove,
            onPointerUp: swipe.onPointerUp,
            onPointerCancel: swipe.onPointerCancel,
            onWheel: swipe.onWheel,
            onPointerEnter: () => hold("pointer", true),
            onPointerLeave: () => hold("pointer", false),
            onFocus: () => hold("focus", true),
            onBlur: () => hold("focus", false),
            onKeyDown: (event: KeyboardEvent) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              onEscape?.();
            },
          })}
    >
      <span className={TOAST_GLYPH[look]} aria-hidden="true">
        {glyphs.map((shown) => (
          <span
            key={shown}
            className={`col-start-1 row-start-1 flex ${GLYPH_INK[shown]}`}
            data-tone={shown}
            data-turn={shown === turn.now ? GLYPH_TURN.NOW : GLYPH_TURN.WAS}
          >
            {Lead !== undefined && shown === turn.now ? <Lead /> : <ToneGlyph tone={shown} />}
          </span>
        ))}
      </span>
      <span className={TOAST_TEXT[look]} key={words}>
        <span className={TOAST_WORDS[look]}>
          <Text variant={TOAST_WORDS_TYPE[look]} as={TEXT_ELEMENT.SPAN}>
            {words}
          </Text>
        </span>
        {detail === undefined || look === TOAST_LOOK.COMPACT ? null : (
          <span className="luke-toast-detail line-clamp-2 wrap-anywhere">
            <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              {detail}
            </Text>
          </span>
        )}
      </span>
      {actions}
      {countdown === undefined ? null : (
        <span
          className={TOAST_COUNTDOWN}
          aria-hidden="true"
          style={cssCustomProperties({
            "--luke-toast-hold": `${countdown}ms`,
            "--luke-toast-seconds": Math.max(1, Math.round(countdown / SECOND_MS)),
          })}
        />
      )}
    </li>
  );
}

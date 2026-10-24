import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { AlertIcon, CircleCheckIcon, InboxIcon } from "../../icons/lucide-glyphs.js";
import { STATUS_TONE } from "../../status-tone.js";
import { SpinnerRing } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { useToastSwipe } from "./toast-swipe.js";

/**
 * toast.tsx -- one passing notice: a glyph for what it reports, its words, an optional second line under them, and at most one action at its end.
 *
 * A toast is a card of its words, each cut at two lines, led by the glyph its
 * tone picks: a check for what was done, an alert for what was refused, the
 * Inbox's tray for an ask, and the spinner's ring for work still under way.
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

/** The one cell its glyphs share, so a turn of tone crossfades them with the card unmoved. */
const TOAST_GLYPH =
  "luke-toast-glyph mt-toast-glyph-inset grid size-control-icon flex-none [&_svg]:size-full";

/** Its words and the line under them, a title's step apart, the column standing as far below its last line as above its first. */
const TOAST_TEXT =
  "luke-toast-text flex min-w-0 flex-1 flex-col gap-toast-line-gap py-toast-text-inset";

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

/** One toast: its tone, words and detail, and the actions at its end, if it has any. */
export function Toast({
  tone,
  words,
  detail,
  leaving = false,
  actions,
  countdown,
  onHold,
  onEscape,
}: {
  tone: ToastTone;
  words: string;
  /** A second line under the words. */
  detail?: string | undefined;
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
  return (
    <li
      ref={swipe.ref}
      className={TOAST_CARD}
      data-tone={tone}
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
      <span className={TOAST_GLYPH} aria-hidden="true">
        {glyphs.map((shown) => (
          <span
            key={shown}
            className={`col-start-1 row-start-1 flex ${GLYPH_INK[shown]}`}
            data-tone={shown}
            data-turn={shown === turn.now ? GLYPH_TURN.NOW : GLYPH_TURN.WAS}
          >
            <ToneGlyph tone={shown} />
          </span>
        ))}
      </span>
      <span className={TOAST_TEXT} key={words}>
        <span className="luke-toast-words line-clamp-2 wrap-anywhere">
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.SPAN}>
            {words}
          </Text>
        </span>
        {detail === undefined ? null : (
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

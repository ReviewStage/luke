import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { AlertIcon, CircleCheckIcon, InboxIcon } from "../../face/glyphs.js";
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
 */

/** What a toast reports: the act done, the act refused, something asked of the developer, or work still under way. */
export const TOAST_TONE = {
  DONE: "done",
  FAILED: "failed",
  ASK: "ask",
  WORKING: "working",
} as const;

export type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE];

/** Which of a toast's glyphs is which: the one it leads with now, and the one it led with before its tone last changed. */
const GLYPH_TURN = {
  NOW: "now",
  WAS: "was",
} as const;

/** The glyph a toast leads with: a check for what was done, an alert for what was refused, the Inbox's tray for an ask, and the spinner's ring for work under way. */
function ToneGlyph({ tone }: { tone: ToastTone }): React.JSX.Element {
  switch (tone) {
    case TOAST_TONE.DONE:
      return <CircleCheckIcon />;
    case TOAST_TONE.FAILED:
      return <AlertIcon />;
    case TOAST_TONE.ASK:
      return <InboxIcon />;
    case TOAST_TONE.WORKING:
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
      className="luke-toast"
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
      <span className="luke-toast-glyph" aria-hidden="true">
        {glyphs.map((shown) => (
          <span
            key={shown}
            data-tone={shown}
            data-turn={shown === turn.now ? GLYPH_TURN.NOW : GLYPH_TURN.WAS}
          >
            <ToneGlyph tone={shown} />
          </span>
        ))}
      </span>
      <span className="luke-toast-text" key={words}>
        <span className="luke-toast-words">
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.SPAN}>
            {words}
          </Text>
        </span>
        {detail === undefined ? null : (
          <span className="luke-toast-detail">
            <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              {detail}
            </Text>
          </span>
        )}
      </span>
      {actions}
      {countdown === undefined ? null : (
        <span
          className="luke-toast-countdown"
          aria-hidden="true"
          style={cssCustomProperties({ "--luke-toast-hold": `${countdown}ms` })}
        />
      )}
    </li>
  );
}

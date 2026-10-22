import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { AlertIcon, CircleCheckIcon, InboxIcon } from "../../face/glyphs.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * toast.tsx -- one passing notice: a glyph for what it reports, its words, an optional second line under them, and at most one action at its end.
 *
 * A toast is a card of its words, each cut at two lines, led by the glyph its
 * tone picks: a check for what was done, an alert for what was refused, and
 * the Inbox's tray for an ask. One with no action is never pointed at, so
 * clicks pass through it; one with an action (`ToastActions`, passed as
 * `actions`) takes the pointer, pauses its hold while the pointer is over it
 * or focus is in it, each of which it keeps apart so that one ending while
 * the other stands lets nothing run, and is dismissed by Escape while focus
 * is in it. It arrives on the pair every arriving element rides and leaves
 * first, over `--luke-duration-exit`, once `leaving` says so; whoever owns
 * its life holds it mounted through that.
 *
 * What it says aloud is the stack's (`ToastStack`), so the words here are
 * plain text. The toast takes no class or style; where it stands is the
 * stack's.
 */

/** What a toast reports: the act done, the act refused, or something asked of the developer. */
export const TOAST_TONE = {
  DONE: "done",
  FAILED: "failed",
  ASK: "ask",
} as const;

export type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE];

/** The glyph a toast leads with: a check for what was done, an alert for what was refused, and the Inbox's tray for an ask. */
function ToneGlyph({ tone }: { tone: ToastTone }): React.JSX.Element {
  switch (tone) {
    case TOAST_TONE.DONE:
      return <CircleCheckIcon />;
    case TOAST_TONE.FAILED:
      return <AlertIcon />;
    case TOAST_TONE.ASK:
      return <InboxIcon />;
  }
}

/** One toast: its tone, words and detail, and the actions at its end, if it has any. */
export function Toast({
  tone,
  words,
  detail,
  leaving = false,
  actions,
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
  /** Told when the pointer or focus first rests on the toast, and when both have left it. Only a toast with actions holds. */
  onHold?: (holding: boolean) => void;
  /** Told when Escape is pressed while focus is in the toast: dismiss it. */
  onEscape?: () => void;
}): React.JSX.Element {
  const held = useRef({ pointer: false, focus: false });
  const hold = (by: keyof typeof held.current, holding: boolean) => {
    const was = held.current.pointer || held.current.focus;
    held.current = { ...held.current, [by]: holding };
    const now = held.current.pointer || held.current.focus;
    if (now !== was) onHold?.(now);
  };
  return (
    <li
      className="luke-toast"
      data-tone={tone}
      data-action={actions === undefined ? undefined : "true"}
      data-leaving={leaving ? "true" : undefined}
      {...(actions === undefined
        ? undefined
        : {
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
      <ToneGlyph tone={tone} />
      <span className="luke-toast-text">
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
    </li>
  );
}

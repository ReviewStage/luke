import { Duration } from "effect";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { AlertIcon, CircleCheckIcon, InboxIcon } from "../../icons/lucide-glyphs.js";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { SpinnerRing } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { useToastSwipe } from "./toast-swipe.js";

export type ToastTone =
  | typeof STATUS_TONE.COMPLETE
  | typeof STATUS_TONE.DANGER
  | typeof STATUS_TONE.ATTENTION
  | typeof STATUS_TONE.WORKING;

export const TOAST_HOLD = {
  DONE: Duration.seconds(3),
  UNDO: Duration.seconds(5),
  FAILED: Duration.seconds(6),
} as const;

const MARK_INK = "text-foreground";

const SECOND_MS = 1000;

const GLYPH_TURN = {
  NOW: "now",
  WAS: "was",
} as const;

const GLYPH_INK = {
  [STATUS_TONE.COMPLETE]: "text-tone-ink",
  [STATUS_TONE.DANGER]: "text-tone-ink",
  [STATUS_TONE.ATTENTION]: "text-muted-foreground",
  [STATUS_TONE.WORKING]: "text-muted-foreground",
} as const satisfies Record<ToastTone, string>;

const TOAST_CARD =
  "ui-toast relative flex items-start gap-icon-gap rounded-toast border border-border-strong bg-background px-list-inset py-row-inset shadow-toast data-[action=true]:touch-pan-y data-[action=true]:pr-toast-gap";

const TOAST_GLYPH =
  "ui-toast-glyph mt-toast-glyph-inset grid size-control-icon flex-none [&_svg]:size-full";

const TOAST_TEXT =
  "ui-toast-text flex min-w-0 flex-1 flex-col gap-toast-line-gap py-toast-text-inset";

const TOAST_COUNTDOWN =
  "ui-toast-countdown pointer-events-none absolute inset-x-toast-inset bottom-0 h-toast-line-gap origin-left rounded-full bg-muted-foreground opacity-40";

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

export function Toast({
  tone,
  glyph,
  mark,
  words,
  detail,
  replayUnmasked = false,
  leaving = false,
  actions,
  countdown,
  onHold,
  onEscape,
}: {
  tone: ToastTone;
  glyph?: (() => React.JSX.Element) | undefined;
  mark?: MarkProvider | undefined;
  words: string;
  detail?: string | undefined;
  replayUnmasked?: boolean | undefined;
  leaving?: boolean;
  actions?: ReactNode;
  countdown?: number | undefined;
  onHold?: (holding: boolean) => void;
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
            className={`col-start-1 row-start-1 flex ${mark !== undefined && shown === turn.now ? MARK_INK : GLYPH_INK[shown]}`}
            data-tone={shown}
            data-turn={shown === turn.now ? GLYPH_TURN.NOW : GLYPH_TURN.WAS}
          >
            {shown !== turn.now ? (
              <ToneGlyph tone={shown} />
            ) : mark !== undefined ? (
              <ProviderMark provider={mark} size={PROVIDER_MARK_SIZE.SLOT} />
            ) : Lead !== undefined ? (
              <Lead />
            ) : (
              <ToneGlyph tone={shown} />
            )}
          </span>
        ))}
      </span>
      <span className={TOAST_TEXT} key={words}>
        <span className="ui-toast-words line-clamp-2 wrap-anywhere">
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.SPAN}>
            <ReplayWords unmasked={replayUnmasked}>{words}</ReplayWords>
          </Text>
        </span>
        {detail === undefined ? null : (
          <span className="ui-toast-detail line-clamp-2 wrap-anywhere">
            <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              <ReplayWords unmasked={replayUnmasked}>{detail}</ReplayWords>
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
            "--ui-toast-hold": `${countdown}ms`,
            "--ui-toast-seconds": Math.max(1, Math.round(countdown / SECOND_MS)),
          })}
        />
      )}
    </li>
  );
}

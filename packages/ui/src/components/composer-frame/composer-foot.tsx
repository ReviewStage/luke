import type { ShortcutChord } from "@luke/settings/shortcuts";
import type { ReactNode } from "react";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  type BusyProps,
  Button,
  IconButton,
  SUBMIT_STATE,
} from "../button/button.js";
import { ErrorState, type ErrorStateRemedy } from "../error-state/error-state.js";
import { LengthCounter } from "../length-counter/length-counter.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * composer-foot.tsx -- the foot of every message box: its tools, how near its limit its words stand, a call's status, the round send, and one note under them.
 *
 * Every box a message is written in ends the same way, under its field and
 * inside its `ComposerFrame`; the files handed to it stand over the field,
 * as the sent message draws them (`ComposerBody`). The foot is one bar: at its start the
 * tools the owner hands it (attach, mention, skill), and at its end the
 * length counter, which says nothing until the words reach four fifths of
 * the limit (`LengthCounter`), the owner's own presses (the microphone, a
 * model), a call's status where a call stands, set a step off the send so
 * the two discs never read as a pair, and the round send last. While the
 * box holds something in the bar's place, a dictation's strip, the strip
 * takes the bar's room and the call's status stays beside it, so neither is
 * left with no way to reach it.
 *
 * The send never changes size or place. It takes no press while the box is
 * empty or `held` (a file still being read), and while a send it made is
 * out it is busy, the shape every button shares: it refuses another press,
 * is named by its busy words, and turns its ring only once the send has
 * been out a moment, so one that lands at once never flashes it. Inside a
 * frame that is a form it submits the form, as Enter in the field does;
 * given `onSend` it acts on its own press instead.
 *
 * A send that settles something with no message to send, a notice's "Got it",
 * reads in words (`inWords`) rather than as the round glyph, and is the
 * same press otherwise. Where the owner hands a `stop`, as an agent's box
 * does while a turn runs and the box holds nothing, Stop stands in the
 * send's place, the same round button wearing Stop's glyph, busy while the
 * stop it asked for is out.
 *
 * Under the bar stands at most one note, the box's one line for what went
 * wrong or what it did to the words: why a post did not go, with Retry
 * where trying again can mend it or a remedy where it cannot ("Unarchive"),
 * a paste cut to the room left, or a file refused. It is a failure's line (`ErrorState`), said as it lands,
 * with what mends it under the line where that is more than one press
 * (`mends`), as a closed agent's Continue in new agent is.
 *
 * Where the foot stands in its frame is the frame's look: a card's foot at
 * a card's inset, a field's and an input's a step tighter, and a bare
 * frame's flush with the words over it. A box still
 * loading draws the same foot (`ComposerFootSkeleton`), its tools' and its
 * end's placeholders handed by the owner and the send's disc last, so the
 * placeholder lands where the foot does.
 *
 * It is drawn in Tailwind utilities over the theme; `composer-foot.css`
 * keeps the one rule that turns on what the bar holds (`:has()`).
 */

/** The send's press: its name, whether the box has anything to send, and whether a send it made is still out. */
export type ComposerSend = {
  /** What it does, which is its name and its hint: "Send", "Reply", "Comment". */
  label: string;
  /** Whether the box holds nothing to send, which leaves it taking no press. */
  empty: boolean;
  /** Whether it takes no press for another reason, as a file still being read. */
  held?: boolean | undefined;
  /** Its own press, where the frame is no form whose submit sends it. */
  onSend?: (() => void) | undefined;
  /** Whether it reads as its label in words, where its press settles something and sends no message ("Got it"). */
  inWords?: boolean | undefined;
  /** The key that sends where it is no bare Enter, drawn on its hint: ⌘↩ for a box whose Enter breaks the line. */
  chord?: ShortcutChord | undefined;
} & BusyProps;

/** Stop in the send's place: its name, its press, and whether the stop it asked for is still out. */
export type ComposerStop = {
  /** What it does, which is its name and its hint: "Stop". */
  label: string;
  onStop: () => void;
} & BusyProps;

/** The one line under the bar: what it says, and Retry where trying again can mend it. */
export interface ComposerNote {
  /** What went wrong or what happened to the words, as "Only the first 4,000 characters were pasted." */
  readonly words: string;
  /** Retry's press, for a send that was refused. */
  readonly onRetry?: (() => void) | undefined;
  /** The press that mends what went wrong where trying again alone cannot, as "Unarchive". */
  readonly remedy?: ErrorStateRemedy | undefined;
  /** What mends it under the line where that is more than one press, as a closed agent's Continue in new agent. */
  readonly mends?: ReactNode;
}

/**
 * The foot's own box, at its frame's inset: a card's at the card's, a
 * field's or an input's a step tighter in its well, and a bare frame's flush
 * with the words over it, since the card around it insets both.
 */
const FOOT =
  "luke-composer-foot flex flex-col gap-tight-gap px-luke-12 pt-0 pb-luke-12 " +
  "group-data-[look=field]/composer:px-luke-6 group-data-[look=field]/composer:pt-luke-2 group-data-[look=field]/composer:pb-luke-6 " +
  "group-data-[look=input]/composer:px-luke-6 group-data-[look=input]/composer:pt-luke-2 group-data-[look=input]/composer:pb-luke-6 " +
  "group-data-[look=bare]/composer:px-0";

/** A call stands a step off the send, so End call and Send never read as a pair, and beside a dictation's strip at the bar's end. */
const CALL =
  "luke-composer-foot-call me-tight-gap flex flex-none items-center gap-tight-gap [.luke-composer-foot-strip+&]:me-0";

/** The foot's own box: its bar and its note, stacked. */
function FootBox({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={FOOT}>{children}</div>;
}

/** The bar: the tools at its start and the end's presses, or a strip in their place. */
function FootBar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="luke-composer-foot-bar flex min-h-control items-center justify-between gap-block-gap">
      {children}
    </div>
  );
}

/** The bar's start, which gives way first as the bar narrows. */
function FootTools({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="luke-composer-foot-tools flex min-w-0 items-center gap-tight-gap">
      {children}
    </div>
  );
}

/** The bar's end: the counter, the owner's presses, a call, and the send last. */
function FootEnd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="luke-composer-foot-end ms-auto flex flex-none items-center gap-tight-gap">
      {children}
    </div>
  );
}

/** A call's status, a step off the send. */
function FootCall({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={CALL}>{children}</div>;
}

/** The send: the round submit in the panel's ink, busy while its send is out. */
function SendButton({ send }: { send: ComposerSend }): React.JSX.Element {
  const { label, empty, held = false, inWords = false, onSend, chord } = send;
  const busy = send.busy === true ? { busy: true, busyLabel: send.busyLabel } : {};
  const type = onSend === undefined ? BUTTON_TYPE.SUBMIT : BUTTON_TYPE.BUTTON;
  if (inWords) {
    return (
      <Button
        variant={BUTTON_VARIANT.INK}
        type={type}
        disabled={empty || held}
        onClick={onSend}
        {...busy}
      >
        {label}
      </Button>
    );
  }
  return (
    <Tooltip label={label} chord={chord}>
      <IconButton
        submit={SUBMIT_STATE.READY}
        variant={BUTTON_VARIANT.INK}
        label={label}
        type={type}
        disabled={empty || held}
        onClick={onSend}
        {...busy}
      />
    </Tooltip>
  );
}

/** Stop, the round button in the send's place wearing Stop's glyph, busy while its stop is out. */
function StopButton({ stop }: { stop: ComposerStop }): React.JSX.Element {
  const busy = stop.busy === true ? { busy: true, busyLabel: stop.busyLabel } : {};
  return (
    <Tooltip label={stop.busy === true ? stop.busyLabel : stop.label}>
      <IconButton
        submit={SUBMIT_STATE.STREAMING}
        variant={BUTTON_VARIANT.INK}
        label={stop.label}
        type={BUTTON_TYPE.BUTTON}
        onClick={stop.onStop}
        {...busy}
      />
    </Tooltip>
  );
}

/** A message box's foot: a bar of `tools`, the counter, `actions`, `call` and the send or `stop`, or `strip` in the bar's place, and `note` under it. */
export function ComposerFoot({
  send,
  stop,
  tools,
  actions,
  call,
  counter,
  strip,
  note,
}: {
  send: ComposerSend;
  /** Stop, which stands in the send's place while it is handed. */
  stop?: ComposerStop | undefined;
  /** The presses at the bar's start: attach, mention, skill. */
  tools?: ReactNode;
  /** The owner's own presses at the bar's end, before the call and the send: the microphone, a model. */
  actions?: ReactNode;
  /** A call's status and its controls, where a call stands. */
  call?: ReactNode;
  /** How many characters the field holds of how many it takes, said from four fifths of the way. */
  counter?: { readonly length: number; readonly limit: number } | undefined;
  /** What stands in the bar's place while it holds, a dictation's strip; the call stays beside it. */
  strip?: ReactNode;
  /** The one line under the bar, where there is something to say. */
  note?: ComposerNote | undefined;
}): React.JSX.Element {
  const callPart = call === undefined || call === null ? null : <FootCall>{call}</FootCall>;
  return (
    <FootBox>
      <FootBar>
        {strip === undefined || strip === null ? (
          <>
            <FootTools>{tools}</FootTools>
            <FootEnd>
              {counter === undefined ? null : (
                <LengthCounter length={counter.length} limit={counter.limit} />
              )}
              {actions}
              {callPart}
              {stop === undefined ? <SendButton send={send} /> : <StopButton stop={stop} />}
            </FootEnd>
          </>
        ) : (
          <>
            <div className="luke-composer-foot-strip flex min-w-0 flex-1 items-center">{strip}</div>
            {callPart}
          </>
        )}
      </FootBar>
      {note === undefined ? null : (
        <div className="luke-composer-foot-note flex flex-col items-start gap-tight-gap">
          <ErrorState onRetry={note.onRetry} remedy={note.remedy}>
            {note.words}
          </ErrorState>
          {note.mends}
        </div>
      )}
    </FootBox>
  );
}

/** A box's foot while the box is still loading: the same bar, its tools and its end holding the placeholders the owner hands, and the send's disc where the send will stand. */
export function ComposerFootSkeleton({
  tools,
  actions,
}: {
  /** The placeholders of the presses at the bar's start. */
  tools?: ReactNode;
  /** The placeholders of the owner's own presses at the bar's end, before the send. */
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <FootBox>
      <FootBar>
        <FootTools>{tools}</FootTools>
        <FootEnd>
          {actions}
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} />
        </FootEnd>
      </FootBar>
    </FootBox>
  );
}

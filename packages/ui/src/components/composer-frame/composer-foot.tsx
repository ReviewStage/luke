import type { ReactNode } from "react";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  type BusyProps,
  IconButton,
  SUBMIT_STATE,
} from "../button/button.js";
import { ErrorState } from "../error-state/error-state.js";
import { LengthCounter } from "../length-counter/length-counter.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * composer-foot.tsx -- the foot of every message box: the files it holds, its tools, how near its limit its words stand, a call's status, the round send, and one note under them.
 *
 * Every box a message is written in ends the same way, under its field and
 * inside its `ComposerFrame`. First the chips of the files handed to it, in
 * a row that wraps, where it holds any. Then one bar: at its start the
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
 * Under the bar stands at most one note, the box's one line for what went
 * wrong or what it did to the words: why a post did not go, with Retry
 * where trying again can mend it, a paste cut to the room left, or a file
 * refused. It is a failure's line (`ErrorState`), said as it lands.
 *
 * Where the foot stands in its frame is the frame's look: a card's foot at
 * a card's inset, a field's and an input's a step tighter, and a bare
 * frame's flush with the words over it (`composer-frame.css`).
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
} & BusyProps;

/** The one line under the bar: what it says, and Retry where trying again can mend it. */
export interface ComposerNote {
  /** What went wrong or what happened to the words, as "Only the first 4,000 characters were pasted." */
  readonly words: string;
  /** Retry's press, for a send that was refused. */
  readonly onRetry?: (() => void) | undefined;
}

/** The send: the round submit in the panel's ink, busy while its send is out. */
function SendButton({ send }: { send: ComposerSend }): React.JSX.Element {
  const { label, empty, held = false, onSend } = send;
  const busy = send.busy === true ? { busy: true, busyLabel: send.busyLabel } : {};
  return (
    <Tooltip label={label}>
      <IconButton
        submit={SUBMIT_STATE.READY}
        variant={BUTTON_VARIANT.INK}
        label={label}
        type={onSend === undefined ? BUTTON_TYPE.SUBMIT : BUTTON_TYPE.BUTTON}
        disabled={empty || held}
        onClick={onSend}
        {...busy}
      />
    </Tooltip>
  );
}

/** A message box's foot: `files` over a bar of `tools`, the counter, `actions`, `call` and the send, or `strip` in the bar's place, and `note` under it. */
export function ComposerFoot({
  send,
  files,
  tools,
  actions,
  call,
  counter,
  strip,
  note,
}: {
  send: ComposerSend;
  /** The chips of the files handed to the box, where it holds any. */
  files?: ReactNode;
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
  const callPart =
    call === undefined || call === null ? null : (
      <div className="luke-composer-foot-call">{call}</div>
    );
  return (
    <div className="luke-composer-foot">
      {files === undefined || files === null ? null : (
        <div className="luke-composer-foot-files">{files}</div>
      )}
      <div className="luke-composer-foot-bar">
        {strip === undefined || strip === null ? (
          <>
            <div className="luke-composer-foot-tools">{tools}</div>
            <div className="luke-composer-foot-end">
              {counter === undefined ? null : (
                <LengthCounter length={counter.length} limit={counter.limit} />
              )}
              {actions}
              {callPart}
              <SendButton send={send} />
            </div>
          </>
        ) : (
          <>
            <div className="luke-composer-foot-strip">{strip}</div>
            {callPart}
          </>
        )}
      </div>
      {note === undefined ? null : (
        <div className="luke-composer-foot-note">
          <ErrorState onRetry={note.onRetry}>{note.words}</ErrorState>
        </div>
      )}
    </div>
  );
}

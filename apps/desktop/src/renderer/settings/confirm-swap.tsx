import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useEffect, useId, useRef } from "react";
import { BusyLabel } from "../spinner";
import { focusWhenVisible, useStagedFocus } from "../staged-focus";
import {
  CONFIRM_STAGE,
  type ConfirmStage,
  confirmAsked,
  confirmWithdrawable,
} from "./confirm-state";

/* The safe answer arrives first and the one that cannot be taken back lands a
   beat behind it, on the same stagger the panel's rows fan open with. Their
   order on the line is the order they arrive in, so this is their place in it
   rather than a delay written per button. */
const ANSWER_INDEX = {
  KEEP: 0,
  ACT: 1,
} as const;

function answerOrder(index: number): React.CSSProperties {
  return cssCustomProperties({ "--answer-index": index });
}

/**
 * A question and the two answers it takes. One object rather than six props
 * that only mean anything together: a question with no word on its answer is
 * not a state a line can be in.
 */
interface SwapQuestion {
  /** What is being asked, drawn beside the answers and naming the group they stand in. */
  question: string;
  stage: ConfirmStage;
  /** The dangerous answer's word, and what a reader is told while it runs, under the spinner. */
  verb: string;
  running: string;
  onKeep: () => void;
  onAct: () => void;
}

/** Where focus goes back to once an answer has been given: the line itself. */
const RETURNABLE = "button:not([disabled]), select:not([disabled])";

/**
 * A question and its answer on the line the control was drawn on.
 *
 * The two layers are both mounted: `data-drawn`, `aria-hidden`, and `inert`
 * trade which one answers, so neither layer springs from nothing. The controls
 * hold the line's shape; the confirm stands over the whole line rather than in
 * the controls' cell, with the question in the words the line's own copy gives
 * up while it is asked, so asking never re-shapes the line and the question is
 * read rather than guessed from a red verb. The question takes
 * the focus to the answer that changes nothing, because the control that asked
 * is inert by the time the confirm is drawn and of the two places focus could
 * land only one is safe to arrive on with a key already pressed. Answering
 * hands focus back to the line. Escape withdraws the question rather than
 * closing the panel behind it — but only while it is still a question.
 *
 * A line with nothing to ask about right now draws the controls alone.
 */
export function ConfirmSwap({
  confirm,
  children,
}: {
  /** The question, absent while the line has no confirming action to offer. */
  confirm?: SwapQuestion;
  /** The controls the confirm stands in for. */
  children: React.ReactNode;
}): React.JSX.Element {
  const stage = confirm?.stage ?? CONFIRM_STAGE.RESTING;
  const asked = confirm !== undefined && confirmAsked(stage);
  const acting = stage === CONFIRM_STAGE.ACTING;
  const keep = useRef<HTMLButtonElement | null>(null);
  const controls = useRef<HTMLSpanElement | null>(null);
  const returnFocus = useRef(false);
  const questionId = useId();

  useStagedFocus(keep, asked && !acting);

  // Answering hands focus back to the line: to the control that asked if its
  // subject survived, and to whatever now stands in its place if it did not.
  // Only an answer moves focus — a question the panel closing withdrew was
  // never answered, and reaching into a shape that is leaving would pull it
  // back open.
  useEffect(() => {
    if (asked || !returnFocus.current) return;
    returnFocus.current = false;
    return focusWhenVisible(controls.current?.querySelector<HTMLElement>(RETURNABLE) ?? null);
  }, [asked]);

  const keepPressed = () => {
    if (!confirmWithdrawable(stage)) return;
    returnFocus.current = true;
    confirm?.onKeep();
  };

  return (
    <span className="credential-actions">
      <span
        ref={controls}
        className="settings-actions credential-controls"
        data-drawn={String(!asked)}
        aria-hidden={asked}
        inert={asked}
      >
        {children}
      </span>
      {confirm ? (
        /* The group is named by the question it draws, so the two answers are
           read as answers rather than as a Cancel and a Delete that could
           belong to anything on the line. */
        <fieldset
          className="settings-actions credential-confirm"
          aria-labelledby={questionId}
          data-drawn={String(asked)}
          aria-hidden={!asked}
          inert={!asked}
          onKeyDown={(event) => {
            // Escape withdraws the question rather than closing the panel the
            // question was asked on — but only while it is still a question.
            // Once the answer has gone there is nothing here for Escape to take
            // back, so it is left to mean what it means everywhere else in the
            // panel.
            if (event.key !== "Escape" || !confirmWithdrawable(stage)) return;
            event.stopPropagation();
            keepPressed();
          }}
        >
          <span id={questionId} className="credential-question">
            {confirm.question}
          </span>
          <button
            type="button"
            ref={keep}
            className="toolbar-button"
            style={answerOrder(ANSWER_INDEX.KEEP)}
            disabled={acting}
            onClick={keepPressed}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger-button"
            style={answerOrder(ANSWER_INDEX.ACT)}
            disabled={acting}
            onClick={() => {
              returnFocus.current = true;
              confirm.onAct();
            }}
          >
            <BusyLabel busy={acting} label={confirm.running}>
              {confirm.verb}
            </BusyLabel>
          </button>
        </fieldset>
      ) : null}
    </span>
  );
}

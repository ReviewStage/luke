import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReportedFailure } from "./reported-failure.js";

/**
 * What a line's dangerous control is currently asking.
 *
 * Every action that asks first is one this panel cannot undo: deleting a
 * stored key, ending a grant at the provider that issued it, signing out,
 * erasing the account. The app never hands any of them back — the main process
 * reports where a credential resolved from and nothing more — so a control
 * pressed by mistake costs a trip somewhere else to put right. That is what
 * the confirm is for, and it is why such a control asks rather than acts.
 */
export const CONFIRM_STAGE = {
  /** Nothing asked: the line is showing what can be done. */
  RESTING: "resting",
  /** Asked, and waiting to be answered. */
  ASKING: "asking",
  /** Answered, and the action is running. */
  ACTING: "acting",
} as const;

export type ConfirmStage = (typeof CONFIRM_STAGE)[keyof typeof CONFIRM_STAGE];

/** What is true around the question, which is what decides whether it survives. */
export interface ConfirmSurroundings {
  /** True while the thing the question is about is still there. */
  subject: boolean;
  /** True while the surface the question was asked on is on screen. */
  surfaceOpen: boolean;
}

/**
 * What the line draws, given the question it is holding and what has become
 * true around it.
 *
 * A question outlives neither its subject nor the surface it was asked on. The
 * subject going takes it: there is nothing left to confirm, and a confirm left
 * standing where a key used to be would be pointed at whatever is stored there
 * next. The surface going off screen takes it too — a confirm is a question put
 * to somebody standing in front of it, and one still waiting behind another
 * tab would be the first thing under the pointer the next time it was shown,
 * with nobody having asked for it.
 *
 * Both are the opposite of a key half-entered, which is the one thing here that
 * does survive a close: that is work someone is in the middle of, and this is a
 * question they walked away from.
 *
 * An answer already sent is the exception to both. It is no longer a question,
 * so it finishes wherever it is and the line reports what came back.
 */
function confirmStage(
  held: ConfirmStage,
  { subject, surfaceOpen }: ConfirmSurroundings,
): ConfirmStage {
  if (held === CONFIRM_STAGE.ACTING) return held;
  if (!subject || !surfaceOpen) return CONFIRM_STAGE.RESTING;
  return held;
}

/**
 * Whether the confirm is what the line is showing, rather than its controls.
 * An action in flight still draws it, so the answer that was given stays on
 * screen saying what it is doing.
 */
export function confirmAsked(stage: ConfirmStage): boolean {
  return stage !== CONFIRM_STAGE.RESTING;
}

/**
 * Whether the question can still be taken back. Only one that is still a
 * question can be: an answer already given is nobody's to withdraw, and a line
 * that forgot an action it had sent would draw the control back over something
 * already on its way out — and take a second ask over the top of the first.
 *
 * This is the same rule `confirmStage` keeps against the surface closing, said
 * for the controls: `Cancel` goes disabled while the action is in flight, so
 * today nothing focused inside the dialog can reach Escape, but the invariant
 * must not rest on which element happens to hold the caret.
 */
export function confirmWithdrawable(stage: ConfirmStage): boolean {
  return stage === CONFIRM_STAGE.ASKING;
}

/** Why a confirmed act was refused: its sentence, and the refusal as the app reports it. */
export interface ConfirmRejection {
  readonly words: string;
  readonly failure: ReportedFailure;
}

/** What a refused answer is reported as, built by the app that asked from the answer that refused it. */
export type ConfirmFailure = (refused: ActionResult) => ReportedFailure;

/**
 * The act a question confirms, as its caller's mutation stands (`useMutation`):
 * how it is sent, answering once it settled however it went; whether it is
 * out; the newest answer's refusal, none while out, taken, or let go; and how
 * that refusal is let go. Nothing here keeps an act's pending or refusal of
 * its own.
 */
export interface ConfirmAct {
  readonly run: () => Promise<unknown>;
  readonly busy: boolean;
  readonly refused: ActionResult | undefined;
  readonly reset: () => void;
}

/** An act with nothing to wait on or refuse, as a question whose answer happens at once, or is sent on and never heard, confirms: `act` runs as the question is answered. */
export function neverBusyAct(act: () => void): ConfirmAct {
  return {
    run: () => {
      act();
      return Promise.resolve();
    },
    busy: false,
    refused: undefined,
    reset: () => undefined,
  };
}

/** One confirming action, as the line that offers it holds it. */
export interface HeldConfirm {
  stage: ConfirmStage;
  /** Why the answer was refused, if it was, and the refusal as reported. A refusal is an answer too. */
  rejection: ConfirmRejection | undefined;
  /** True while the answer that was given is running. */
  busy: boolean;
  ask: () => void;
  keep: () => void;
  run: () => void;
  /**
   * Forgets what the last answer was refused for. A line whose other controls
   * begin something new says so by clearing the answer to a question nobody is
   * asking any more.
   */
  clear: () => void;
}

/**
 * One confirming action, held for the line that offers it: the stage, the
 * refusal, and the three things that move them. The stage is corrected during
 * the render that discovers its subject or its surface gone rather than from an
 * effect, the way an emptied filter is: a question whose subject or whose
 * surface has gone must never be drawn once and taken back on the next frame.
 * The act and its refusal are the caller's mutation's (`act`), and a refusal
 * is handed on with what `failure` builds of the answer that refused it, so
 * whatever draws it reports it.
 *
 * Note that the question reads a refusal only of an answer it gave itself,
 * since the mutation may be one a control beside it sends too, and lets go
 * of only such a refusal, so what another press left stands.
 *
 * Note that an answer stands acting until its run has settled and the
 * mutation no longer says it is out, because the mutation's own state
 * reaches the render a notification after its run answers, and the refusal
 * it carries must be the one drawn as the answer lands.
 */
export function useConfirm(
  surroundings: ConfirmSurroundings,
  act: ConfirmAct,
  failure: ConfirmFailure,
): HeldConfirm {
  const [held, setHeld] = useState<ConfirmStage>(CONFIRM_STAGE.RESTING);
  const [answered, setAnswered] = useState(false);
  // Whether the act's newest answer is one this question gave, which alone it reads as its own.
  const [ran, setRan] = useState(false);
  const newestRan = useRef(ran);
  newestRan.current = ran;
  if (held === CONFIRM_STAGE.ACTING && answered && !act.busy) {
    setHeld(CONFIRM_STAGE.RESTING);
    setAnswered(false);
  }
  const stage = confirmStage(held, surroundings);
  if (stage !== held) setHeld(stage);
  // Read by the withdrawal, which a dialog holds as a callback rather than a
  // render's closure: an Escape must find the stage as it stands, not as it
  // stood when the callback was made.
  const standing = useRef(stage);
  standing.current = stage;
  // The act is read as the press lands, so the confirm handed down stands across draws and still runs the newest.
  const newestAct = useRef(act);
  newestAct.current = act;

  const keep = useCallback(() => {
    if (!confirmWithdrawable(standing.current)) return;
    setHeld(CONFIRM_STAGE.RESTING);
  }, []);
  // Whatever the last answer was refused for is let go on the way in: a
  // fresh question is a fresh decision, not one carrying the last one's
  // answer under it.
  const letGo = useCallback(() => {
    if (newestRan.current) newestAct.current.reset();
    setRan(false);
  }, []);
  const ask = useCallback(() => {
    letGo();
    setHeld(CONFIRM_STAGE.ASKING);
  }, [letGo]);
  const run = useCallback(() => {
    setRan(true);
    setHeld(CONFIRM_STAGE.ACTING);
    setAnswered(false);
    // Settled however the run went, because a carrier that rejects rather
    // than answering is still a line that has to be handed back: one left
    // acting would draw a confirm nobody can take back.
    void newestAct.current
      .run()
      .catch(() => undefined)
      .finally(() => setAnswered(true));
  }, []);

  // Note that the failure is built of the answer once per answer, by the
  // newest builder, since the app keeps a refusal the same one for as long
  // as its answer is.
  const newestFailure = useRef(failure);
  newestFailure.current = failure;
  const refused = stage === CONFIRM_STAGE.ACTING || !ran ? undefined : act.refused;
  const rejection = useMemo(
    () =>
      refused === undefined || refused.status === ACTION_RESULT_STATUS.ACCEPTED
        ? undefined
        : { words: refused.reason, failure: newestFailure.current(refused) },
    [refused],
  );
  return useMemo(
    () => ({
      stage,
      rejection,
      busy: stage === CONFIRM_STAGE.ACTING,
      ask,
      keep,
      clear: letGo,
      run,
    }),
    [stage, rejection, ask, keep, letGo, run],
  );
}

import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReportedFailure } from "./reported-failure.js";

export const CONFIRM_STAGE = {
  RESTING: "resting",
  ASKING: "asking",
  ACTING: "acting",
} as const;

export type ConfirmStage = (typeof CONFIRM_STAGE)[keyof typeof CONFIRM_STAGE];

export interface ConfirmSurroundings {
  subject: boolean;
  surfaceOpen: boolean;
}

function confirmStage(
  held: ConfirmStage,
  { subject, surfaceOpen }: ConfirmSurroundings,
): ConfirmStage {
  if (held === CONFIRM_STAGE.ACTING) return held;
  if (!subject || !surfaceOpen) return CONFIRM_STAGE.RESTING;
  return held;
}

export function confirmAsked(stage: ConfirmStage): boolean {
  return stage !== CONFIRM_STAGE.RESTING;
}

export function confirmWithdrawable(stage: ConfirmStage): boolean {
  return stage === CONFIRM_STAGE.ASKING;
}

export interface ConfirmRejection {
  readonly words: string;
  readonly failure: ReportedFailure;
}

export type ConfirmFailure = (refused: ActionResult) => ReportedFailure;

export interface ConfirmAct {
  readonly run: () => Promise<unknown>;
  readonly busy: boolean;
  readonly refused: ActionResult | undefined;
  readonly reset: () => void;
}

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

export interface HeldConfirm {
  stage: ConfirmStage;
  rejection: ConfirmRejection | undefined;
  busy: boolean;
  ask: () => void;
  keep: () => void;
  run: () => void;
  clear: () => void;
  forget: () => void;
}

export function useConfirm(
  surroundings: ConfirmSurroundings,
  act: ConfirmAct,
  failure: ConfirmFailure,
): HeldConfirm {
  const [held, setHeld] = useState<ConfirmStage>(CONFIRM_STAGE.RESTING);
  const [answered, setAnswered] = useState(false);
  const [ran, setRan] = useState(false);
  const newestRan = useRef(ran);
  newestRan.current = ran;
  if (held === CONFIRM_STAGE.ACTING && answered && !act.busy) {
    setHeld(CONFIRM_STAGE.RESTING);
    setAnswered(false);
  }
  const stage = confirmStage(held, surroundings);
  if (stage !== held) setHeld(stage);
  const standing = useRef(stage);
  standing.current = stage;
  const newestAct = useRef(act);
  newestAct.current = act;

  const keep = useCallback(() => {
    if (!confirmWithdrawable(standing.current)) return;
    setHeld(CONFIRM_STAGE.RESTING);
  }, []);
  const letGo = useCallback(() => {
    if (newestRan.current) newestAct.current.reset();
    setRan(false);
  }, []);
  const forget = useCallback(() => setRan(false), []);
  const ask = useCallback(() => {
    letGo();
    setHeld(CONFIRM_STAGE.ASKING);
  }, [letGo]);
  const run = useCallback(() => {
    setRan(true);
    setHeld(CONFIRM_STAGE.ACTING);
    setAnswered(false);
    void newestAct.current
      .run()
      .catch(() => undefined)
      .finally(() => setAnswered(true));
  }, []);

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
      forget,
      run,
    }),
    [stage, rejection, ask, keep, letGo, forget, run],
  );
}

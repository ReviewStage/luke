import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * What a line's dangerous control is currently asking.
 *
 * Every action that asks first is one this panel cannot undo: deleting a
 * stored key, ending a grant at the provider that issued it, signing out,
 * erasing the account. Luke never hands any of them back — the main process
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
  /** True while the surface the question was asked on is the shape on screen. */
  surfaceOpen: boolean;
}

/**
 * What the line draws, given the question it is holding and what has become
 * true around it.
 *
 * A question outlives neither its subject nor the surface it was asked on. The
 * subject going takes it: there is nothing left to confirm, and a confirm left
 * standing where a key used to be would be pointed at whatever is stored there
 * next. The surface closing takes it too — a confirm is a question put to
 * somebody standing in front of it, and one still waiting behind a closed panel
 * would be the first thing under the pointer the next time it opened, with
 * nobody having asked for it. Standing down to the slot closes the panel by
 * this measure, which is what keeps a trip to fetch a key from bringing an
 * armed delete back with it.
 *
 * Both are the opposite of a key half-entered, which is the one thing here that
 * does survive a close: that is work someone is in the middle of, and this is a
 * question they walked away from.
 *
 * An answer already sent is the exception to both. It is no longer a question,
 * so it finishes wherever it is and the line reports what came back.
 */
export function confirmStage(
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
 * today nothing focused inside the group can reach Escape, but the invariant
 * must not rest on which element happens to hold the caret.
 */
export function confirmWithdrawable(stage: ConfirmStage): boolean {
  return stage === CONFIRM_STAGE.ASKING;
}

/**
 * Lines whose questions all end in the same place, so at most one of them may
 * be asked and at most one of them may run. Signing out and deleting an
 * account are both ways out of the same account: two confirms side by side
 * would be two answers to one question, and two answers already sent would be
 * two acts on the thing the first is in the middle of removing.
 *
 * The group is what keeps both halves, because neither line can see the other:
 * raising a question withdraws every sibling's, and an answer under way stills
 * every sibling's controls until it settles.
 */
export interface ConfirmGroup {
  /** Registers a line's own withdrawal, and answers the way to leave the group. */
  join(withdraw: () => void): () => void;
  /** Withdraws every question in the group but the one now being asked. */
  raise(asking: () => void): void;
  /** True while an answer given anywhere in the group is still running. */
  readonly settling: boolean;
  began(): void;
  ended(): void;
}

export function useConfirmGroup(): ConfirmGroup {
  const members = useRef(new Set<() => void>());
  const running = useRef(0);
  // Counted in a ref so the group's own identity never changes — a new one each
  // render would have every member leaving and rejoining it — and reported by a
  // render the siblings have to be given, because a rest they cannot see is no
  // rest at all.
  const [, redraw] = useState(0);
  return useMemo(
    () => ({
      join(withdraw) {
        members.current.add(withdraw);
        return () => {
          members.current.delete(withdraw);
        };
      },
      raise(asking) {
        for (const withdraw of members.current) if (withdraw !== asking) withdraw();
      },
      get settling() {
        return running.current > 0;
      },
      began() {
        running.current += 1;
        redraw((drawn) => drawn + 1);
      },
      ended() {
        running.current = Math.max(0, running.current - 1);
        redraw((drawn) => drawn + 1);
      },
    }),
    [],
  );
}

/** One confirming action, as the line that offers it holds it. */
export interface HeldConfirm {
  stage: ConfirmStage;
  /** Why the answer was refused, if it was. A refusal is an answer too. */
  rejection: string | undefined;
  /**
   * True while the answer that was given is running — or, for a line in a
   * group, while any sibling's is.
   */
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
 */
export function useConfirm(
  surroundings: ConfirmSurroundings,
  action: () => Promise<ActionResult>,
  group?: ConfirmGroup,
): HeldConfirm {
  const [held, setHeld] = useState<ConfirmStage>(CONFIRM_STAGE.RESTING);
  const [rejection, setRejection] = useState<string>();
  const stage = confirmStage(held, surroundings);
  if (stage !== held) setHeld(stage);
  // Read by the group's own withdrawal, which is a callback the group holds
  // rather than a render's closure: a sibling raising its question must find
  // this line's stage as it stands, not as it stood when the group was joined.
  const standing = useRef(stage);
  standing.current = stage;

  const keep = useCallback(() => {
    if (!confirmWithdrawable(standing.current)) return;
    setHeld(CONFIRM_STAGE.RESTING);
  }, []);

  useEffect(() => group?.join(keep), [group, keep]);

  return {
    stage,
    rejection,
    busy: stage === CONFIRM_STAGE.ACTING || (group?.settling ?? false),
    // Whatever the last answer was refused for is cleared on the way in: a
    // fresh question is a fresh decision, not one carrying the last one's
    // answer under it.
    ask: () => {
      setRejection(undefined);
      group?.raise(keep);
      setHeld(CONFIRM_STAGE.ASKING);
    },
    keep,
    clear: () => setRejection(undefined),
    run: () => {
      setHeld(CONFIRM_STAGE.ACTING);
      group?.began();
      void action()
        .then((result) => {
          setRejection(result.status === ACTION_RESULT_STATUS.ACCEPTED ? undefined : result.reason);
        })
        // Settled in `finally` rather than after the answer, because a carrier
        // that rejects rather than answering is still a line that has to be
        // handed back: one left `ACTING` would draw a confirm nobody can take
        // back, and a group left counting it would still every sibling for the
        // rest of the run. Answered either way — a refusal is an answer too,
        // and asking again is a fresh decision rather than a confirm left
        // standing over a subject that turned out to still be there.
        .finally(() => {
          group?.ended();
          setHeld(CONFIRM_STAGE.RESTING);
        });
    },
  };
}

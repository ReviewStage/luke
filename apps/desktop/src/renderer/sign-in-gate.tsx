import { useEffect, useState } from "react";
import type { AccountSnapshot } from "../shared/contracts";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "../shared/contracts";
import { GitHubMark, GoogleMark } from "./account-marks";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion } from "./luke-face-art";

/**
 * The introductions Luke makes while nobody is signed in, in the order he
 * makes them: a slow sway, one pirouette, a double blink, the curious tilt,
 * and a nod — then around again. Every one is a gesture from his own motion
 * table, so each plays once and hands the face back to the resting pose the
 * next one starts from.
 */
const SIGN_IN_FACE_CYCLE = [
  FACE_MOTION.MONITORING,
  FACE_MOTION.REFRESH,
  FACE_MOTION.IDLE,
  FACE_MOTION.LISTENING,
  FACE_MOTION.YES,
] as const;

/**
 * The stillness between gestures. Long enough that each reads as something
 * Luke did rather than one long fidget, short enough that the face never looks
 * switched off while it is the only thing introducing him.
 */
const SIGN_IN_FACE_REST_MS = 1_100;

/** Which gesture a step of the cycle plays, wrapping forever. */
export function signInFaceMotion(step: number): FaceMotion {
  return SIGN_IN_FACE_CYCLE[step % SIGN_IN_FACE_CYCLE.length] ?? FACE_MOTION.IDLE;
}

/**
 * Walks the introduction cycle: each gesture runs its own generated length,
 * rests, and yields to the next. The face this drives is the one Luke the
 * signed-out surface has — large over the gate, small in the peek's strip —
 * so the cycle keeps walking through the morph between the two. Reduced
 * motion holds the resting face instead — the pose every gesture starts and
 * ends at.
 */
export function useSignInFaceCycle(still: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (still) return;
    const timer = window.setTimeout(
      () => setStep((current) => current + 1),
      FACE_MOTION_CYCLE_MS[signInFaceMotion(step)] + SIGN_IN_FACE_REST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [step, still]);
  if (still) return { play: 0 } satisfies { motion?: FaceMotion; play: number };
  return { motion: signInFaceMotion(step), play: step } satisfies {
    motion?: FaceMotion;
    play: number;
  };
}

export function SignInGate({
  account,
  failure,
  onBegin,
  onQuit,
}: {
  account: AccountSnapshot;
  /** Why the last attempt ended without landing, from the flow's owner. */
  failure?: string;
  /** Starts the flow; the app stands the panel down to the waiting popup. */
  onBegin: (provider: AccountProvider) => void;
  onQuit: () => void;
}): React.JSX.Element {
  const pending = account.status === ACCOUNT_STATUS.SIGNING_IN;

  return (
    <section className="sign-in-gate" aria-labelledby="sign-in-title">
      {/* The face's room, not the face: the one signed-out Luke is drawn on
          the stage above, where he can travel to the peek's strip and back
          without there ever being a second of him. This box is what he stands
          over while the panel is the shape on screen. */}
      <span className="sign-in-face" aria-hidden="true" />
      <h1 id="sign-in-title">Meet Luke</h1>
      <div className="sign-in-actions">
        <button
          type="button"
          className="sign-in-provider"
          disabled={pending}
          onClick={() => onBegin(ACCOUNT_PROVIDER.GOOGLE)}
        >
          <GoogleMark />
          Continue with Google
        </button>
        <button
          type="button"
          className="sign-in-provider"
          disabled={pending}
          onClick={() => onBegin(ACCOUNT_PROVIDER.GITHUB)}
        >
          <GitHubMark />
          Continue with GitHub
        </button>
      </div>
      {failure ? <small className="sign-in-error">{failure}</small> : null}
      {/* The way out, quiet on purpose: it is the one control here that is not
          the reason the screen exists. */}
      <button type="button" className="sign-in-quit" onClick={onQuit}>
        Quit Luke
      </button>
    </section>
  );
}

import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
} from "@sidecar/credentials/snapshot";
import { WingFace } from "@sidecar/panel";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion } from "@sidecar/surface";
import { useEffect, useState } from "react";
import { GitHubMark } from "./account-marks";
import { SpinnerRing } from "./spinner";

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
function signInFaceMotion(step: number): FaceMotion {
  return SIGN_IN_FACE_CYCLE[step % SIGN_IN_FACE_CYCLE.length] ?? FACE_MOTION.IDLE;
}

/**
 * Walks the introduction cycle: each gesture runs its own generated length,
 * rests, and yields to the next. Reduced motion holds the resting face
 * instead — the pose every gesture starts and ends at.
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

/**
 * The sign-in, alone in the window: Luke introducing himself over the one way
 * in, GitHub, since a workspace is a GitHub App installation and every account
 * needs a GitHub identity to reach one. A press sends the browser to GitHub
 * and the gate waits in place — the button says so and Cancel takes the wait
 * back — because the browser holds the actual work and there is nothing else
 * here to do meanwhile.
 */
export function SignInGate({
  account,
  face,
  waiting,
  failure,
  onBegin,
  onCancel,
}: {
  account: AccountSnapshot;
  /** The introduction cycle the face walks while the gate stands. */
  face: { play: number; motion?: FaceMotion };
  /** Whose sign-in the gate is waiting on; absent while none was begun here. */
  waiting?: AccountProvider;
  /** Why the last attempt ended without landing, from the flow's owner. */
  failure?: string;
  /** Sends the browser to the provider; the gate then waits on it. */
  onBegin: (provider: AccountProvider) => void;
  onCancel: () => void;
}): React.JSX.Element {
  // A sign-in begun from no press of this gate still holds the button.
  const busy = waiting !== undefined || account.status === ACCOUNT_STATUS.SIGNING_IN;
  return (
    <section className="sign-in-gate" aria-labelledby="sign-in-title" aria-busy={busy}>
      <span className="sign-in-face" aria-hidden="true">
        <WingFace key={face.play} {...(face.motion ? { motion: face.motion } : undefined)} />
      </span>
      <h1 id="sign-in-title">Welcome to Luke</h1>
      <p className="sign-in-lede">Talk a feature through and Luke writes the plan.</p>
      <div className="sign-in-actions">
        <button
          type="button"
          className="sign-in-provider"
          data-waiting={String(waiting !== undefined)}
          disabled={busy}
          onClick={() => onBegin(ACCOUNT_PROVIDER.GITHUB)}
        >
          {waiting ? (
            <span className="account-mark">
              <SpinnerRing />
            </span>
          ) : (
            <GitHubMark />
          )}
          {waiting ? "Waiting for browser…" : "Continue with GitHub"}
        </button>
      </div>
      {/* The line under the button is held open whether or not it says
          anything, so beginning a wait does not move the column. */}
      <div className="sign-in-note">
        {waiting ? (
          <p role="status">
            Finish in your browser.{" "}
            <button type="button" className="sign-in-cancel" onClick={onCancel}>
              Cancel
            </button>
          </p>
        ) : failure ? (
          <p className="sign-in-error" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
    </section>
  );
}

import type { LiveSessionCreated, TaskActivityFrame, TaskCallEndingFrame } from "@luke/features";
import {
  isLiveVoice,
  LIVE_DEFAULTS,
  LIVE_SESSION_OUTCOME,
  type LiveDiagnostics,
  type LiveVoice,
} from "@luke/live";
import type { Effect, Scope } from "effect";
import type { LiveSideband } from "./live-socket.js";

/**
 * What a GPT Live session answers its creator with — the session's opaque id
 * and the SDP answer the renderer applies, never a credential — and why no
 * source opens one any more: Luke's voice service is gone, and nothing here
 * opens one on a key of the developer's own.
 */

export const LIVE_ENVIRONMENT = {
  VOICE: "LUKE_LIVE_VOICE",
} as const;

export interface LiveSessionCreateInput {
  /** The renderer's SDP offer, as written. */
  sdpOffer: string;
  /** The task the call's agent is on; none for an agent with no task. */
  taskId?: string | undefined;
  /** The agent the call speaks into, which the service reads and checks is on the task named. */
  agentId: string;
}

/**
 * What a session answers its creator with: the created fields alone, taken
 * off whatever stands beside them, with the store's id present only where
 * the service named one, so an answer for a session no account holds carries
 * no key for it.
 */
export function createdOf(created: LiveSessionCreated): LiveSessionCreated {
  return {
    sessionId: created.sessionId,
    sdpAnswer: created.sdpAnswer,
    ...(created.voiceSessionId === undefined
      ? undefined
      : { voiceSessionId: created.voiceSessionId }),
  };
}

/** A session that stands: the renderer's half, and the trusted half the host attaches. */
export interface LiveSessionOpened extends LiveSessionCreated {
  /**
   * Opens the trusted sideband on this session. Called once per session; the
   * session it leaves standing is the caller's to close. The scope it is
   * yielded in is the one the sideband's own connections stand for.
   */
  attach(): Effect.Effect<LiveSideband, never, Scope.Scope>;
  /**
   * Tells the service standing between this peer and the session whether
   * the peer has gone quiet, in the service's own vocabulary rather than as
   * a Live event, since it is read by the service and never by OpenAI.
   * Optional on the interface for a session that offers no such door; every
   * session this build opens is the service's and offers it.
   */
  reportActivity?(idle: boolean): void;
  /**
   * Asks the service standing between this peer and the session to tell the
   * model to stop and wait, in the service's own vocabulary: the instruction
   * that says so is the service's to append, so nothing on this side names
   * it or appends it. Optional on the same terms as `reportActivity`.
   */
  stopSpeaking?(): void;
  /**
   * Hands the service standing between this peer and the session a line the
   * developer typed into the call, in the service's own vocabulary: the
   * service writes it down, hands it to the agent, and speaks the reply, so
   * nothing on this side appends it. Optional on the same terms as
   * `reportActivity`.
   */
  typeLine?(text: string, clientKey: string): void;
  /**
   * Asks the service standing between this peer and the session for the
   * session's close, in the service's own vocabulary: the service owns the
   * one `session.close`, so nothing on this side sends it, and the
   * `session.closed` it draws arrives on the sideband as every event does.
   */
  hangUp(): void;
  /**
   * Tells the listener each time the service says what each part of the
   * call is doing on a task call, as the service's own frame on the same
   * socket says it; the sideband never sees that frame. Optional on the
   * same terms as `reportActivity`.
   */
  onTaskActivity?(listener: (activity: TaskActivityFrame) => void): void;
  /** Tells the listener Luke is ending a task call once his goodbye has played, on the same terms as `onTaskActivity`. */
  onTaskCallEnding?(listener: (ending: TaskCallEndingFrame) => void): void;
}

export interface LiveSessionSource {
  /**
   * The one session for this offer, or nothing where it could not be created.
   * The scope it is yielded in owns whatever the session left standing on
   * this side — the hosted source's re-attaching tries above all — so closing
   * that scope ends them.
   */
  create(
    input: LiveSessionCreateInput,
  ): Effect.Effect<LiveSessionOpened | undefined, never, Scope.Scope>;
  /** Applies to the next session: a voice is immutable once a session has started. */
  setVoice(voice: string | undefined): void;
  diagnostics(): LiveDiagnostics;
}

/** The launch environment's voice, honoured only when it is one the API speaks. */
export function environmentLiveVoice(
  // A browser tab has no `process`, and so no launch environment to read.
  environment: NodeJS.ProcessEnv = globalThis.process?.env ?? {},
): LiveVoice | undefined {
  const value = environment[LIVE_ENVIRONMENT.VOICE]?.trim();
  return isLiveVoice(value) ? value : undefined;
}

/**
 * Explains why no source exists, which is the state the panel shows as voice
 * unavailable. A signed-out run and a fixture run look identical from the
 * panel and have completely different fixes.
 */
export function unavailableLiveDiagnostics(input: { fixtureMode: boolean }): LiveDiagnostics {
  return {
    fixtureMode: input.fixtureMode,
    model: LIVE_DEFAULTS.MODEL,
    voice: environmentLiveVoice() ?? LIVE_DEFAULTS.VOICE,
    sidebandAttached: false,
    lastOutcome: input.fixtureMode
      ? LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE
      : LIVE_SESSION_OUTCOME.NO_ACCOUNT,
  };
}

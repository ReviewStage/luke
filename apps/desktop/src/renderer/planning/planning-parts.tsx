import { MicrophoneIcon, MicrophoneOffIcon, StopIcon } from "@sidecar/panel";
import { ThinkingDots } from "../thinking-dots";
import { Tooltip } from "../tooltip";
import type { CallStatus } from "./planning-model";

/**
 * planning-parts.tsx -- the open plan's microphone row, as a pure layout.
 *
 * It draws what it is handed and decides nothing, so what it shows is
 * `planning-model.ts`'s answer and a press is a callback the tab hands down.
 * The waveform and the captions are the panel's own, drawn on the shape for a
 * planning call exactly as for any other.
 */

/** What a reader is told while the backend works; the sighted read the dots and the line. */
const PLAN_WORKING_LABEL = "Luke is working on it";

/** The backend line's names for its two parts, and what the planning model says with no command pending. */
const PLANNER_NAME = "Planning model";
const PLANNER_THINKING = "Thinking";
const NOTETAKER_WRITING = "Notetaker · Writing notes";

/** The stop's name for a reader and its hover. */
const STOP_CALL_LABEL = "End the call";

/**
 * The microphone row under the document: the button, and beside it the open
 * plan's call in two lines. The button is struck through and pressed while
 * the call stands muted. While the call is in progress a stop ends it, apart
 * from the microphone, so muting never hangs up and hanging up is one press. The first is the voice's word. The second stands
 * only while the backend works: the planning model with its pending command
 * set in monospace, or Thinking where it has none, and the notetaker while it
 * writes, each named so neither reads as the voice. The dots are decorative,
 * so a reader is told by a status line of its own. Only the button and the
 * lines are the tab's own; whoever is heard, and what is said, the panel
 * draws on its shape.
 */
export function MicrophoneRow({
  status,
  microphone,
  stop,
}: {
  /** The call's status, absent while no call about this plan stands. */
  status: CallStatus | undefined;
  microphone: { label: string; enabled: boolean; muted: boolean; onPress: () => void };
  stop: { shown: boolean; onPress: () => void };
}): React.JSX.Element {
  const planner = status?.backend.planner;
  const notes = status?.backend.notes ?? false;
  return (
    <footer className="plan-microphone-row">
      <Tooltip label={microphone.label}>
        <button
          type="button"
          className="plan-microphone"
          aria-label={microphone.label}
          aria-pressed={microphone.muted}
          data-muted={String(microphone.muted)}
          disabled={!microphone.enabled}
          onClick={microphone.onPress}
        >
          {microphone.muted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
        </button>
      </Tooltip>
      <span className="plan-voice-status">
        <span className="plan-voice-word">{status?.voiceWord ?? microphone.label}</span>
        {planner !== undefined || notes ? (
          <span className="plan-backend">
            <ThinkingDots />
            {planner === undefined ? null : (
              <span className="plan-backend-part">
                {PLANNER_NAME} ·{" "}
                {planner.action === undefined ? (
                  PLANNER_THINKING
                ) : (
                  <span className="plan-backend-action">{planner.action}</span>
                )}
              </span>
            )}
            {notes ? <span className="plan-backend-part">{NOTETAKER_WRITING}</span> : null}
            <span className="visually-hidden" role="status">
              {PLAN_WORKING_LABEL}
            </span>
          </span>
        ) : null}
      </span>
      {stop.shown ? (
        <Tooltip label={STOP_CALL_LABEL}>
          <button
            type="button"
            className="plan-stop"
            aria-label={STOP_CALL_LABEL}
            onClick={stop.onPress}
          >
            <StopIcon />
          </button>
        </Tooltip>
      ) : null}
    </footer>
  );
}

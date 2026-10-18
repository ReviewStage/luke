import { Spinner } from "@luke/panel/spinner";
import { usePrefersReducedMotion } from "@luke/panel/use-reduced-motion";
import { frameLevel } from "@luke/panel/voice/voice-level-meter";
import {
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  CloseIcon,
  IconButton,
  MicrophoneIcon,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../tooltip";
import { DICTATION_PHASE, type DictationControl } from "./use-dictation";

/**
 * dictation-strip.tsx -- the composer's Dictate button, and the strip that stands at the card's foot while a dictation does: the voice drawn as it is heard, how long it has run, and the two ways out.
 *
 * Drawn the way ChatGPT's is. The button is a microphone just left of the
 * card's other presses. Pressed, the card's foot becomes the strip: bars
 * that scroll in from the right as loud as the voice is, the time so far,
 * ✕ that drops the recording, and ✓ that sends it, which Escape and Enter
 * are as well. Sent, the strip says it is transcribing under the window's
 * one spinner until the words land in the box. The bars are the
 * microphone's level and nothing else, so the screen recording, which
 * masks every word, keeps no more than their heights; reduced motion
 * holds them still at rest while the clock still counts.
 */

const LABEL = {
  DICTATE: "Dictate",
  CANCEL: "Cancel",
  FINISH: "Done",
  TRANSCRIBING: "Transcribing",
} as const;

/** How many bars the strip holds: enough to cross the widest message box, newest at the right, the oldest clipped at the left. */
const BAR_COUNT = 128;

/** How many frames each bar stands for: about twenty bars a second, a speaking pace. */
const FRAMES_PER_BAR = 3;

/** The least a bar is drawn at, so silence is a line rather than nothing. */
const REST_SCALE = 0.08;

const BAR_INDEXES = Array.from({ length: BAR_COUNT }, (_, index) => index);

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1_000;

/** A length as `m:ss`. */
function clockOf(ms: number): string {
  const seconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

/** The microphone press at the card's foot; held boxes take none. */
export function DictateButton({
  dictation,
  disabled,
}: {
  dictation: DictationControl;
  disabled: boolean;
}): React.JSX.Element {
  return (
    // Note that the box is what a narrow card's stylesheet hides and its ⋯ reads, and
    // the press keeps the caret where it was in the box, which is where the words go.
    <span className="dictate-button">
      <Tooltip label={LABEL.DICTATE}>
        <IconButton
          icon={<MicrophoneIcon />}
          label={LABEL.DICTATE}
          disabled={disabled}
          keepFocus
          onClick={dictation.start}
        />
      </Tooltip>
    </span>
  );
}

/** The voice as it is heard: one bar per slice of time, the newest at the right. */
function DictationWave({ analyser }: { analyser: AnalyserNode | undefined }): React.JSX.Element {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (analyser === undefined || reduced) return;
    const samples = new Uint8Array(analyser.fftSize);
    const levels = Array.from({ length: BAR_COUNT }, () => 0);
    let frame = 0;
    let loudest = 0;
    let animationFrame = 0;
    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      loudest = Math.max(loudest, frameLevel(samples));
      frame += 1;
      if (frame % FRAMES_PER_BAR === 0) {
        levels.shift();
        levels.push(loudest);
        loudest = 0;
        levels.forEach((level, index) => {
          bars.current[index]?.style.setProperty(
            "transform",
            `scaleY(${Math.max(REST_SCALE, level)})`,
          );
        });
      }
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [analyser, reduced]);

  return (
    <span className="dictation-wave" aria-hidden="true">
      {BAR_INDEXES.map((index) => (
        <span
          key={index}
          className="dictation-wave-bar"
          ref={(element) => {
            bars.current[index] = element;
          }}
        />
      ))}
    </span>
  );
}

/** How long the recording has run, counted on the page's frames and drawn once a second. */
function DictationClock({ startedAt }: { startedAt: number | undefined }): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt === undefined) return;
    let animationFrame = 0;
    // React keeps a render whose second is the one already shown, so this draws once a second.
    const tick = () => {
      setElapsed(Math.floor((performance.now() - startedAt) / MS_PER_SECOND) * MS_PER_SECOND);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [startedAt]);

  return (
    <span className="dictation-clock" role="timer">
      {clockOf(elapsed)}
    </span>
  );
}

/** The card's foot while a dictation stands: recording, then transcribing. */
export function DictationStrip({ dictation }: { dictation: DictationControl }): React.JSX.Element {
  const transcribing = dictation.phase === DICTATION_PHASE.TRANSCRIBING;
  return (
    <div className="dictation-strip" data-phase={dictation.phase}>
      {transcribing ? (
        <span className="dictation-transcribing">
          <Spinner label={LABEL.TRANSCRIBING} />
          <span aria-hidden="true">
            <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              Transcribing…
            </Text>
          </span>
        </span>
      ) : (
        <>
          <DictationWave analyser={dictation.analyser} />
          <DictationClock startedAt={dictation.startedAt} />
        </>
      )}
      <Tooltip label={LABEL.CANCEL}>
        <IconButton
          icon={<CloseIcon />}
          label={LABEL.CANCEL}
          keepFocus
          onClick={dictation.cancel}
        />
      </Tooltip>
      {transcribing ? null : (
        <Tooltip label={LABEL.FINISH}>
          <IconButton
            icon={<CheckIcon />}
            label={LABEL.FINISH}
            variant={BUTTON_VARIANT.INK}
            shape={BUTTON_SHAPE.ROUND}
            disabled={dictation.startedAt === undefined}
            keepFocus
            onClick={dictation.finish}
          />
        </Tooltip>
      )}
    </div>
  );
}

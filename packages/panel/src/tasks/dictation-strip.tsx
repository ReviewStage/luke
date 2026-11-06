import { playheadText } from "@repo/features/time-format";
import {
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  CloseIcon,
  IconButton,
  MicrophoneIcon,
  Spinner,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useMotionHeld,
} from "@repo/ui";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { frameLevel } from "./frame-level.js";
import { DICTATION_PHASE, type DictationControl } from "./use-dictation.js";

const LABEL = {
  DICTATE: "Dictate",
  CANCEL: "Cancel",
  FINISH: "Done",
  TRANSCRIBING: "Transcribing",
} as const;

const BAR_COUNT = 128;

const FRAMES_PER_BAR = 3;

const REST_SCALE = 0.08;

const BAR_INDEXES = Array.from({ length: BAR_COUNT }, (_, index) => index);

const MS_PER_SECOND = 1_000;

export function DictateButton({
  dictation,
  disabled,
}: {
  dictation: DictationControl;
  disabled: boolean;
}): React.JSX.Element {
  const label = dictation.keyMissing ? OPENAI_KEY_MISSING_NOTE : LABEL.DICTATE;
  return (
    <span className="dictate-button flex">
      <Tooltip label={label}>
        <IconButton
          icon={<MicrophoneIcon />}
          label={label}
          disabled={disabled}
          keepFocus
          onClick={dictation.start}
        />
      </Tooltip>
    </span>
  );
}

function DictationWave({ analyzer }: { analyzer: AnalyserNode | undefined }): React.JSX.Element {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const reduced = useMotionHeld();

  useEffect(() => {
    if (analyzer === undefined || reduced) return;
    const samples = new Uint8Array(analyzer.fftSize);
    const levels = Array.from({ length: BAR_COUNT }, () => 0);
    let frame = 0;
    let loudest = 0;
    let animationFrame = 0;
    const draw = () => {
      analyzer.getByteTimeDomainData(samples);
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
  }, [analyzer, reduced]);

  return (
    <span
      className="flex h-ui-20 min-w-0 flex-1 items-center justify-end gap-list-gap overflow-clip"
      aria-hidden="true"
    >
      {BAR_INDEXES.map((index) => (
        <span
          key={index}
          className="h-full w-ui-2 flex-none rounded-ui-full bg-current [transform:scaleY(0.08)]"
          ref={(element) => {
            bars.current[index] = element;
          }}
        />
      ))}
    </span>
  );
}

function DictationClock({ startedAt }: { startedAt: number | undefined }): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt === undefined) return;
    let animationFrame = 0;
    const tick = () => {
      setElapsed(Math.floor((performance.now() - startedAt) / MS_PER_SECOND) * MS_PER_SECOND);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [startedAt]);

  return (
    <span
      className="min-w-dictation-clock flex-none text-right text-caption tabular-nums"
      role="timer"
    >
      {playheadText(elapsed)}
    </span>
  );
}

export function DictationStrip({ dictation }: { dictation: DictationControl }): React.JSX.Element {
  const transcribing = dictation.phase === DICTATION_PHASE.TRANSCRIBING;
  return (
    <div
      className="dictation-strip flex h-control min-w-0 flex-1 items-center gap-control-gap text-muted-foreground"
      data-phase={dictation.phase}
    >
      {transcribing ? (
        <span className="dictation-transcribing flex min-w-0 flex-1 items-center gap-icon-gap">
          <Spinner delay={false} label={LABEL.TRANSCRIBING} />
          <span aria-hidden="true">
            <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              {LABEL.TRANSCRIBING}
            </Text>
          </span>
        </span>
      ) : (
        <>
          <DictationWave analyzer={dictation.analyzer} />
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

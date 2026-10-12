import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { DICTATION_AUDIO_TYPE, DICTATION_BOUNDS } from "@sidecar/hosted/dictation-wire";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { useAct } from "../act";
import { appSettingsNow, appStateNow } from "../use-app-state";
import { openPreferredMicrophone } from "../voice/microphone-choice";
import { base64Of } from "./attached-files";

/**
 * use-dictation.ts -- a message box's dictation: the microphone recorded in this panel, heard as words by Luke's service, and the words put at the caret.
 *
 * The press opens the microphone the voice window would (the Mac's own
 * over a Bluetooth headset's, `../voice/microphone-choice.ts`), after
 * asking macOS where it has not been asked, and records it as Opus in
 * WebM at the wire's bitrate, measured by an analyser the strip draws.
 * Finishing hands the clip to main in one act, and main to Luke's service,
 * which has OpenAI hear it and answers the words; the renderer never
 * reaches OpenAI. The words go in at the caret the press found, spaced from
 * the words around them, never over the draft, and the box takes the caret
 * back after them. Cancelling, or a press elsewhere that unmounts the box,
 * drops the clip unsent. The recording stops itself a slice short of the
 * wire's two minutes, so a clip is never refused for its length. Whatever
 * fails says why in the box's note and keeps nothing.
 *
 * While a dictation stands the box takes no typing: Enter finishes and
 * Escape cancels, so neither sends the draft nor leaves the box.
 */

export const DICTATION_PHASE = {
  IDLE: "idle",
  RECORDING: "recording",
  TRANSCRIBING: "transcribing",
} as const;

type DictationPhase = (typeof DICTATION_PHASE)[keyof typeof DICTATION_PHASE];

/** Why a dictation left nothing, in the words the box's note says. */
const DICTATION_NOTE = {
  MICROPHONE_DENIED:
    "Luke can't use the microphone. Allow it in System Settings › Privacy & Security › Microphone.",
  MICROPHONE_FAILED: "The microphone couldn't be opened.",
  TOO_LONG: "That recording is too long to transcribe.",
  NO_WORDS: "No words were heard.",
  FAILED: "The recording couldn't be transcribed. Try again.",
} as const;

/** What the recorder writes: Opus in WebM, the one container the wire carries. */
const RECORDING_TYPE = `${DICTATION_AUDIO_TYPE};codecs=opus`;

/** How often the recorder hands over what it holds, which is how often the length is checked. */
const RECORDER_SLICE_MS = 1_000;

/** The length a recording stops itself at: a slice short of the bound, so the clip lands inside it. */
const AUTO_STOP_MS = DICTATION_BOUNDS.MAX_DURATION_MS - RECORDER_SLICE_MS;

/** The analyser's window: enough samples for a steady level at a frame's rate. */
const ANALYSER_FFT_SIZE = 1_024;

/** One recording as it stands: what was opened for it, and what it has written. */
interface Recording {
  readonly generation: number;
  /** Where the words go: the caret as the press found it. */
  readonly caret: number;
  readonly stream: MediaStream;
  readonly recorder: MediaRecorder;
  readonly context: AudioContext;
  readonly chunks: Blob[];
  readonly startedAt: number;
  /** Whether the stop sends the clip; a cancel stops it unsent. */
  keep: boolean;
}

export interface DictationControl {
  phase: DictationPhase;
  /** What the strip measures; nothing until the microphone is open. */
  analyser: AnalyserNode | undefined;
  /** When the recording began on the page's clock; nothing until the microphone is open. */
  startedAt: number | undefined;
  start: () => void;
  finish: () => void;
  cancel: () => void;
  /** The box's own keys while a dictation stands; answers whether it took the key. */
  onFieldKey: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/**
 * The words put in at the caret, a space between them and a word on either
 * side, and cut where the box's bound would cut them; answers the box's
 * words and where the caret goes after them.
 */
function withDictatedWords(draft: string, caret: number, words: string, maxLength: number) {
  const before = draft.slice(0, caret);
  const after = draft.slice(caret);
  const lead = before === "" || /\s$/u.test(before) ? "" : " ";
  const trail = after === "" || /^\s/u.test(after) ? "" : " ";
  const room = Math.max(0, maxLength - draft.length - lead.length - trail.length);
  const inserted = `${lead}${words.slice(0, room)}${trail}`;
  return {
    draft: `${before}${inserted}${after}`,
    caret: before.length + inserted.length - trail.length,
  };
}

/** Everything the recording opened, let go: the microphone's light goes out with the tracks. */
function release(recording: Recording): void {
  for (const track of recording.stream.getTracks()) track.stop();
  recording.context.close().catch(() => undefined);
}

export function useDictation(input: {
  field: RefObject<HTMLTextAreaElement | null>;
  /** The box's words as they stand now, read as the words land. */
  draft: () => string;
  setDraft: (next: string) => void;
  maxLength: number;
  /** The words the clip is likely to say (`dictation-keywords.ts`). */
  keywords: readonly string[];
  /** Says why a dictation left nothing, or clears what the last one said. */
  onNote: (note: string | undefined) => void;
}): DictationControl {
  const { act } = useAct();
  const [phase, setPhase] = useState<DictationPhase>(DICTATION_PHASE.IDLE);
  const [analyser, setAnalyser] = useState<AnalyserNode | undefined>(undefined);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  // Note that each press and each cancel is a generation of its own, because
  // a microphone opening or an answer arriving late must find the dictation
  // it was for gone rather than act on the one after it.
  const generation = useRef(0);
  const recording = useRef<Recording | undefined>(undefined);
  const pendingCaret = useRef<number | undefined>(undefined);
  const latest = useRef(input);
  latest.current = input;

  // The caret goes after the words once the box draws them.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const box = input.field.current;
    if (caret === undefined || box === null || box.value.length < caret) return;
    pendingCaret.current = undefined;
    box.focus();
    box.setSelectionRange(caret, caret);
  });

  // A box that goes away takes its recording with it, unsent.
  useEffect(
    () => () => {
      generation.current += 1;
      const standing = recording.current;
      recording.current = undefined;
      if (standing === undefined) return;
      standing.keep = false;
      if (standing.recorder.state !== "inactive") standing.recorder.stop();
      release(standing);
    },
    [],
  );

  const settle = (note: string | undefined) => {
    recording.current = undefined;
    setAnalyser(undefined);
    setStartedAt(undefined);
    setPhase(DICTATION_PHASE.IDLE);
    latest.current.onNote(note);
  };

  const fail = (asked: number, note: string) => {
    if (generation.current === asked) settle(note);
  };

  const land = (caret: number, words: string) => {
    const { draft, setDraft, maxLength } = latest.current;
    const next = withDictatedWords(draft(), caret, words, maxLength);
    pendingCaret.current = next.caret;
    setDraft(next.draft);
    settle(undefined);
  };

  const transcribe = async (clip: Recording, durationMs: number) => {
    setPhase(DICTATION_PHASE.TRANSCRIBING);
    setAnalyser(undefined);
    const bytes = new Uint8Array(
      await new Blob(clip.chunks, { type: DICTATION_AUDIO_TYPE }).arrayBuffer(),
    );
    if (bytes.byteLength > DICTATION_BOUNDS.MAX_AUDIO_BYTES)
      return fail(clip.generation, DICTATION_NOTE.TOO_LONG);
    const answer = await act(ACT_KIND.DICTATION_TRANSCRIBE, {
      audio: base64Of(bytes),
      durationMs: Math.min(durationMs, DICTATION_BOUNDS.MAX_DURATION_MS),
      keywords: latest.current.keywords,
    }).catch(() => undefined);
    if (generation.current !== clip.generation) return;
    if (answer === undefined || "failure" in answer) {
      const tooLong = answer?.failure === CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG;
      return settle(tooLong ? DICTATION_NOTE.TOO_LONG : DICTATION_NOTE.FAILED);
    }
    const words = answer.text.trim();
    if (words === "") return settle(DICTATION_NOTE.NO_WORDS);
    land(clip.caret, words);
  };

  const finish = () => {
    const standing = recording.current;
    if (standing === undefined) return cancel();
    if (standing.recorder.state === "inactive") return;
    standing.keep = true;
    const durationMs = performance.now() - standing.startedAt;
    standing.recorder.onstop = () => {
      release(standing);
      if (standing.keep)
        transcribe(standing, durationMs).catch(() =>
          fail(standing.generation, DICTATION_NOTE.FAILED),
        );
    };
    standing.recorder.stop();
  };

  const cancel = () => {
    generation.current += 1;
    const standing = recording.current;
    if (standing !== undefined) {
      standing.keep = false;
      if (standing.recorder.state !== "inactive") standing.recorder.stop();
      release(standing);
    }
    settle(undefined);
    input.field.current?.focus();
  };

  const open = async (asked: number, caret: number) => {
    // Note that macOS is asked only where it has not answered, because the ask is counted and a granted microphone needs none.
    const known = appStateNow()?.audio.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED;
    const status =
      known === MICROPHONE_STATUS.NOT_DETERMINED
        ? await act(ACT_KIND.MICROPHONE_REQUEST).catch(() => MICROPHONE_STATUS.UNKNOWN)
        : known;
    if (status === MICROPHONE_STATUS.DENIED || status === MICROPHONE_STATUS.RESTRICTED) {
      return fail(asked, DICTATION_NOTE.MICROPHONE_DENIED);
    }
    const stream = await openPreferredMicrophone({
      route: () =>
        (appSettingsNow()?.preferBuiltInMicrophone ?? true)
          ? act(ACT_KIND.MICROPHONE_ROUTE)
          : Promise.resolve(undefined),
      enumerate: () => navigator.mediaDevices.enumerateDevices(),
      open: (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
    }).catch(() => undefined);
    if (stream === undefined) return fail(asked, DICTATION_NOTE.MICROPHONE_FAILED);
    if (generation.current !== asked) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const context = new AudioContext();
    const measured = context.createAnalyser();
    measured.fftSize = ANALYSER_FFT_SIZE;
    context.createMediaStreamSource(stream).connect(measured);
    const recorder = new MediaRecorder(stream, {
      mimeType: RECORDING_TYPE,
      audioBitsPerSecond: DICTATION_BOUNDS.AUDIO_BITS_PER_SECOND,
    });
    const began = performance.now();
    const standing: Recording = {
      generation: asked,
      caret,
      stream,
      recorder,
      context,
      chunks: [],
      startedAt: began,
      keep: false,
    };
    recording.current = standing;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) standing.chunks.push(event.data);
      if (standing.recorder.state === "recording" && performance.now() - began >= AUTO_STOP_MS) {
        finish();
      }
    };
    recorder.start(RECORDER_SLICE_MS);
    setAnalyser(measured);
    setStartedAt(began);
  };

  const start = () => {
    if (phase !== DICTATION_PHASE.IDLE) return;
    const box = input.field.current;
    const caret = box?.selectionEnd ?? input.draft().length;
    generation.current += 1;
    const asked = generation.current;
    input.onNote(undefined);
    setPhase(DICTATION_PHASE.RECORDING);
    // The caret stays in the box, so its keys are the strip's while the button that was pressed goes.
    box?.focus();
    open(asked, caret).catch(() => fail(asked, DICTATION_NOTE.MICROPHONE_FAILED));
  };

  const onFieldKey = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (phase === DICTATION_PHASE.IDLE) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return true;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (phase === DICTATION_PHASE.RECORDING) finish();
      return true;
    }
    return false;
  };

  return { phase, analyser, startedAt, start, finish, cancel, onFieldKey };
}

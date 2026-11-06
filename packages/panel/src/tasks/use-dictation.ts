import { useAtomValue } from "@effect/atom-react";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { DICTATION_AUDIO_TYPE, DICTATION_BOUNDS } from "@repo/features/dictation-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { appSettingsView } from "@repo/settings/wire";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type RefObject, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useOpenAiKeyMissing, useOpenApiKeys } from "../openai-key.js";
import type { ComposerEditorHandle, ComposerMark } from "../description-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { base64Of } from "./attached-files.js";
import { openPreferredMicrophone } from "./microphone-choice.js";

export const DICTATION_PHASE = {
  IDLE: "idle",
  RECORDING: "recording",
  TRANSCRIBING: "transcribing",
} as const;

type DictationPhase = (typeof DICTATION_PHASE)[keyof typeof DICTATION_PHASE];

const DICTATION_NOTE = {
  MICROPHONE_DENIED: `${PRODUCT_NAME} cannot use the microphone. Allow it in System Settings › Privacy & Security › Microphone.`,
  MICROPHONE_FAILED: "The microphone could not be opened.",
  BOX_FULL: "There is no room for the dictated words.",
  NO_WORDS: "No words were heard.",
  FAILED: "The recording could not be transcribed. Try again.",
  OPENAI_KEY_MISSING: OPENAI_KEY_MISSING_NOTE,
} as const;

const RECORDING_TYPE = `${DICTATION_AUDIO_TYPE};codecs=opus`;

const RECORDER_SLICE_MS = 1_000;

const DICTATION_AUTO_STOP = Duration.millis(DICTATION_BOUNDS.MAX_DURATION_MS - 1_000);

const ANALYZER_FFT_SIZE = 1_024;

interface Recording {
  readonly generation: number;
  readonly stream: MediaStream;
  readonly recorder: MediaRecorder;
  readonly context: AudioContext;
  readonly chunks: Blob[];
  readonly startedAt: number;
}

export interface DictationControl {
  phase: DictationPhase;
  keyMissing: boolean;
  analyzer: AnalyserNode | undefined;
  startedAt: number | undefined;
  start: () => void;
  finish: () => void;
  cancel: () => void;
  onFieldKey: (event: KeyboardEvent) => boolean;
}

function release(opened: { readonly stream: MediaStream; readonly context?: AudioContext }): void {
  for (const track of opened.stream.getTracks()) track.stop();
  opened.context?.close().catch(() => undefined);
}

function pressedContext(): AudioContext | undefined {
  try {
    const context = new AudioContext();
    context.resume().catch(() => undefined);
    return context;
  } catch {
    return undefined;
  }
}

export function useDictation(input: {
  editor: RefObject<ComposerEditorHandle | undefined>;
  keywords: readonly string[];
  onNote: (note: string | undefined) => void;
}): DictationControl {
  const { mutateAsync: sendClip } = useMutation(actMutation(ACT_KIND.DICTATION_TRANSCRIBE));
  const { mutateAsync: askMicrophone } = useMutation(actMutation(ACT_KIND.MICROPHONE_REQUEST));
  const { mutateAsync: routeMicrophone } = useMutation(actMutation(ACT_KIND.MICROPHONE_ROUTE));
  const queryClient = useQueryClient();
  const keyMissing = useOpenAiKeyMissing();
  const openApiKeys = useOpenApiKeys();
  const [phase, setPhase] = useState<DictationPhase>(DICTATION_PHASE.IDLE);
  const [analyzer, setAnalyzer] = useState<AnalyserNode | undefined>(undefined);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const generation = useRef(0);
  const recording = useRef<Recording | undefined>(undefined);
  const marked = useRef<ComposerMark | undefined>(undefined);
  const latest = useRef(input);
  latest.current = input;
  const [idle] = useState(() => rendererRuntime.atom(Effect.asVoid(Effect.never)));
  const [deadline, setDeadline] = useState(idle);
  const deadlinePassed = AsyncResult.isSuccess(useAtomValue(deadline));

  const drop = () => {
    generation.current += 1;
    const standing = recording.current;
    recording.current = undefined;
    if (standing === undefined) return;
    if (standing.recorder.state !== "inactive") standing.recorder.stop();
    release(standing);
  };

  useEffect(() => drop, []);

  const settle = (note: string | undefined) => {
    recording.current = undefined;
    marked.current?.release();
    marked.current = undefined;
    setDeadline(idle);
    setAnalyzer(undefined);
    setStartedAt(undefined);
    setPhase(DICTATION_PHASE.IDLE);
    latest.current.onNote(note);
  };

  const fail = (asked: number, note: string) => {
    if (generation.current === asked) settle(note);
  };

  const land = (words: string) => {
    const mark = marked.current;
    marked.current = undefined;
    settle(mark?.insert(words) === true ? undefined : DICTATION_NOTE.BOX_FULL);
  };

  const transcribe = async (clip: Recording, durationMs: number) => {
    setPhase(DICTATION_PHASE.TRANSCRIBING);
    setAnalyzer(undefined);
    const bytes = new Uint8Array(
      await new Blob(clip.chunks, { type: DICTATION_AUDIO_TYPE }).arrayBuffer(),
    );
    const answer = await sendClip({
      audio: base64Of(bytes),
      durationMs,
      keywords: latest.current.keywords,
    }).catch(() => undefined);
    if (generation.current !== clip.generation) return;
    if (
      answer !== undefined &&
      "failure" in answer &&
      answer.failure === AGENT_CALL_FAILURE.OPENAI_KEY_MISSING
    ) {
      return settle(DICTATION_NOTE.OPENAI_KEY_MISSING);
    }
    if (answer === undefined || "failure" in answer) return settle(DICTATION_NOTE.FAILED);
    const words = answer.text.trim();
    if (words === "") return settle(DICTATION_NOTE.NO_WORDS);
    land(words);
  };

  const finish = () => {
    const standing = recording.current;
    if (standing === undefined || standing.recorder.state === "inactive") return;
    const durationMs = performance.now() - standing.startedAt;
    standing.recorder.onstop = () => {
      release(standing);
      if (generation.current !== standing.generation) return;
      transcribe(standing, durationMs).catch(() =>
        fail(standing.generation, DICTATION_NOTE.FAILED),
      );
    };
    standing.recorder.stop();
  };

  const cancel = () => {
    drop();
    settle(undefined);
    input.editor.current?.focus();
  };

  const open = async (asked: number, context: AudioContext | undefined) => {
    const state = queryClient.getQueryData(appStateQuery.queryKey);
    const routed = state !== undefined && selectCapability(HOST_CAPABILITY.MICROPHONE)(state);
    const known = state?.audio.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED;
    const status =
      routed && known === MICROPHONE_STATUS.NOT_DETERMINED
        ? await askMicrophone().catch(() => MICROPHONE_STATUS.UNKNOWN)
        : known;
    if (status === MICROPHONE_STATUS.DENIED || status === MICROPHONE_STATUS.RESTRICTED) {
      return fail(asked, DICTATION_NOTE.MICROPHONE_DENIED);
    }
    const stream = await openPreferredMicrophone({
      route: () => {
        const stored = queryClient.getQueryData(appStateQuery.queryKey)?.settings;
        return routed && (stored === undefined || appSettingsView(stored).preferBuiltInMicrophone)
          ? routeMicrophone()
          : Promise.resolve(undefined);
      },
      enumerate: () => navigator.mediaDevices.enumerateDevices(),
      open: (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
    }).catch(() => undefined);
    if (stream === undefined) return fail(asked, DICTATION_NOTE.MICROPHONE_FAILED);
    if (generation.current !== asked) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    if (context === undefined) {
      for (const track of stream.getTracks()) track.stop();
      return fail(asked, DICTATION_NOTE.MICROPHONE_FAILED);
    }
    try {
      const measured = context.createAnalyser();
      measured.fftSize = ANALYZER_FFT_SIZE;
      context.createMediaStreamSource(stream).connect(measured);
      if (context.state !== "running") context.resume().catch(() => undefined);
      const recorder = new MediaRecorder(stream, {
        mimeType: RECORDING_TYPE,
        audioBitsPerSecond: DICTATION_BOUNDS.AUDIO_BITS_PER_SECOND,
      });
      const standing: Recording = {
        generation: asked,
        stream,
        recorder,
        context,
        chunks: [],
        startedAt: performance.now(),
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) standing.chunks.push(event.data);
      };
      recorder.start(RECORDER_SLICE_MS);
      recording.current = standing;
      setDeadline(rendererRuntime.atom(Effect.sleep(DICTATION_AUTO_STOP)));
      setAnalyzer(measured);
      setStartedAt(standing.startedAt);
    } catch {
      release({ stream, context });
      fail(asked, DICTATION_NOTE.MICROPHONE_FAILED);
    }
  };

  useEffect(() => {
    if (deadlinePassed) finish();
  }, [deadlinePassed]);

  const start = () => {
    if (keyMissing) return openApiKeys();
    const box = input.editor.current;
    if (phase !== DICTATION_PHASE.IDLE || box === undefined) return;
    marked.current = box.mark();
    generation.current += 1;
    const asked = generation.current;
    input.onNote(undefined);
    setPhase(DICTATION_PHASE.RECORDING);
    box.focus();
    const context = pressedContext();
    open(asked, context)
      .catch(() => fail(asked, DICTATION_NOTE.MICROPHONE_FAILED))
      .finally(() => {
        if (context !== undefined && recording.current?.context !== context) {
          context.close().catch(() => undefined);
        }
      });
  };

  const onFieldKey = (event: KeyboardEvent): boolean => {
    if (phase === DICTATION_PHASE.IDLE) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return true;
    }
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (phase === DICTATION_PHASE.RECORDING) finish();
      return true;
    }
    return false;
  };

  return { phase, keyMissing, analyzer, startedAt, start, finish, cancel, onFieldKey };
}

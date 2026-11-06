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
import type { ComposerEditorHandle, ComposerMark } from "../plan-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { base64Of } from "./attached-files.js";
import { openPreferredMicrophone } from "./microphone-choice.js";

/**
 * use-dictation.ts -- a message box's dictation: the microphone recorded in this panel, heard as words by our service, and the words put at the caret.
 *
 * The press opens the preferred microphone (the Mac's own over a
 * Bluetooth headset's, `./microphone-choice.ts`), after
 * asking macOS where it has not been asked, and records it as Opus in
 * WebM at the wire's bitrate, measured by an analyzer the strip draws,
 * whose audio context the press itself makes, as Safari on iOS requires.
 * Finishing hands the clip to main in one act, and main to our service,
 * which has OpenAI hear it and answers the words; the renderer never
 * reaches OpenAI. The words go in at the caret the press found, carried
 * through whatever changed the words since as a mark the box's editor keeps
 * (`../plan-editor/composer-editor.ts`), spaced from the words around them,
 * never over the draft, and the box takes the caret back after them; words a
 * full box has no room for are not put in at all.
 * Canceling, or a press elsewhere that unmounts the box, drops the clip
 * unsent. The recording stops itself a second short of the wire's two
 * minutes on a deadline of its own, kept on the renderer's runtime rather
 * than on the recorder's events, which a hidden page may hold back. ✓ waits for the microphone
 * to open, since until then there is nothing to send. Whatever fails says
 * why in the box's note and keeps nothing, the microphone let go with it.
 * A clip is heard on the account's own OpenAI key, so with none saved the
 * press opens Settings › Agents rather than the microphone, and a clip the
 * service refused for want of one says to add it (`../openai-key.tsx`).
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
  MICROPHONE_DENIED: `${PRODUCT_NAME} cannot use the microphone. Allow it in System Settings › Privacy & Security › Microphone.`,
  MICROPHONE_FAILED: "The microphone could not be opened.",
  BOX_FULL: "There is no room for the dictated words.",
  NO_WORDS: "No words were heard.",
  FAILED: "The recording could not be transcribed. Try again.",
  OPENAI_KEY_MISSING: OPENAI_KEY_MISSING_NOTE,
} as const;

/** What the recorder writes: Opus in WebM, the one container the wire carries. */
const RECORDING_TYPE = `${DICTATION_AUDIO_TYPE};codecs=opus`;

/** How often the recorder hands over what it holds, so a stop has little left to flush. */
const RECORDER_SLICE_MS = 1_000;

/** The length a recording stops itself at: a second short of the bound, so the clip lands inside it. */
const DICTATION_AUTO_STOP = Duration.millis(DICTATION_BOUNDS.MAX_DURATION_MS - 1_000);

/** The analyzer's window: enough samples for a steady level at a frame's rate. */
const ANALYZER_FFT_SIZE = 1_024;

/** One recording as it stands: what was opened for it, and what it has written. */
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
  /** Whether the account is known to have no OpenAI API key, when `start` opens Settings › Agents instead. */
  keyMissing: boolean;
  /** What the strip measures; nothing until the microphone is open. */
  analyzer: AnalyserNode | undefined;
  /** When the recording began on the page's clock; nothing until the microphone is open, which is when ✓ takes a press. */
  startedAt: number | undefined;
  start: () => void;
  finish: () => void;
  cancel: () => void;
  /** The box's own keys while a dictation stands; answers whether it took the key. */
  onFieldKey: (event: KeyboardEvent) => boolean;
}

/** Everything a recording opened, let go: the microphone's light goes out with the tracks. */
function release(opened: { readonly stream: MediaStream; readonly context?: AudioContext }): void {
  for (const track of opened.stream.getTracks()) track.stop();
  opened.context?.close().catch(() => undefined);
}

/**
 * The meter's context, made and resumed in the press itself, because Safari on
 * iOS runs a context only from a gesture and leaves one made after the
 * microphone's await suspended: its bars stay at rest while the clip still
 * records. Nothing where the page can make none, which the open reports.
 */
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
  /** The box's editor, which marks the caret and takes the words; nothing until it has mounted. */
  editor: RefObject<ComposerEditorHandle | undefined>;
  /** The words the clip is likely to say (`dictation-keywords.ts`). */
  keywords: readonly string[];
  /** Says why a dictation left nothing, or clears what the last one said. */
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
  // Note that each press and each cancel is a generation of its own, because
  // a microphone opening or an answer arriving late must find the dictation
  // it was for gone rather than act on the one after it.
  const generation = useRef(0);
  const recording = useRef<Recording | undefined>(undefined);
  /** Where the words go: the caret as the press found it, carried through every change since. */
  const marked = useRef<ComposerMark | undefined>(undefined);
  const latest = useRef(input);
  latest.current = input;
  // The deadline stands from the moment the microphone opens: an atom on the
  // renderer's runtime, so it is let go with the box and a test's clock reaches it.
  const [idle] = useState(() => rendererRuntime.atom(Effect.asVoid(Effect.never)));
  const [deadline, setDeadline] = useState(idle);
  const deadlinePassed = AsyncResult.isSuccess(useAtomValue(deadline));

  /** Lets the standing dictation go unsent: a later stop, open, or answer finds its generation passed. */
  const drop = () => {
    generation.current += 1;
    const standing = recording.current;
    recording.current = undefined;
    if (standing === undefined) return;
    if (standing.recorder.state !== "inactive") standing.recorder.stop();
    release(standing);
  };

  // A box that goes away takes its recording with it, unsent.
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
    // A clip refused for want of the key says to add one, rather than that it failed.
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
    // Note that ✓ before the microphone opens does nothing, because there is no clip yet and ✕ is the way out.
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
    // Note that the platform's own microphone permission and route are asked
    // only where it offers them: elsewhere the page's own ask is the whole of it.
    const state = queryClient.getQueryData(appStateQuery.queryKey);
    const routed = state !== undefined && selectCapability(HOST_CAPABILITY.MICROPHONE)(state);
    // Note that macOS is asked only where it has not answered, because the ask is counted and a granted microphone needs none.
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
    // Note that what follows the open can still throw, a recorder refusing the
    // format, so the microphone is let go there too rather than left lit.
    try {
      const measured = context.createAnalyser();
      measured.fftSize = ANALYZER_FFT_SIZE;
      context.createMediaStreamSource(stream).connect(measured);
      // Safari on iOS may suspend the context as the microphone takes the audio session.
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

  // The deadline passing is a press of ✓.
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
    // The caret stays in the box, so its keys are the strip's while the button that was pressed goes.
    box.focus();
    const context = pressedContext();
    open(asked, context)
      .catch(() => fail(asked, DICTATION_NOTE.MICROPHONE_FAILED))
      // A context no recording took, the open failed or passed, is let go here.
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

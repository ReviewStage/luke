// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type DictationTranscribeAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentAttachment } from "@sidecar/hosted/coding-agent-wire";
import { DICTATION_BOUNDS } from "@sidecar/hosted/dictation-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActOutcome,
  type ActPayload,
} from "#shared/messages/acts";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "#shared/messages/audio";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import { NewPlanForm } from "./new-plan-form";
import type { AgentComposerControl } from "./use-agent-composer";

/**
 * Dictating into a message box, through the boxes themselves: the
 * microphone and the recorder faked where the browser hands them over, and
 * the act to main answered here as main would. A press turns the card's
 * foot into the strip; Escape drops the clip unsent and leaves the draft as
 * it was; finishing sends the clip once with the plan's words and puts what
 * it said at the caret, the draft kept on both sides; a clip that could not
 * be heard says why in the box's note; and the New Plan card dictates the
 * same way into the plan's name.
 */

const CLIP = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
const CLIP_BASE64 = "GkXfow==";
const KEYWORDS = ["acme/relay", "relay", "Teammate invitations"];

/** The fake recorders, newest last, each as the hook left it. */
let recorders: FakeRecorder[] = [];
/** The microphone tracks opened, so a test can see each was let go. */
let tracks: { stopped: boolean }[] = [];
/** Every act the boxes sent. */
let sent: Act[] = [];
/** The transcriptions asked for, held until the test answers each. */
let transcriptions: ((answer: DictationTranscribeAnswerView) => void)[] = [];
let microphoneStatus: MicrophoneStatus = MICROPHONE_STATUS.GRANTED;

/** A `MediaRecorder` as far as the hook reads one: it starts, and its stop hands over the clip. */
class FakeRecorder {
  state: RecordingState = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly options: MediaRecorderOptions | undefined;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.options = options;
    recorders.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([CLIP]) });
    this.onstop?.();
  }
}

/** An `AudioContext` as far as the strip reads one: an analyser that hears silence. */
class FakeAudioContext {
  createAnalyser() {
    return { fftSize: 0, getByteTimeDomainData: () => undefined };
  }

  createMediaStreamSource() {
    return { connect: () => undefined };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function openedStream(): MediaStream {
  const track = { stopped: false, stop: () => (track.stopped = true) };
  tracks.push(track);
  // SAFETY: the hook reads a stream's tracks alone, which this stands for.
  return { getTracks: () => [track] } as unknown as MediaStream;
}

/** The bridge, answering the boxes' acts as main would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.MICROPHONE_REQUEST:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: microphoneStatus });
    case ACT_KIND.MICROPHONE_ROUTE:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
    case ACT_KIND.DICTATION_TRANSCRIBE:
      return new Promise((resolve) => {
        transcriptions.push((value) => resolve({ status: ACT_OUTCOME_STATUS.DONE, value }));
      });
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  recorders = [];
  tracks = [];
  sent = [];
  transcriptions = [];
  microphoneStatus = MICROPHONE_STATUS.GRANTED;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: answer,
      recordSurfaceEvent: () => undefined,
      onAppState: () => () => undefined,
      requestAppState: () => new Promise(() => undefined),
    },
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => Promise.resolve(openedStream()),
      enumerateDevices: () => Promise.resolve([]),
    },
  });
  Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
  // The strip draws on animation frames, which this document never paints; none is run.
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: () => 0 });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

const ignore = () => undefined;

/** The agent's box over a draft the test can read, and the box's own presses. */
function mountComposer(initial: string) {
  let drafted = initial;
  function Probe() {
    const [draft, setDraft] = useState(initial);
    const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>([]);
    drafted = draft;
    const composer: AgentComposerControl = {
      draft,
      setDraft,
      attachments,
      setAttachments,
      sending: false,
      note: undefined,
      closed: undefined,
      send: ignore,
      retry: ignore,
      sent: [],
    };
    return createElement(AgentComposer, {
      status: CODING_AGENT_STATUS.COMPLETED,
      composer,
      model: undefined,
      models: undefined,
      readModels: ignore,
      usage: undefined,
      published: undefined,
      doors: { openGitHub: ignore, copy: ignore },
      onStop: () => Promise.resolve(),
      followsUp: true,
      keywords: KEYWORDS,
    });
  }
  return { ...render(createElement(Probe)), draft: () => drafted };
}

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const field = (): HTMLTextAreaElement => {
    const found = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(found, "the box is drawn");
    return found;
  };
  const button = (label: string): HTMLButtonElement => {
    const found = container.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
    assert.ok(found, `the card draws ${label}`);
    return found;
  };
  return {
    container,
    field,
    button,
    strip: () => container.querySelector(".dictation-strip"),
    note: () => container.querySelector("[role='alert']")?.textContent ?? undefined,
    /** Puts the caret at a place in the box's words. */
    caretAt: (at: number) => act(() => field().setSelectionRange(at, at)),
    /** Presses Dictate and lets the microphone open. */
    dictate: async () => {
      act(() => button("Dictate").click());
      await settle();
    },
    key: (key: string): boolean => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => {
        field().dispatchEvent(event);
      });
      return !event.defaultPrevented;
    },
    /** Answers the transcription asked for at the index. */
    transcribed: async (index: number, value: DictationTranscribeAnswerView) => {
      const respond = transcriptions[index];
      assert.ok(respond, `transcription ${index} was asked for`);
      await act(async () => {
        respond(value);
        await Promise.resolve();
      });
      await settle();
    },
  };
}

/** The clips sent to be heard, as main received them. */
function clips(): ActPayload<typeof ACT_KIND.DICTATION_TRANSCRIBE>[] {
  return sent.flatMap((request) =>
    request.kind === ACT_KIND.DICTATION_TRANSCRIBE ? [request.payload] : [],
  );
}

test("Dictate turns the card's foot into the strip, recording Opus at the wire's bitrate, and takes no typing while it stands", async () => {
  const box = mountComposer("");
  assert.equal(box.strip(), null);

  await box.dictate();

  assert.ok(box.strip(), "the strip stands in the foot");
  assert.equal(box.container.querySelector("button[aria-label='Send']"), null);
  assert.equal(recorders.length, 1);
  assert.equal(recorders[0]?.state, "recording");
  assert.deepEqual(recorders[0]?.options, {
    mimeType: "audio/webm;codecs=opus",
    audioBitsPerSecond: DICTATION_BOUNDS.AUDIO_BITS_PER_SECOND,
  });
  assert.equal(box.field().readOnly, true);
  assert.equal(box.container.querySelector(".dictation-clock")?.textContent, "0:00");
});

test("Escape drops the recording unsent, lets the microphone go, and leaves the draft as it was", async () => {
  const box = mountComposer("Keep this draft");
  await box.dictate();

  const leftToBrowser = box.key("Escape");
  await settle();

  assert.equal(leftToBrowser, false);
  assert.equal(box.strip(), null);
  assert.ok(box.button("Dictate"));
  assert.deepEqual(clips(), []);
  assert.ok(
    tracks.every((track) => track.stopped),
    "the microphone is let go",
  );
  assert.equal(box.draft(), "Keep this draft");
  assert.equal(document.activeElement, box.field(), "the box keeps the caret");
});

test("✓ sends the clip once with the plan's words, then puts what it said at the caret, spaced, with the draft kept on both sides", async () => {
  const box = mountComposer("Fix the bug in please");
  box.caretAt("Fix the bug in".length);
  await box.dictate();

  act(() => box.button("Done").click());
  await settle();

  assert.ok(
    box.container.querySelector(".dictation-transcribing"),
    "the strip says it is transcribing",
  );
  assert.equal(clips().length, 1);
  const [clip] = clips();
  assert.equal(clip?.audio, CLIP_BASE64);
  assert.deepEqual(clip?.keywords, KEYWORDS);
  assert.ok(
    tracks.every((track) => track.stopped),
    "the microphone is let go once the clip is taken",
  );

  await box.transcribed(0, { text: " the login form " });

  assert.equal(box.draft(), "Fix the bug in the login form please");
  assert.equal(box.strip(), null);
  assert.equal(document.activeElement, box.field());
  const after = "Fix the bug in the login form".length;
  assert.deepEqual([box.field().selectionStart, box.field().selectionEnd], [after, after]);
});

test("Enter finishes a recording rather than sending the draft", async () => {
  const box = mountComposer("");
  await box.dictate();

  const leftToBrowser = box.key("Enter");
  await settle();
  await box.transcribed(0, { text: "Run the tests" });

  assert.equal(leftToBrowser, false);
  assert.equal(box.draft(), "Run the tests");
});

test("a clip that could not be heard says why in the box's note and changes nothing", async () => {
  const box = mountComposer("Draft");
  await box.dictate();
  act(() => box.button("Done").click());
  await settle();

  await box.transcribed(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });

  assert.equal(box.note(), "The recording couldn't be transcribed. Try again.");
  assert.equal(box.draft(), "Draft");
  assert.equal(box.strip(), null);

  await box.dictate();
  assert.equal(box.note(), undefined, "a new press clears the old note");
  act(() => box.button("Done").click());
  await settle();
  await box.transcribed(1, { text: "   " });
  assert.equal(box.note(), "No words were heard.");
});

test("a microphone macOS refused says where to allow it, and records nothing", async () => {
  microphoneStatus = MICROPHONE_STATUS.DENIED;
  const box = mountComposer("");

  await box.dictate();

  assert.equal(
    box.note(),
    "Luke can't use the microphone. Allow it in System Settings › Privacy & Security › Microphone.",
  );
  assert.equal(recorders.length, 0);
  assert.equal(box.strip(), null);
});

test("the New Plan card dictates into the plan's name with the same strip, listening for its repository", async () => {
  const page = render(
    createElement(NewPlanForm, {
      newPlan: { presses: 0, preset: undefined, start: () => Promise.resolve(undefined) },
      repositories: {
        recent: ["acme/relay"],
        read: () =>
          Promise.resolve({
            repositories: { installed: true, repositories: [], installationUrl: "" },
          }),
        openGitHub: ignore,
        pictures: false,
      },
    }),
  );

  await page.dictate();
  assert.ok(page.strip());
  act(() => page.button("Done").click());
  await settle();
  await page.transcribed(0, { text: "Dark mode toggle" });

  assert.deepEqual(clips()[0]?.keywords, ["acme/relay", "relay"]);
  assert.equal(page.field().value, "Dark mode toggle");
});

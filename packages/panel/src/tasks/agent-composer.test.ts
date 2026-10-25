// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_BOUNDS, CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@luke/features/repository-reach-wire";
import { TASK_SKILL_SOURCE } from "@luke/features/task-wire";
import { pasteCutWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import type { SkillOption } from "@luke/ui/skill-mention";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pasteInComposer,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { AgentComposer } from "./agent-composer.js";
import { type RepositoryRemedyDoors, RepositoryRemedyProvider } from "./repository-remedy.js";
import type { SkillSource } from "./skill-picker.js";
import { type MessageSender, useAgentComposer } from "./use-agent-composer.js";

/**
 * The agent's message box as the developer works it, on the editor bundle's
 * editor: typing reaches the draft, Enter sends it and the box empties, a
 * message that did not go comes back into the box, an input method's Enter
 * sends nothing, the box takes the caret as it opens and gives it up on
 * Escape, a `/` opens the repository's skills and a pick writes its chip,
 * and a dictation's words land where the caret stood as it began.
 */

const SKILLS: readonly SkillOption[] = [
  {
    name: "release",
    description: "Use to cut a release.",
    source: TASK_SKILL_SOURCE.REPOSITORY,
    path: ".agents/skills/release/SKILL.md",
  },
  {
    name: "deploy",
    description: "Use to deploy the web.",
    source: TASK_SKILL_SOURCE.REPOSITORY,
    path: ".agents/skills/deploy/SKILL.md",
  },
];

const reading: SkillSource = () => Promise.resolve({ skills: SKILLS });

const ignore = () => undefined;

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The box on the composer's own control, its sends answered by `sender`. */
function Box({
  sender,
  call,
}: {
  sender: MessageSender;
  /** What stands in Call's place, and whether a call holds the microphone, as an agent's tab hands them. */
  call?: { controls: ReactNode; onCall: boolean };
}): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(
    "div",
    null,
    createElement(AgentComposer, {
      ...QUIET_COMPOSER,
      composer,
      skills: reading,
      call: call?.controls,
      dictates: !(call?.onCall ?? false),
    }),
    // What Continue would carry, as the tab hands it on.
    createElement("output", { "data-unsent": composer.unsent.words }),
  );
}

/** The box mounted, every message it sends written down and answered by `answer`. */
async function mounted(answer: () => Promise<CodingAgentAgentAnswer> = () => new Promise(ignore)) {
  const sent: { text: string; clientKey: string }[] = [];
  const sender: MessageSender = (_agentId, text, clientKey) => {
    sent.push({ text, clientKey });
    return answer();
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(Box, { sender }))),
  );
  await settle();
  return {
    container,
    sent,
    /** The words the box's editor shows. */
    shown: () => composerEditor(container).textContent,
    button: (label: string) =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
  };
}

test("the box takes the caret as it opens, Enter sends what was typed, and the box empties and keeps the caret before the send answers", async () => {
  const box = await mounted();
  assert.equal(document.activeElement, composerEditor(box.container));
  assert.equal(box.button("Send")?.disabled, true, "an empty box sends nothing");

  typeInComposer(box.container, "Fix the bug");
  assert.equal(box.button("Send")?.disabled, false);
  pressInComposer(box.container, "Enter");
  await settle();

  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Fix the bug"],
  );
  assert.equal(box.shown(), "");
  assert.equal(
    composerEditor(box.container).getAttribute("aria-disabled"),
    null,
    "the box takes words while the message is out",
  );
  assert.equal(document.activeElement, composerEditor(box.container), "and keeps the caret");
  typeInComposer(box.container, "and the next one");
  assert.equal(box.shown(), "and the next one");
});

test("a paste past the box's cap is cut to the room left and the note says so, until the words change", async () => {
  const box = await mounted();
  const cap = CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS;
  const note = () => box.container.querySelector(".luke-composer-foot-note")?.textContent;
  assert.equal(note(), undefined);

  pasteInComposer(box.container, "x".repeat(cap + 500));
  assert.equal(box.shown().length, cap, "the box holds what fits");
  assert.equal(note()?.includes(pasteCutWords(cap)), true, "and says the rest was cut");

  const editor = composerEditor(box.container).editor;
  assert.ok(editor, "the editor is running");
  act(() => {
    editor.view.dispatch(editor.state.tr.delete(1, 2));
  });
  assert.equal(note(), undefined, "the note goes once the words change again");
});

test("a paste that fits the cap says nothing of a cut", async () => {
  const box = await mounted();
  pasteInComposer(box.container, "x".repeat(1000));
  assert.equal(box.shown().length, 1000);
  assert.equal(box.container.querySelector(".luke-composer-foot-note"), null);
});

test("a paste into a full box whose message did not go leaves the failure and its Retry standing", async () => {
  const box = await mounted(() =>
    Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
  );
  typeInComposer(box.container, "x".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS));
  pressInComposer(box.container, "Enter");
  await settle();
  const retry = () =>
    [...box.container.querySelectorAll("button")].find((each) => each.textContent === "Retry");
  assert.ok(retry(), "Retry is offered");

  pasteInComposer(box.container, "more");
  assert.ok(retry(), "the cut paste took nothing from the failure");
});

test("the length counter stands from four fifths of the cap and not before", async () => {
  const box = await mounted();
  const cap = CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS;
  const counter = () => box.container.querySelector(".luke-length-counter")?.textContent;

  typeInComposer(box.container, "x".repeat(cap * 0.8 - 1));
  assert.equal(counter(), undefined);
  typeInComposer(box.container, "x");
  assert.equal(counter(), `${cap * 0.8}/${cap}`);
});

test("words selected raise the format toolbar, its marks alone, and a message bolded from it is sent as its Markdown", async () => {
  const box = await mounted();
  typeInComposer(box.container, "Ship it now");
  const editor = composerEditor(box.container).editor ?? assert.fail("the editor is running");

  act(() => {
    editor.commands.setTextSelection({ from: 1 + "Ship ".length, to: 1 + "Ship it".length });
  });
  const toolbar =
    box.container.querySelector<HTMLElement>('[role="toolbar"][aria-label="Formatting"]') ??
    assert.fail("the toolbar stands over the words");
  const presses = [...toolbar.querySelectorAll("button")].map((each) =>
    each.getAttribute("aria-label"),
  );
  assert.deepEqual(presses, ["Bold", "Italic", "Strikethrough", "Code", "Link"]);

  act(() => toolbar.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')?.click());
  pressInComposer(box.container, "Enter");
  await settle();

  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Ship **it** now"],
  );
});

test("a message that did not go comes back into the box, the caret at its end, and Retry sends it again under its key", async () => {
  const box = await mounted(() =>
    Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
  );
  typeInComposer(box.container, "Fix the bug");
  pressInComposer(box.container, "Enter");
  await settle();

  assert.equal(box.shown(), "Fix the bug");
  const retry = [...box.container.querySelectorAll("button")].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry, "Retry is offered");
  act(() => retry.click());
  await settle();
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Fix the bug", "Fix the bug"],
  );
  assert.equal(box.sent[0]?.clientKey, box.sent[1]?.clientKey);

  composerEditor(box.container).focus();
  typeInComposer(box.container, ", please");
  assert.equal(box.shown(), "Fix the bug, please", "typing goes on at the words' end");
});

/** The agent as the service answers a message it took. */
const TAKEN: CodingAgentAgentAnswer = {
  agent: {
    id: "agent-1",
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_800_000_000_000,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: null,
  },
};

/** The box mounted, its one send answered only as the test lets it. */
async function answeredLater() {
  let answer: (answered: CodingAgentAgentAnswer) => void = ignore;
  const box = await mounted(
    () =>
      new Promise<CodingAgentAgentAnswer>((resolve) => {
        answer = resolve;
      }),
  );
  return { ...box, answer: (answered: CodingAgentAgentAnswer) => answer(answered) };
}

/** The box mounted, each send answered only as the test lets it, in the order they went. */
async function answeredInTurn() {
  const answers: ((answered: CodingAgentAgentAnswer) => void)[] = [];
  const box = await mounted(
    () =>
      new Promise<CodingAgentAgentAnswer>((resolve) => {
        answers.push(resolve);
      }),
  );
  return {
    ...box,
    answer: async (index: number, answered: CodingAgentAgentAnswer) => {
      answers[index]?.(answered);
      await settle();
    },
  };
}

test("a message sent while one is out goes once the one before it answers, so the agent hears them in order", async () => {
  const box = await answeredInTurn();
  typeInComposer(box.container, "First");
  pressInComposer(box.container, "Enter");
  await settle();
  typeInComposer(box.container, "Second");
  pressInComposer(box.container, "Enter");
  await settle();
  assert.equal(box.shown(), "", "both left the box at once");
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["First"],
    "the second waits for the first's answer",
  );

  await box.answer(0, TAKEN);
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["First", "Second"],
  );
  assert.notEqual(box.sent[0]?.clientKey, box.sent[1]?.clientKey);
});

test("a message refused after the developer wrote on keeps their words in the box, and Retry sends the refused one again under its key", async () => {
  const box = await answeredInTurn();
  typeInComposer(box.container, "First");
  pressInComposer(box.container, "Enter");
  await settle();
  typeInComposer(box.container, "Still writing");

  await box.answer(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(box.shown(), "Still writing", "the newer words stay");
  const retry =
    [...box.container.querySelectorAll("button")].find((each) => each.textContent === "Retry") ??
    assert.fail("Retry is offered");
  act(() => retry.click());
  await settle();
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["First", "First"],
  );
  assert.equal(box.sent[1]?.clientKey, box.sent[0]?.clientKey);
  assert.equal(box.shown(), "Still writing", "and are never sent over");
});

test("a message refused while another waits behind it still lets that one go, and comes back into the box with its Retry", async () => {
  const box = await answeredInTurn();
  typeInComposer(box.container, "First");
  pressInComposer(box.container, "Enter");
  await settle();
  typeInComposer(box.container, "Second");
  pressInComposer(box.container, "Enter");
  await settle();

  await box.answer(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["First", "Second"],
    "the refusal drops nothing behind it",
  );
  assert.equal(box.shown(), "First", "the refused words wait in the box");
  assert.ok(
    [...box.container.querySelectorAll("button")].some((each) => each.textContent === "Retry"),
    "with Retry beside them",
  );
});

test("a message sent with Send hands the caret to the box as it opens again", async () => {
  const box = await answeredLater();
  typeInComposer(box.container, "Fix the bug");
  const send = box.button("Send");
  assert.ok(send);
  send.focus();
  act(() => send.click());
  await settle();

  box.answer(TAKEN);
  await settle();
  assert.equal(document.activeElement === composerEditor(box.container), true);
});

test("a box that opens again after a send leaves the caret where the developer went meanwhile", async () => {
  const box = await answeredLater();
  typeInComposer(box.container, "Fix the bug");
  pressInComposer(box.container, "Enter");
  await settle();
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  elsewhere.focus();

  box.answer(TAKEN);
  await settle();
  assert.equal(document.activeElement === elsewhere, true);
});

test("a box that opens again after a send leaves the caret on a press of its own foot the developer went to meanwhile", async () => {
  const box = await answeredLater();
  typeInComposer(box.container, "Fix the bug");
  pressInComposer(box.container, "Enter");
  await settle();
  const servers = box.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Integrations"]',
  );
  assert.ok(servers);
  servers.focus();

  box.answer(TAKEN);
  await settle();
  assert.equal(document.activeElement === servers, true);
});

test("an Enter an input method is composing sends nothing, and Shift+Enter is a new line", async () => {
  const box = await mounted();
  typeInComposer(box.container, "日本");
  pressInComposer(box.container, "Enter", { isComposing: true, keyCode: 229 });
  pressInComposer(box.container, "Enter", { shiftKey: true });
  await settle();
  assert.deepEqual(box.sent, []);
});

test("on a coarse pointer Enter is a new line in the box, and Send sends the lines", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: ignore,
    removeEventListener: ignore,
  }));
  const box = await mounted();
  typeInComposer(box.container, "Fix the bug");
  pressInComposer(box.container, "Enter");
  typeInComposer(box.container, "then ship it");
  await settle();
  assert.equal(box.sent.length, 0, "Enter sent nothing");

  const send = box.button("Send");
  assert.ok(send);
  act(() => send.click());
  await settle();
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Fix the bug\nthen ship it"],
  );
});

test("the box leaves the caret where the developer is typing elsewhere, and Escape gives the caret up", async () => {
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  elsewhere.focus();
  const box = await mounted();
  assert.equal(document.activeElement, elsewhere);

  composerEditor(box.container).focus();
  pressInComposer(box.container, "Escape");
  assert.notEqual(document.activeElement, composerEditor(box.container));
});

test("a / opens the repository's skills over the caret, the keys move through them, and a pick writes its chip", async () => {
  const box = await mounted();
  typeInComposer(box.container, "Ship it with /");
  await settle();
  const rows = () =>
    [...box.container.querySelectorAll('[role="listbox"] [role="option"]')].map((row) => ({
      name: row.querySelector(".luke-combobox-option-label")?.textContent,
      chosen: row.getAttribute("aria-selected"),
    }));
  assert.deepEqual(rows(), [
    { name: "/release", chosen: "true" },
    { name: "/deploy", chosen: "false" },
  ]);
  const editor = composerEditor(box.container);
  assert.equal(editor.getAttribute("aria-expanded"), "true");
  assert.equal(
    editor.getAttribute("aria-activedescendant"),
    box.container.querySelector('[role="option"]')?.id,
  );

  pressInComposer(box.container, "ArrowDown");
  pressInComposer(box.container, "Enter");
  await settle();
  assert.equal(box.sent.length, 0, "the Enter picked rather than sent");
  assert.equal(box.container.querySelector('[role="listbox"]'), null);
  assert.equal(
    box.container.querySelector(".agent-composer-input [data-skill-ref]")?.textContent,
    "/deploy",
  );
  typeInComposer(box.container, "now");
  pressInComposer(box.container, "Enter");
  await settle();
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Ship it with /deploy now"],
  );
});

test("a row of the skills' list leads with a book, says what it is for and where it comes from, and hangs the skill's card beside it", async () => {
  const box = await mounted();
  typeInComposer(box.container, "Ship it with /");
  await settle();
  const [row] = box.container.querySelectorAll('[role="listbox"] [role="option"]');
  assert.ok(row, "the list offers the skills");
  assert.ok(row.querySelector(".luke-combobox-option-glyph svg"), "the row leads with a book");
  assert.equal(
    row.querySelector(".luke-combobox-option-detail")?.textContent,
    SKILLS[0]?.description,
  );
  assert.equal(row.querySelector(".luke-combobox-option-hint")?.textContent, "Repository");

  restOn(row);

  const card = document.querySelector<HTMLElement>(".luke-tooltip-card > [data-skill-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "/release");
  assert.equal(card?.querySelector(".luke-hover-card-note")?.textContent, SKILLS[0]?.description);
});

test("Escape closes the skills' list without leaving the box, and the list stays closed while the word is typed on", async () => {
  const box = await mounted();
  typeInComposer(box.container, "/re");
  await settle();
  assert.ok(box.container.querySelector('[role="listbox"]'));

  pressInComposer(box.container, "Escape");
  assert.equal(box.container.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, composerEditor(box.container));
  typeInComposer(box.container, "l");
  assert.equal(box.container.querySelector('[role="listbox"]'), null);
});

/** A microphone that opens at once and a recorder that hands over what it heard as it stops, in place of the Mac's. */
function stubMicrophone(): void {
  const track = { stop: ignore };
  const stream = { getTracks: () => [track] };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => Promise.resolve(stream),
      enumerateDevices: () => Promise.resolve([]),
    },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      createAnalyser() {
        return { fftSize: 0, frequencyBinCount: 0, getByteTimeDomainData: ignore };
      }
      createMediaStreamSource() {
        return { connect: ignore };
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal(
    "MediaRecorder",
    class {
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | undefined;
      onstop: (() => void) | undefined;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["clip"]) });
        this.onstop?.();
      }
    },
  );
}

test("a dictation's words land where the caret stood as it began, spaced from the words around them", async () => {
  stubMicrophone();
  // The strip draws still under reduced motion, which jsdom has no answer to.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    addEventListener: ignore,
    removeEventListener: ignore,
  }));
  fakeAppBridge({});
  // Main answers the microphone granted, and no route to prefer.
  fakeActPort({
    [ACT_KIND.MICROPHONE_REQUEST]: () => Promise.resolve(MICROPHONE_STATUS.GRANTED),
    [ACT_KIND.MICROPHONE_ROUTE]: () => Promise.resolve(undefined),
    [ACT_KIND.DICTATION_TRANSCRIBE]: () => Promise.resolve({ text: "the bug in" }),
  });
  const box = await mounted();
  typeInComposer(box.container, "Fix this later");
  const editor = composerEditor(box.container).editor;
  assert.ok(editor, "the editor is running");
  // The caret goes after "Fix", as a press there would put it.
  act(() => editor.commands.setTextSelection(4));

  const dictate = box.button("Dictate");
  assert.ok(dictate, "the microphone is offered");
  act(() => dictate.click());
  await settle();
  typeInComposer(box.container, "typed");
  pressInComposer(box.container, "Enter");
  await settle();

  assert.equal(box.shown(), "Fix the bug in this later");
  assert.deepEqual(box.sent, [], "the Enter finished the dictation rather than sending");
  typeInComposer(box.container, " again");
  assert.equal(box.shown(), "Fix the bug in again this later", "the caret stands after the words");
});

test("a dictation the service refused for want of an OpenAI key says to add one in Settings, not that the recording failed", async () => {
  stubMicrophone();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    addEventListener: ignore,
    removeEventListener: ignore,
  }));
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.MICROPHONE_REQUEST]: () => Promise.resolve(MICROPHONE_STATUS.GRANTED),
    [ACT_KIND.MICROPHONE_ROUTE]: () => Promise.resolve(undefined),
    [ACT_KIND.DICTATION_TRANSCRIBE]: () =>
      Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.OPENAI_KEY_MISSING }),
  });
  const box = await mounted();
  const dictate = box.button("Dictate");
  assert.ok(dictate, "the microphone is offered");
  act(() => dictate.click());
  await settle();
  pressInComposer(box.container, "Enter");
  await settle();

  const said = box.container.textContent ?? "";
  assert.match(said, /Add an OpenAI key in settings/u);
  assert.doesNotMatch(said, /could not be transcribed/u);
  assert.equal(box.shown(), "", "nothing was put in the box");
});

/**
 * The box at an agent's tab's foot with the microphone stubbed, its Call
 * slot holding End call, every clip read as `transcribed` answers; `draw`
 * puts a call up or takes it down.
 */
async function mountedForCall(transcribed: () => Promise<{ text: string }>) {
  stubMicrophone();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    addEventListener: ignore,
    removeEventListener: ignore,
  }));
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.MICROPHONE_REQUEST]: () => Promise.resolve(MICROPHONE_STATUS.GRANTED),
    [ACT_KIND.MICROPHONE_ROUTE]: () => Promise.resolve(undefined),
    [ACT_KIND.DICTATION_TRANSCRIBE]: transcribed,
  });
  const sender: MessageSender = () => new Promise(ignore);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = async (onCall: boolean) => {
    await act(async () =>
      root.render(
        onRegistry(
          registry,
          createElement(Box, {
            sender,
            call: {
              onCall,
              controls: createElement("button", { type: "button", "aria-label": "End call" }),
            },
          }),
        ),
      ),
    );
    await settle();
  };
  await draw(false);
  const press = (label: string) => {
    const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(found, `${label} is offered`);
    act(() => found.click());
  };
  return { container, draw, press };
}

test("a call that begins mid-dictation ends it, keeping the words said, and the row holds the call rather than the dictation's strip", async () => {
  const box = await mountedForCall(() => Promise.resolve({ text: "the invite page" }));
  box.press("Dictate");
  await settle();
  assert.ok(box.container.querySelector(".dictation-strip"), "the dictation stands");

  await box.draw(true);
  assert.equal(box.container.querySelector(".dictation-strip"), null);
  assert.ok(
    box.container.querySelector('button[aria-label="End call"]'),
    "the call's controls stand",
  );
  assert.equal(box.container.querySelector('button[aria-label="Dictate"]'), null);
  assert.equal(composerEditor(box.container).textContent, "the invite page");
});

test('a clip sent for reading draws its ring and its "Transcribing" together, the word with no dots, before the settle delay has passed', async () => {
  const box = await mountedForCall(() => new Promise(ignore));
  box.press("Dictate");
  await settle();
  box.press("Done");
  await settle();

  const reading = box.container.querySelector(".dictation-transcribing");
  assert.ok(reading, "the strip says it is transcribing");
  assert.ok(reading.querySelector('[data-slot="spinner"]'), "the ring stands with the word");
  assert.equal(reading.querySelector(":scope > [aria-hidden]")?.textContent, "Transcribing");
});

test("a clip still being read as a call begins keeps its strip and its Cancel beside the call's controls until its words land, then the row holds the call", async () => {
  let land: (answer: { text: string }) => void = ignore;
  const box = await mountedForCall(
    () =>
      new Promise((resolve) => {
        land = resolve;
      }),
  );
  box.press("Dictate");
  await settle();
  box.press("Done");
  await settle();

  await box.draw(true);
  assert.ok(box.container.querySelector(".dictation-strip"), "the reading still shows");
  assert.ok(box.container.querySelector('button[aria-label="Cancel"]'), "and can still be let go");
  assert.ok(
    box.container.querySelector('button[aria-label="End call"]'),
    "while the call's controls stand beside it",
  );

  await act(async () => land({ text: "the members list" }));
  await settle();
  assert.equal(box.container.querySelector(".dictation-strip"), null);
  assert.ok(
    box.container.querySelector('button[aria-label="End call"]'),
    "the call's controls stand",
  );
  assert.equal(composerEditor(box.container).textContent, "the members list");
});

/** The box under the window's repository doors, its one message refused for a repository its owner's other workspace reaches, and every later one taken. */
async function mountedRefusedForMove() {
  const sent: { text: string; clientKey: string }[] = [];
  const moves: { resolve: (moved: boolean) => void }[] = [];
  const sender: MessageSender = (_agentId, text, clientKey) => {
    sent.push({ text, clientKey });
    return Promise.resolve(
      sent.length === 1
        ? {
            failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
            unreached: {
              reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE,
              repository: "Acme/Relay",
              workspace: { id: "team-1", name: "Acme Team" },
            },
          }
        : { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    );
  };
  const doors: RepositoryRemedyDoors = {
    openWorkspaceGitHub: ignore,
    openGitHub: ignore,
    chooseRepository: ignore,
    moveTask: () => new Promise<boolean>((resolve) => moves.push({ resolve })),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(RepositoryRemedyProvider, { value: doors }, createElement(Box, { sender })),
      ),
    ),
  );
  await settle();
  typeInComposer(container, "Rebase on main");
  pressInComposer(container, "Enter");
  await settle();
  const move =
    [...container.querySelectorAll("button")].find(
      (each) => each.textContent === "Move task to Acme Team",
    ) ?? assert.fail("the note offers the move");
  act(() => move.click());
  await settle();
  return {
    container,
    sent,
    landMove: async () => {
      act(() => moves[0]?.resolve(true));
      await settle();
    },
  };
}

test("a message refused for a repository its owner's other workspace reaches moves the plan, then sends the same words again under the same key", async () => {
  const box = await mountedRefusedForMove();
  assert.equal(composerEditor(box.container).textContent, "Rebase on main");

  await box.landMove();

  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Rebase on main", "Rebase on main"],
  );
  assert.equal(box.sent[1]?.clientKey, box.sent[0]?.clientKey);
});

test("words edited while the move is out are never overwritten by the words that were refused", async () => {
  const box = await mountedRefusedForMove();
  typeInComposer(box.container, " and fix CI");

  await box.landMove();

  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Rebase on main"],
  );
  assert.equal(composerEditor(box.container).textContent, "Rebase on main and fix CI");
});

test("a message sent and refused while the move is out is not sent again when the move lands", async () => {
  const box = await mountedRefusedForMove();
  typeInComposer(box.container, " and fix CI");
  pressInComposer(box.container, "Enter");
  await settle();

  await box.landMove();

  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Rebase on main", "Rebase on main and fix CI"],
  );
});

/** What a remedy's press opened: pages of GitHub's, and places in Settings. */
interface OpenedByRemedy {
  readonly github: string[];
  readonly settings: SettingsLink[];
}

/** The box under the window's doors and Settings opener, its one message refused for `unreached`; answers what each press opened. */
async function mountedRefusedOnToken(unreached: RepositoryUnreached) {
  const opened: OpenedByRemedy = { github: [], settings: [] };
  const sender: MessageSender = () =>
    Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE, unreached });
  const doors: RepositoryRemedyDoors = {
    openWorkspaceGitHub: ignore,
    openGitHub: (url) => opened.github.push(url),
    chooseRepository: ignore,
    moveTask: () => Promise.resolve(false),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => opened.settings.push(link) },
          createElement(RepositoryRemedyProvider, { value: doors }, createElement(Box, { sender })),
        ),
      ),
    ),
  );
  await settle();
  typeInComposer(container, "Rebase on main");
  pressInComposer(container, "Enter");
  await settle();
  const press = (label: string) =>
    act(() =>
      (
        [...container.querySelectorAll("button")].find((each) => each.textContent === label) ??
        assert.fail(`the note offers ${label}`)
      ).click(),
    );
  return { container, opened, press };
}

test("a message refused because GitHub refused the member's own token offers Update GitHub token, which opens Settings › Profile", async () => {
  const box = await mountedRefusedOnToken({
    reason: REPOSITORY_UNREACHED.TOKEN_INVALID,
    repository: "acme/relay",
  });

  box.press("Update GitHub token");

  assert.ok(box.container.textContent?.includes("Your GitHub token was refused."));
  assert.deepEqual(box.opened.settings, [{ page: SETTINGS_VIEW.ACCOUNT }]);
  assert.deepEqual(box.opened.github, []);
});

test("a message refused because the member's token is not authorized for the organization's SAML SSO offers to authorize it, which opens GitHub's page", async () => {
  const authorizeUrl = "https://github.com/orgs/acme/sso?authorization_request=fixture";
  const box = await mountedRefusedOnToken({
    reason: REPOSITORY_UNREACHED.TOKEN_SSO,
    repository: "acme/relay",
    authorizeUrl,
  });

  box.press("Authorize token for acme");

  assert.deepEqual(box.opened.github, [authorizeUrl]);
  assert.deepEqual(box.opened.settings, []);
});

test("messages still waiting to go as the agent refuses one for good are all kept for Continue, in the order sent", async () => {
  const box = await answeredInTurn();
  typeInComposer(box.container, "Fix tests");
  pressInComposer(box.container, "Enter");
  await settle();
  typeInComposer(box.container, "Update docs");
  pressInComposer(box.container, "Enter");
  await settle();

  await box.answer(0, { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED });
  assert.deepEqual(
    box.sent.map((each) => each.text),
    ["Fix tests"],
    "the one behind it is not sent",
  );
  assert.equal(box.container.querySelector("output")?.dataset.unsent, "Fix tests\n\nUpdate docs");
});

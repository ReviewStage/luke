// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import {
  composerEditor,
  installEditorBundle,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "#testing/composer";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import type { SkillOption } from "./skill-mention";
import type { SkillSource } from "./skill-picker";
import { type MessageSender, useAgentComposer } from "./use-agent-composer";

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
    path: ".agents/skills/release/SKILL.md",
  },
  { name: "deploy", description: "Use to deploy the web.", path: ".agents/skills/deploy/SKILL.md" },
];

const reading: SkillSource = () => Promise.resolve({ skills: SKILLS });

const ignore = () => undefined;

const roots: Root[] = [];

// Set before any box renders, since the box reads the editor bundle once per window.
installEditorBundle();

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The box on the composer's own control, its sends answered by `sender`. */
function Box({ sender }: { sender: MessageSender }): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    planId: "plan-1",
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, composer, skills: reading });
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
  await act(async () => root.render(createElement(Box, { sender })));
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

test("the box takes the caret as it opens, Enter sends what was typed, and the box empties as the send is taken", async () => {
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
    "true",
    "the box is held while the message is out",
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

test("an Enter an input method is composing sends nothing, and Shift+Enter is a new line", async () => {
  const box = await mounted();
  typeInComposer(box.container, "日本");
  pressInComposer(box.container, "Enter", { isComposing: true, keyCode: 229 });
  pressInComposer(box.container, "Enter", { shiftKey: true });
  await settle();
  assert.deepEqual(box.sent, []);
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
      name: row.querySelector(".plan-compose-menu-name")?.textContent,
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
    box.container.querySelector(".agent-composer-input .skill-chip")?.textContent,
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

/** What main answers a dictation's acts with: the microphone granted, no route to prefer, and the words heard. */
function microphoneAnswer(request: Act): ActOutcome {
  if (request.kind === ACT_KIND.MICROPHONE_REQUEST) {
    return { status: ACT_OUTCOME_STATUS.DONE, value: MICROPHONE_STATUS.GRANTED };
  }
  if (request.kind === ACT_KIND.MICROPHONE_ROUTE) {
    return { status: ACT_OUTCOME_STATUS.DONE, value: undefined };
  }
  if (request.kind === ACT_KIND.DICTATION_TRANSCRIBE) {
    return { status: ACT_OUTCOME_STATUS.DONE, value: { text: "the bug in" } };
  }
  return { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT };
}

test("a dictation's words land where the caret stood as it began, spaced from the words around them", async () => {
  stubMicrophone();
  // The strip draws still under reduced motion, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: ignore, removeEventListener: ignore }),
  });
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => Promise.resolve(microphoneAnswer(request)),
      recordSurfaceEvent: ignore,
    },
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

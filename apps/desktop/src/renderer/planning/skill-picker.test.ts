// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentAttachment } from "@sidecar/hosted/coding-agent-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import { SKILL_MENU_NOTE, type SkillSource, type SkillsRead } from "./skill-picker";

/**
 * The list a `/` opens in an agent's message box: it opens at the start of
 * a word and nowhere else, reads the plan's repository's skills the first
 * time it opens and never before, lists each by its name and what it is
 * for, narrows as the name is typed, and takes the arrows, Enter, Tab, and
 * Escape while the caret stays in the box; a chosen skill is written into
 * the message as `/name`, drawn as a chip, sent as those words, and taken
 * out whole by one Backspace at its end. A repository keeping none says so
 * and where one goes.
 */

const SKILLS: SkillsRead = {
  skills: [
    { name: "release-notes", description: "Use when the developer asks for release notes." },
    { name: "testing", description: "Use for Vitest tests, mocks, coverage." },
    { name: "drizzle", description: "Use for Drizzle schemas and queries." },
  ],
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

const ignore = () => undefined;

/** The box mounted over a service answering the reads given in turn, the last again once they run out, every message sent written down, and every read of the skills counted. */
function mount(...answers: readonly SkillsRead[]) {
  const sent: string[] = [];
  let reads = 0;
  const source: SkillSource = () => {
    const answer = answers[Math.min(reads, answers.length - 1)] ?? SKILLS;
    reads += 1;
    return Promise.resolve(answer);
  };
  function Probe() {
    const [draft, setDraft] = useState("");
    const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>([]);
    return createElement(AgentComposer, {
      status: CODING_AGENT_STATUS.COMPLETED,
      composer: {
        draft,
        setDraft,
        attachments,
        setAttachments: (next) => setAttachments(next),
        sending: false,
        note: undefined,
        closed: undefined,
        send: () => {
          sent.push(draft.trim());
          setDraft("");
        },
        retry: ignore,
        sent: [],
      },
      model: undefined,
      models: undefined,
      readModels: ignore,
      usage: undefined,
      published: undefined,
      doors: { openGitHub: ignore, copy: ignore },
      onStop: () => Promise.resolve(),
      followsUp: true,
      skills: source,
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  const field = (): HTMLTextAreaElement => {
    const found = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(found, "the box is drawn");
    return found;
  };
  return {
    sent,
    reads: () => reads,
    field,
    /** Types the words into the box with the caret after them, as a keyboard would. */
    type: async (text: string) => {
      const box = field();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      assert.ok(setter);
      act(() => {
        box.focus();
        setter.call(box, text);
        box.setSelectionRange(text.length, text.length);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
    },
    /** One key pressed in the box; whether the box left its default to the browser. */
    key: async (init: KeyboardEventInit): Promise<boolean> => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      act(() => {
        field().dispatchEvent(event);
      });
      await settle();
      return !event.defaultPrevented;
    },
    /** The list's rows as `/name` and description, or nothing while no list stands. */
    rows: (): readonly string[] | undefined => {
      const list = container.querySelector('[role="listbox"]');
      if (list === null) return undefined;
      return [...list.querySelectorAll('[role="option"]')].map((row) =>
        [...row.children].map((part) => part.textContent).join(" — "),
      );
    },
    /** The highlighted row's name. */
    highlighted: () =>
      container.querySelector('[role="option"][aria-selected="true"] .plan-compose-menu-name')
        ?.textContent,
    /** What the list says where it offers no row. */
    note: () => container.querySelector('[role="listbox"] .plan-compose-menu-note')?.textContent,
    /** The words drawn as chips, in order. */
    chips: () => [...container.querySelectorAll(".skill-chip")].map((chip) => chip.textContent),
    click: (index: number) => {
      const row = container.querySelectorAll<HTMLElement>('[role="option"]')[index];
      assert.ok(row, `the list holds row ${index}`);
      act(() => row.click());
    },
  };
}

test("a `/` at the start of a word opens the repository's skills, read then and not before, each by its name and what it is for; typing narrows them", async () => {
  const box = mount();
  await box.type("Write the notes");
  assert.equal(box.rows(), undefined);
  assert.equal(box.reads(), 0, "nothing is read for a message that names no skill");

  await box.type("Write the notes /");
  assert.deepEqual(box.rows(), [
    "/release-notes — Use when the developer asks for release notes.",
    "/testing — Use for Vitest tests, mocks, coverage.",
    "/drizzle — Use for Drizzle schemas and queries.",
  ]);
  assert.equal(box.field().getAttribute("aria-expanded"), "true");
  assert.equal(box.highlighted(), "/release-notes");

  // A name that starts with the letters comes before one that only holds them or is described by them.
  await box.type("Write the notes /te");
  assert.deepEqual(box.rows(), [
    "/testing — Use for Vitest tests, mocks, coverage.",
    "/release-notes — Use when the developer asks for release notes.",
  ]);
  await box.type("Write the notes /schemas");
  assert.deepEqual(box.rows(), ["/drizzle — Use for Drizzle schemas and queries."]);
  await box.type("Write the notes /zzz");
  assert.deepEqual(box.rows(), []);
  assert.equal(box.note(), SKILL_MENU_NOTE.NO_MATCH);

  // A word with a space after it is done, and the list goes.
  await box.type("Write the notes /testing ");
  assert.equal(box.rows(), undefined);
  assert.equal(box.field().getAttribute("aria-expanded"), "false");
});

test("a `/` inside a word, inside backticks, or inside a fenced block opens nothing", async () => {
  const box = mount();
  for (const words of ["and/or", "see `src/", "```\nls /", "a path like ./scripts/"]) {
    await box.type(words);
    assert.equal(box.rows(), undefined, words);
  }
  await box.type("```\nls\n```\n/");
  assert.notEqual(box.rows(), undefined, "a fence that closed leaves the words after it free");
});

test("the arrows move the highlight round the list, Enter writes the skill into the message as `/name` and a space, drawn as a chip, and the message sends as those words", async () => {
  const box = mount();
  await box.type("Please /");
  assert.equal(await box.key({ key: "ArrowDown" }), false);
  assert.equal(box.highlighted(), "/testing");
  await box.key({ key: "ArrowUp" });
  await box.key({ key: "ArrowUp" });
  assert.equal(
    box.highlighted(),
    "/drizzle",
    "the highlight goes round from the first row to the last",
  );

  assert.equal(await box.key({ key: "Enter" }), false);
  assert.equal(box.field().value, "Please /drizzle ");
  assert.equal(box.field().selectionStart, "Please /drizzle ".length);
  assert.equal(box.rows(), undefined);
  assert.deepEqual(box.sent, [], "the Enter that chose the skill sent nothing");
  assert.deepEqual(box.chips(), ["/drizzle"]);

  await box.type("Please /drizzle add the invites table");
  await box.key({ key: "Enter" });
  assert.deepEqual(box.sent, ["Please /drizzle add the invites table"]);
});

test("Tab and a press on a row choose as Enter does, and a word typed part way is written whole", async () => {
  const box = mount();
  await box.type("/rel");
  assert.equal(await box.key({ key: "Tab" }), false);
  assert.equal(box.field().value, "/release-notes ");

  await box.type("/release-notes and /");
  box.click(1);
  await settle();
  assert.equal(box.field().value, "/release-notes and /testing ");
  assert.deepEqual(box.chips(), ["/release-notes", "/testing"]);
});

test("Escape closes the list and leaves the box and its words, until the caret starts another `/` word; with no row to offer, Enter is the box's own", async () => {
  const box = mount();
  await box.type("Try /te");
  assert.equal(await box.key({ key: "Escape" }), false);
  assert.equal(box.rows(), undefined);
  assert.equal(box.field().value, "Try /te");
  assert.equal(
    document.activeElement,
    box.field(),
    "the Escape that closed the list left the caret in the box",
  );
  await box.type("Try /tes");
  assert.equal(box.rows(), undefined, "the word closed stays closed as it is typed on");
  await box.type("Try /tes and /");
  assert.notEqual(box.rows(), undefined);
  // The caret left the word closed, so coming back to a `/` there opens the list again.
  await box.type("Try");
  await box.type("Try /");
  assert.notEqual(box.rows(), undefined);

  await box.type("Try /zzz");
  assert.deepEqual(box.rows(), []);
  await box.key({ key: "Enter" });
  assert.deepEqual(box.sent, ["Try /zzz"]);
});

test("one Backspace at a chip's end takes the whole `/name` out; a `/word` naming no skill is no chip and loses one letter", async () => {
  const box = mount();
  await box.type("Use /testing");
  await box.key({ key: "Escape" });
  assert.deepEqual(box.chips(), ["/testing"]);
  assert.equal(await box.key({ key: "Backspace" }), false);
  assert.equal(box.field().value, "Use ");
  assert.equal(box.field().selectionStart, "Use ".length);
  assert.deepEqual(box.chips(), []);

  await box.type("Use /nothing");
  assert.deepEqual(box.chips(), []);
  assert.equal(await box.key({ key: "Backspace" }), true);
});

test("a repository keeping no skill says so and where one goes; one whose skills could not be read says why", async () => {
  const none = mount({ skills: [] });
  await none.type("/");
  assert.deepEqual(none.rows(), []);
  assert.equal(none.note(), `${SKILL_MENU_NOTE.NONE}${SKILL_MENU_NOTE.NONE_HINT}`);

  for (const root of roots.splice(0)) act(() => root.unmount());
  const unread = mount({ unread: "Could not read this repository's skills." });
  await unread.type("/");
  assert.equal(unread.note(), "Could not read this repository's skills.");
});

test("skills that could not be read are asked for again as the next `/` word opens the list", async () => {
  const box = mount({ unread: "GitHub could not be read just now." }, SKILLS);
  await box.type("/");
  assert.equal(box.note(), "GitHub could not be read just now.");
  await box.type("/ then /");
  assert.equal(box.rows()?.length, 3);
});

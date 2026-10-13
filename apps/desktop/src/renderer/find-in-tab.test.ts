// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { installHighlights } from "#testing/find-highlights";
import { Fold, FoldBody, FoldSummary } from "./ai-elements/fold";
import { TOOL_BLOCK, TOOL_STATE } from "./ai-elements/tool";
import { useAppKeymap } from "./app-commands";
import { FindScope, type FindSubject } from "./find-in-tab";
import { TranscriptReasoning, TranscriptTool } from "./planning/transcript-blocks";
import { CALL_KIND } from "./planning/turn-rows";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

/** The plan's document, the tab a find opens over unless a test names another. */
const DOCUMENT: FindSubject = { plan: "plan", tab: "plan" };

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

/** A tab's words: one line split over inline spans, as a word over a code line's tokens is, then two lines more. */
function words(): ReactNode {
  return [
    createElement(
      "p",
      { key: "invite" },
      "Invite a ",
      createElement("strong", null, "team"),
      "mate",
    ),
    createElement("p", { key: "accept" }, "Teammates accept"),
    createElement("p", { key: "join" }, "Then the TEAM joins"),
    createElement("button", { key: "press", type: "button" }, "Send"),
  ];
}

/** The tab, in its scope, beside the window's keymap. */
function Tab({
  active,
  subject,
  children,
}: {
  active: boolean;
  subject: FindSubject;
  children: ReactNode;
}): ReactNode {
  useAppKeymap(true);
  return createElement(FindScope, { active, subject }, children);
}

/** A tab drawn in a find scope, drawn again by `draw`. */
function mounted(content: ReactNode = words()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (drawn: ReactNode, options: { active?: boolean; subject?: FindSubject } = {}) => {
    const subject = options.subject ?? DOCUMENT;
    const active = options.active ?? true;
    act(() => root.render(createElement(Tab, { active, subject, children: drawn })));
  };
  draw(content);
  return { container, draw };
}

/** A chord pressed wherever the focus is, answering whether the window claimed it. */
function chord(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const FIND = { key: "f", code: "KeyF", metaKey: true } as const;

function field(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.ok(input, "no find bar stands");
  return input;
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the bar says of the matches. */
function tally(container: HTMLElement): string {
  return container.querySelector(".find-bar-tally")?.textContent ?? "";
}

function key(input: HTMLInputElement, init: KeyboardEventInit): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** Lets the observers and promises settled so far run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

test("⌘F opens the bar over the tab with the caret in its field, seeded with the words selected in the tab, and a second ⌘F selects the field's text", () => {
  installHighlights();
  const tab = mounted();
  const accept = [...tab.container.querySelectorAll("p")].at(1)?.firstChild;
  assert.ok(accept instanceof Text);
  const selected = document.createRange();
  selected.setStart(accept, "Teammates ".length);
  selected.setEnd(accept, accept.data.length);
  document.getSelection()?.addRange(selected);

  assert.equal(chord(FIND), true, "the window claims ⌘F for the tab");
  const input = field(tab.container);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "accept");
  assert.equal(tally(tab.container), "1 of 1");

  document.getSelection()?.removeAllRanges();
  input.setSelectionRange(2, 2);
  chord(FIND);
  assert.equal(document.activeElement, input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, "accept".length]);
});

test("typing counts the matches without regard to case, across a line's inline spans but never from one line into the next, tinting each and the first more strongly", () => {
  const painted = installHighlights();
  const tab = mounted();
  chord(FIND);
  const input = field(tab.container);

  typeInto(input, "team");
  assert.equal(tally(tab.container), "1 of 3");
  assert.deepEqual(painted.matches(), ["team", "Team", "TEAM"]);
  assert.equal(painted.current(), "team");

  typeInto(input, "teammate");
  assert.equal(tally(tab.container), "1 of 2", "a word split over a line's spans is one match");
  assert.deepEqual(painted.matches(), ["teammate", "Teammate"]);

  typeInto(input, "mateteam");
  assert.equal(tally(tab.container), "No results", "two lines never run into one");
  assert.deepEqual(painted.matches(), []);

  typeInto(input, "");
  assert.equal(tally(tab.container), "");
  assert.ok(!tab.container.querySelector(".find-bar")?.textContent?.includes("team"));
});

test("Return steps to the next match and wraps from the last to the first, ⇧Return steps back, and ⌘G and ⇧⌘G step from anywhere in the tab", () => {
  const painted = installHighlights();
  const tab = mounted();
  chord(FIND);
  const input = field(tab.container);
  typeInto(input, "team");

  key(input, { key: "Enter" });
  assert.equal(tally(tab.container), "2 of 3");
  assert.equal(painted.current(), "Team");
  key(input, { key: "Enter" });
  key(input, { key: "Enter" });
  assert.equal(tally(tab.container), "1 of 3", "past the last match is the first");
  key(input, { key: "Enter", shiftKey: true });
  assert.equal(tally(tab.container), "3 of 3", "before the first match is the last");
  assert.equal(painted.current(), "TEAM");

  const send = tab.container.querySelector<HTMLButtonElement>("p ~ button");
  act(() => send?.focus());
  assert.equal(chord({ key: "g", code: "KeyG", metaKey: true }), true);
  assert.equal(tally(tab.container), "1 of 3");
  assert.equal(chord({ key: "G", code: "KeyG", metaKey: true, shiftKey: true }), true);
  assert.equal(tally(tab.container), "3 of 3");

  act(() =>
    tab.container.querySelector<HTMLButtonElement>('[aria-label="Previous match"]')?.click(),
  );
  assert.equal(tally(tab.container), "2 of 3");
  act(() => tab.container.querySelector<HTMLButtonElement>('[aria-label="Next match"]')?.click());
  assert.equal(tally(tab.container), "3 of 3");
});

test("Escape closes the bar, takes its tints down, and hands the focus back to where it was; ⌘F opens it again on the last query", () => {
  const painted = installHighlights();
  const tab = mounted();
  const send = tab.container.querySelector<HTMLButtonElement>("p ~ button");
  assert.ok(send);
  act(() => send.focus());
  chord(FIND);
  typeInto(field(tab.container), "team");
  assert.equal(painted.matches().length, 3);

  let escapedToWindow = false;
  window.addEventListener("keydown", () => {
    escapedToWindow = true;
  });
  key(field(tab.container), { key: "Escape" });
  assert.equal(tab.container.querySelector(".find-bar"), null);
  assert.equal(document.activeElement, send);
  assert.deepEqual(painted.matches(), []);
  assert.equal(painted.current(), undefined);
  assert.equal(escapedToWindow, false, "the window's own Escape does not turn the page as well");

  chord(FIND);
  assert.equal(field(tab.container).value, "team");
  assert.equal(tally(tab.container), "1 of 3");
});

test("a match folded away in a closed fold is found, and showing it opens the fold, which keeps the rest of the tab's folds closed", () => {
  const painted = installHighlights();
  const fold = (summary: string, body: string) =>
    createElement(
      Fold,
      { key: summary },
      createElement(FoldSummary, null, summary),
      createElement(FoldBody, null, createElement("pre", null, body)),
    );
  const tab = mounted([
    fold("Ran 2 commands", "pnpm test --filter relay"),
    fold("Read 1 file", "README.md"),
  ]);
  const [ran, read] = [...tab.container.querySelectorAll("details")];
  assert.ok(ran && read);
  assert.equal(tab.container.querySelector("pre"), null, "a closed fold draws nothing it holds");

  chord(FIND);
  typeInto(field(tab.container), "--filter");

  assert.equal(tally(tab.container), "1 of 1");
  assert.equal(painted.current(), "--filter");
  assert.equal(ran.open, true, "the fold holding the match is opened");
  assert.equal(read.open, false);

  key(field(tab.container), { key: "Escape" });
  assert.equal(ran.open, true, "a fold the find opened stays open");
  assert.equal(read.querySelector("pre"), null, "the closed fold draws nothing again");
});

test("a closed thought's or command's words, described or not, are found once, in the body the line previews, and showing them opens its fold", () => {
  installHighlights();
  const tab = mounted([
    createElement(TranscriptReasoning, { key: "thought", text: "List the sources first." }),
    createElement(TranscriptTool, {
      key: "command",
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      kind: CALL_KIND.COMMAND,
      subject: "ls src",
      input: { kind: TOOL_BLOCK.COMMAND, text: "ls src" },
      output: { kind: TOOL_BLOCK.TEXT, text: "invite.ts" },
      errorText: undefined,
    }),
    createElement(TranscriptTool, {
      key: "described",
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      kind: CALL_KIND.COMMAND,
      subject: "pnpm test",
      description: "Run the tests",
      input: { kind: TOOL_BLOCK.COMMAND, text: "pnpm test" },
      output: { kind: TOOL_BLOCK.TEXT, text: "passed" },
      errorText: undefined,
    }),
  ]);
  const [thought, command, described] = [...tab.container.querySelectorAll("details")];
  assert.ok(thought && command && described);

  chord(FIND);
  typeInto(field(tab.container), "sources");
  assert.equal(tally(tab.container), "1 of 1");
  assert.equal(thought.open, true);
  assert.ok(thought.querySelector("summary + div")?.textContent?.includes("sources"));

  typeInto(field(tab.container), "ls src");
  assert.equal(tally(tab.container), "1 of 1");
  assert.equal(command.open, true);

  typeInto(field(tab.container), "pnpm test");
  assert.equal(tally(tab.container), "1 of 1");
  assert.equal(described.open, true);
});

test("text arriving in the tab while the bar is open is found without moving the match the find is at", async () => {
  const painted = installHighlights();
  const lines = (said: readonly string[]) =>
    said.map((line) => createElement("p", { key: line }, line));
  const tab = mounted(lines(["a team", "a Team"]));
  chord(FIND);
  typeInto(field(tab.container), "team");
  key(field(tab.container), { key: "Enter" });
  assert.equal(painted.current(), "Team");

  tab.draw(lines(["the TEAM", "a team", "a Team", "a tEam"]));
  await settle();

  assert.equal(tally(tab.container), "3 of 4");
  assert.equal(painted.current(), "Team");
  assert.deepEqual(painted.matches(), ["TEAM", "team", "Team", "tEam"]);
});

test("a tab whose column does not hold the window's keys leaves ⌘F to whatever else answers it", () => {
  installHighlights();
  const tab = mounted();
  tab.draw(words(), { active: false });
  assert.equal(chord(FIND), false);
  assert.equal(tab.container.querySelector(".find-bar"), null);
});

test("choosing another tab closes the bar, which coming back to the first does not open again; a file named as a fixed tab is another tab, and so is a tab of another plan", () => {
  const painted = installHighlights();
  const tab = mounted();
  chord(FIND);
  typeInto(field(tab.container), "team");

  tab.draw(words(), { subject: { plan: "plan", tab: { agent: "agent-1" } } });
  assert.equal(tab.container.querySelector(".find-bar"), null);
  assert.deepEqual(painted.matches(), []);
  tab.draw(words());
  assert.equal(tab.container.querySelector(".find-bar"), null, "the bar stays closed on return");

  tab.draw(words(), { subject: { plan: "plan", tab: "code" } });
  chord(FIND);
  tab.draw(words(), { subject: { plan: "plan", tab: { file: "code" } } });
  assert.equal(tab.container.querySelector(".find-bar"), null);

  chord(FIND);
  tab.draw(words(), { subject: { plan: "another plan", tab: { file: "code" } } });
  assert.equal(tab.container.querySelector(".find-bar"), null);
});

test("⌘F starts at the first match not scrolled above the view of the tab's scroller, wherever the tab's own top stands", () => {
  const painted = installHighlights();
  const lines = ["the team", "a Team", "one TEAM"].map((line) =>
    createElement("p", { key: line }, line),
  );
  const tab = mounted(
    createElement("div", { className: "scroller", style: { overflowY: "auto" } }, lines),
  );
  const scroller = tab.container.querySelector<HTMLElement>(".scroller");
  assert.ok(scroller);
  // The scroller shows its last line alone: the two above it are scrolled
  // past its top, though they are still below the tab's.
  Object.defineProperties(scroller, {
    scrollHeight: { value: 300 },
    clientHeight: { value: 100 },
  });
  scroller.getBoundingClientRect = () => DOMRect.fromRect({ y: 200, height: 100 });
  const drawn: Element[] = [...scroller.querySelectorAll("p")];
  const bottoms = [120, 160, 260];
  Range.prototype.getBoundingClientRect = function (this: Range) {
    const at = drawn.findIndex((line) => line === this.startContainer.parentElement);
    return DOMRect.fromRect({ y: bottoms[at] ?? 0, height: 0 });
  };

  chord(FIND);
  typeInto(field(tab.container), "team");

  assert.equal(tally(tab.container), "3 of 3");
  assert.equal(painted.current(), "TEAM");
});

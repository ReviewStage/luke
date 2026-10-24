// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { pageFindAnswerSchema } from "@luke/features/page-find";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageLine } from "@luke/features/page-wire";
import { type CodeLines, TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { restOn } from "../testing/hint-rest.js";
import { onPhone } from "../testing/phone-tab.js";
import { wholeFileDrawn, wholeFileLines, wholeFileRoot } from "../testing/whole-file.js";
import { PagePane, type ReadPageSource } from "./page-pane.js";

/**
 * A page's tab as the developer meets it: the page drawn in a frame that
 * runs its scripts and nothing else, out of the screen recording, at its
 * newest version until they step back through the earlier ones, or its
 * HTML drawn as a File tab draws a file. Synthetic tasks and pages
 * throughout; main's read of a version's source is a door answering each
 * version's HTML as coloured lines.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const FUNNEL: PageLine = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 3,
  at: 1_800_000_000_000,
};

const roots: Root[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** One version's HTML as main colours it: its tag in a colour of its own, its words plain. */
function sourceOf(version: number): CodeLines {
  return [
    [{ text: "<h1>", color: "#7ee787", lightColor: "#116329" }, { text: `Funnel v${version}` }],
    [{ text: "<p>Invites sent</p>" }],
  ];
}

const readSource: ReadPageSource = (version) => Promise.resolve({ lines: sourceOf(version) });

/** Mounts the pane over the page as the task lists it, answering what it draws and a way to list it again. */
function mount(page: PageLine, read: ReadPageSource = readSource, findActive = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (listed: PageLine) =>
    act(() =>
      root.render(
        createElement(PagePane, {
          place: { taskId: TASK },
          page: listed,
          readSource: read,
          findActive,
        }),
      ),
    );
  render(page);
  const frame = () => {
    const found = container.querySelector("iframe");
    assert.ok(found);
    return found;
  };
  const press = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button);
    await act(async () => button.click());
  };
  // The source's lines as drawn, each its number then its text, once Pierre has drawn them.
  const sourceLines = async () => {
    await wholeFileDrawn(container);
    return wholeFileLines(container);
  };
  return { container, frame, press, render, sourceLines };
}

const versionUrl = (version: number) => pageFrameUrl({ taskId: TASK, pageId: FUNNEL.id, version });

beforeEach(() => {
  fakeAppPlatform({ pageFrameUrl });
  // View settings opens its syntax theme on the window's appearance, here the dark one.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark") }));
});

test("a page is drawn at its newest version in a frame that runs its own scripts alone, left out of the recording", () => {
  const { container, frame } = mount(FUNNEL);

  assert.equal(frame().getAttribute("src"), versionUrl(3));
  assert.equal(frame().getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame().getAttribute("allow"), "");
  assert.ok(frame().closest(".ph-no-capture"));
  assert.match(container.textContent ?? "", /Invite funnel.*Version 3 of 3/);
});

test("View source draws the version's HTML as a File tab's numbered, coloured lines in the frame's place, and View page draws the frame again", async () => {
  const { container, press, frame, sourceLines } = mount(FUNNEL);

  await press("View source");

  assert.equal(container.querySelector("iframe"), null);
  assert.deepEqual(await sourceLines(), ["1 <h1>Funnel v3", "2 <p>Invites sent</p>"]);
  const tag = wholeFileRoot(container)?.querySelector<HTMLElement>('[data-line="1"] span');
  assert.equal(tag?.textContent, "<");
  assert.match(tag?.getAttribute("style") ?? "", /--diffs-token/);
  assert.ok(container.querySelector(".whole-file")?.closest(".ph-no-capture"));

  await press("View page");

  assert.deepEqual(wholeFileLines(container), []);
  assert.equal(frame().getAttribute("src"), versionUrl(3));
});

test("the page's Reload hangs a hint in the words it is named by", () => {
  const { container } = mount(FUNNEL);
  const reload = container.querySelector('button[aria-label="Reload page"]') ?? assert.fail();

  restOn(reload);

  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, "Reload page");
});

test("over the source, View settings offers the settings its lines follow, and the ⋯ its actions alone", async () => {
  const { container, press } = mount(FUNNEL);
  assert.equal(container.querySelector('button[aria-label="View options"]'), null);

  await press("View source");
  await press("View options");
  const popover = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();
  assert.deepEqual(
    [...popover.querySelectorAll('[role="switch"], [role="radiogroup"], [aria-haspopup]')].map(
      // A pop-up's name ends with the value it names, which is not the row's.
      (control) => control.getAttribute("aria-label")?.split(": ")[0],
    ),
    [
      "Word wrap",
      "Line numbers",
      "Syntax theme",
      "For dark mode",
      "Font",
      "Font size",
      "Line height",
      "Ligatures",
    ],
  );
  await press("View options");

  await press("Source actions");
  assert.deepEqual(
    [...document.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent),
    ["Copy source"],
  );
});

test("the source stays shown while the versions are stepped, each version's own", async () => {
  const { press, sourceLines, container } = mount(FUNNEL);

  await press("View source");
  await press("Earlier version");

  assert.equal(container.querySelector("iframe"), null);
  assert.deepEqual(await sourceLines(), ["1 <h1>Funnel v2", "2 <p>Invites sent</p>"]);
  assert.match(container.textContent ?? "", /Version 2 of 3/);

  await press("View page");
  await press("Later version");

  assert.equal(container.querySelector(".whole-file"), null);
  assert.ok(container.querySelector(`iframe[src="${versionUrl(3)}"]`));
});

test("a source the service did not answer says so in its place, and Retry reads it again", async () => {
  let answered = false;
  const { press, sourceLines, container } = mount(FUNNEL, (version) =>
    Promise.resolve(
      answered ? { lines: sourceOf(version) } : { failure: TASK_CALL_FAILURE.UNANSWERED },
    ),
  );

  await press("View source");

  assert.match(
    container.querySelector("[role='alert']")?.textContent ?? "",
    /source could not be read/,
  );

  answered = true;
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  assert.ok(retry);
  await act(async () => retry.click());

  assert.deepEqual(await sourceLines(), ["1 <h1>Funnel v3", "2 <p>Invites sent</p>"]);
});

/** Types into the find bar's field as the keyboard does, which React hears as an input. */
function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the find bar's tally says. */
function findTally(): string | null | undefined {
  return document.querySelector('[role="search"][aria-label="Find"] .luke-search-field-tally')
    ?.textContent;
}

/** What the panel asks of a frame's find, each ask in the order it was posted. */
function framePosts(frame: HTMLIFrameElement): unknown[] {
  const posted: unknown[] = [];
  const window = frame.contentWindow ?? assert.fail("the frame has no window");
  vi.spyOn(window, "postMessage").mockImplementation((message) => {
    posted.push(message);
  });
  return posted;
}

/** A message posted to the panel's window from `from`, as a frame's page posts one. */
function postFrom(from: Window | null, data: typeof pageFindAnswerSchema.Type): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: from }));
  });
}

test("⌘F over the page asks its frame to find, and the bar tallies what that frame alone answers", () => {
  const { frame } = mount(FUNNEL);
  const posted = framePosts(frame());

  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("invites");
  postFrom(null, { type: "luke-page-find", tally: { count: 9, at: 0 } });
  const tallyBefore = findTally();
  postFrom(frame().contentWindow, { type: "luke-page-find", tally: { count: 3, at: 0 } });
  act(() => {
    runAppCommand(APP_COMMAND.FIND_NEXT);
  });

  assert.equal(offered, true);
  assert.deepEqual(posted, [
    { type: "luke-page-find", act: "search", query: "invites" },
    { type: "luke-page-find", act: "step", query: "invites", by: 1 },
  ]);
  assert.equal(tallyBefore, "No results");
  assert.equal(findTally(), "1 of 3");
});

test("⌘F over the page is seeded with the words selected in its frame", () => {
  const { frame } = mount(FUNNEL);

  postFrom(frame().contentWindow, { type: "luke-page-find", selection: "funnel" });
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });

  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.equal(field?.value, "funnel");
});

test("a frame that loads again, as a Reload or another version does, is asked again for the query standing", () => {
  const { frame } = mount(FUNNEL);
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("invites");
  const posted = framePosts(frame());

  act(() => {
    frame().dispatchEvent(new Event("load"));
  });

  assert.deepEqual(posted, [{ type: "luke-page-find", act: "search", query: "invites" }]);
});

test("⌘F and ⌘G pressed in the page, which the window's keys never hear, open the find over it and step, whichever column held the keys", () => {
  const { frame } = mount(FUNNEL, readSource, false);
  const posted = framePosts(frame());

  postFrom(frame().contentWindow, { type: "luke-page-find", selection: "funnel" });
  postFrom(frame().contentWindow, { type: "luke-page-find", key: "find" });
  postFrom(frame().contentWindow, { type: "luke-page-find", key: "next" });

  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.equal(field?.value, "funnel");
  assert.deepEqual(posted, [
    { type: "luke-page-find", act: "search", query: "funnel" },
    { type: "luke-page-find", act: "step", query: "funnel", by: 1 },
  ]);
});

test("a click into the page, which stirs only the window's blur, is told as a focus in the tab, which hands its column the keys", () => {
  const { container, frame } = mount(FUNNEL);
  // Note that jsdom tells a focus moved into a frame itself, which Chromium's click does not.
  act(() => frame().focus());
  const heard: EventTarget[] = [];
  container.addEventListener("focusin", (event) => {
    if (event.target !== null) heard.push(event.target);
  });

  act(() => {
    window.dispatchEvent(new FocusEvent("blur"));
  });

  assert.deepEqual(heard, [frame()]);
});

test("⌘F over the source finds in its lines, the window's own, rather than through the frame", async () => {
  const { press, container } = mount(FUNNEL);

  await press("View source");
  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });

  assert.equal(offered, true);
  assert.equal(container.querySelector("iframe"), null);
  assert.ok(container.querySelector("[role='search'][aria-label='Find']"));
});

test("a source read before a Reload that answers after it does not replace the fresh read", async () => {
  const answers: ((html: string) => void)[] = [];
  const { press, sourceLines } = mount(FUNNEL, () => {
    const answer = new Promise<string>((resolve) => answers.push(resolve));
    return answer.then((html) => ({ lines: [[{ text: html }]] }));
  });

  await press("View source");
  await press("Reload page");
  await act(async () => answers[1]?.("<h1>Fresh</h1>"));
  await act(async () => answers[0]?.("<h1>Stale</h1>"));

  assert.deepEqual(await sourceLines(), ["1 <h1>Fresh</h1>"]);
});

test("on a phone the page draws no bar, and the task's header's ⋯ offers every control of it, the version said under its steps", async () => {
  const { element, handed } = onPhone(
    createElement(PagePane, {
      place: { taskId: TASK },
      page: FUNNEL,
      readSource,
      findActive: true,
    }),
  );
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));

  assert.equal(container.querySelector(".file-view-bar"), null);
  assert.equal(container.querySelectorAll("button").length, 0, "nothing over the page presses");
  assert.deepEqual(handed.labels(), [
    "Earlier version",
    "Later version",
    "View source",
    "Reload page",
  ]);
  assert.deepEqual(handed.item("Later version"), { disabled: true, detail: "Version 3 of 3" });

  handed.press("Earlier version");
  assert.equal(container.querySelector("iframe")?.getAttribute("src"), versionUrl(2));

  handed.press("View source");
  await act(async () => undefined);
  assert.deepEqual(handed.labels(), [
    "Earlier version",
    "Later version",
    "View page",
    "Reload page",
    "View options",
    "Copy source",
  ]);
  handed.press("View options");
  const sheet = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();
  assert.match(sheet.textContent ?? "", /View options.*Word wrap/);
});

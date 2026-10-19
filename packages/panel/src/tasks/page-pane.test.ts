// @vitest-environment jsdom

import assert from "node:assert/strict";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageLine } from "@luke/features/page-wire";
import { type CodeLines, TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
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
function mount(page: PageLine, read: ReadPageSource = readSource) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (listed: PageLine) =>
    act(() =>
      root.render(
        createElement(PagePane, { taskId: TASK, page: listed, readSource: read, findActive: true }),
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
  // The source's lines as drawn, each its number then its text.
  const sourceLines = () =>
    [...container.querySelectorAll(".code-lines .code-line")].map(
      (line) =>
        `${line.querySelector(".code-line-number")?.textContent} ${line.querySelector(".code-line-text")?.textContent}`,
    );
  return { container, frame, press, render, sourceLines };
}

const versionUrl = (version: number) => pageFrameUrl({ taskId: TASK, pageId: FUNNEL.id, version });

beforeEach(() => fakeAppPlatform({ pageFrameUrl }));

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
  assert.deepEqual(sourceLines(), ["1 <h1>Funnel v3", "2 <p>Invites sent</p>"]);
  const tag = container.querySelector<HTMLElement>(".code-line-text span");
  assert.equal(tag?.textContent, "<h1>");
  assert.notEqual(tag?.getAttribute("style") ?? "", "");
  assert.ok(container.querySelector(".code-lines")?.closest(".ph-no-capture"));

  await press("View page");

  assert.deepEqual(sourceLines(), []);
  assert.equal(frame().getAttribute("src"), versionUrl(3));
});

test("over the source, View settings offers only the two settings its lines follow, and the ⋯ its actions alone", async () => {
  const { container, press } = mount(FUNNEL);
  assert.equal(container.querySelector('button[aria-label="View settings"]'), null);

  await press("View source");
  await press("View settings");
  const popover = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();
  assert.deepEqual(
    [...popover.querySelectorAll('[role="switch"], [role="radiogroup"], [aria-haspopup]')].map(
      (control) => control.getAttribute("aria-label"),
    ),
    ["Word wrap", "Line numbers"],
  );
  await press("View settings");

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
  assert.deepEqual(sourceLines(), ["1 <h1>Funnel v2", "2 <p>Invites sent</p>"]);
  assert.match(container.textContent ?? "", /Version 2 of 3/);

  await press("View page");
  await press("Later version");

  assert.equal(container.querySelector(".code-lines"), null);
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

  assert.deepEqual(sourceLines(), ["1 <h1>Funnel v3", "2 <p>Invites sent</p>"]);
});

test("⌘F finds in the source, and in the page itself it answers nothing", async () => {
  const { press, container } = mount(FUNNEL);

  const offeredOverPage = runAppCommand(APP_COMMAND.FIND);
  await press("View source");
  let offeredOverSource = false;
  act(() => {
    offeredOverSource = runAppCommand(APP_COMMAND.FIND);
  });

  assert.equal(offeredOverPage, false);
  assert.equal(offeredOverSource, true);
  assert.ok(container.querySelector("search[aria-label='Find']"));
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

  assert.deepEqual(sourceLines(), ["1 <h1>Fresh</h1>"]);
});

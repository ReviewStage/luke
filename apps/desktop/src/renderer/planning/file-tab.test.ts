// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_FILE_REFUSAL, type PlanFileRequest } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, type PlanningFileAnswer } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { FileTab } from "./file-tab";
import type { OpenFile } from "./use-side-panel";

/** A synthetic file of `lineCount` lines, each saying its own number. */
function numberedFile(lineCount: number) {
  return (window: PlanFileRequest): PlanningFileAnswer => {
    const last = Math.min(window.lastLine, lineCount);
    return {
      file: {
        path: window.path,
        repository: "acme/relay",
        firstLine: window.firstLine,
        lineCount,
        lines: Array.from({ length: Math.max(0, last - window.firstLine + 1) }, (_, at) => [
          { text: `line ${window.firstLine + at}` },
        ]),
      },
    };
  };
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** The rows the tab's observers watch, and a scroll that brings every one into view. */
function watchedRows() {
  const watching = new Set<{ callback: IntersectionObserverCallback; target?: Element }>();
  class SeenObserver {
    readonly #watch: { callback: IntersectionObserverCallback; target?: Element };
    constructor(callback: IntersectionObserverCallback) {
      this.#watch = { callback };
    }
    observe(target: Element): void {
      this.#watch.target = target;
      watching.add(this.#watch);
    }
    disconnect(): void {
      watching.delete(this.#watch);
    }
  }
  vi.stubGlobal("IntersectionObserver", SeenObserver);
  return {
    scrollIntoView: async () => {
      await act(async () => {
        for (const { callback, target } of [...watching]) {
          // SAFETY: the callback reads `isIntersecting` alone, which is all a scroll here says.
          callback([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as never);
        }
        await Promise.resolve();
      });
    },
  };
}

/** The tab drawn over a service that answers `answer`, every window asked written down. */
function mounted(answer: (window: PlanFileRequest) => PlanningFileAnswer | Promise<never>) {
  const asked: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const readFile = (window: PlanFileRequest) => {
    asked.push(`${window.firstLine}-${window.lastLine}`);
    return Promise.resolve().then(() => answer(window));
  };
  const draw = async (file: OpenFile) => {
    await act(async () => {
      root.render(createElement(FileTab, { file, readFile }));
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  return { container, asked, draw };
}

/** The numbers of the lines drawn, the lit ones marked. */
function drawnLines(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".code-line")].map((line) => {
    const number = line.querySelector(".code-line-number")?.textContent ?? "";
    return line.getAttribute("data-pointed") === "true" ? `${number} lit` : number;
  });
}

test("a file opens on the window holding its lit lines, and the windows above and below are read as their rows scroll into view, joined into one run", async () => {
  const rows = watchedRows();
  const tab = mounted(numberedFile(1_200));

  await tab.draw({ path: "src/invite.ts", range: { startLine: 600, endLine: 601 }, opened: 1 });

  assert.deepEqual(tab.asked, ["501-1000"]);
  const lines = drawnLines(tab.container);
  assert.equal(lines.length, 500);
  assert.deepEqual(lines.slice(98, 102), ["599", "600 lit", "601 lit", "602"]);
  assert.deepEqual(
    [...tab.container.querySelectorAll(".file-tab-edge")].map((row) => row.textContent),
    ["Show lines 1–500", "Show lines 1001–1200"],
  );
  assert.ok(tab.container.querySelector(".file-tab.ph-no-capture"), "left out of the recording");

  await rows.scrollIntoView();

  assert.deepEqual(tab.asked, ["501-1000", "1-500", "1001-1500"]);
  const joined = drawnLines(tab.container);
  assert.equal(joined.length, 1_200);
  assert.equal(joined[0], "1");
  assert.equal(joined.at(-1), "1200");
  assert.equal(tab.container.querySelectorAll(".file-tab-edge").length, 0);
});

test("opening the file again on lines not drawn reads their window and lights them, and on lines drawn reads nothing", async () => {
  watchedRows();
  const tab = mounted(numberedFile(1_200));
  await tab.draw({ path: "src/invite.ts", range: { startLine: 10, endLine: 10 }, opened: 1 });

  await tab.draw({ path: "src/invite.ts", range: { startLine: 20, endLine: 21 }, opened: 2 });
  assert.deepEqual(tab.asked, ["1-500"]);
  assert.deepEqual(drawnLines(tab.container).slice(19, 21), ["20 lit", "21 lit"]);

  await tab.draw({ path: "src/invite.ts", range: { startLine: 1_100, endLine: 1_100 }, opened: 3 });
  assert.deepEqual(tab.asked, ["1-500", "1001-1500"]);
  assert.ok(drawnLines(tab.container).includes("1100 lit"));
});

test("a refusal says why in the file's place, and one that may pass, or a read that did not land, offers to read again", async () => {
  const secret = mounted(() => ({ refusal: PLAN_FILE_REFUSAL.SECRET }));
  await secret.draw({ path: ".env", range: undefined, opened: 1 });
  assert.equal(
    secret.container.querySelector("[role='alert']")?.textContent,
    "This file holds secrets, such as a .env, and is never shown.",
  );

  let answers: PlanningFileAnswer = { failure: PLAN_CALL_FAILURE.UNANSWERED };
  const flaky = mounted(() => answers);
  await flaky.draw({ path: "src/invite.ts", range: { startLine: 2, endLine: 2 }, opened: 1 });
  const alert = flaky.container.querySelectorAll("[role='alert']")[0];
  assert.equal(alert?.querySelector("p")?.textContent, "The file could not be read.");

  answers = numberedFile(3)({ path: "src/invite.ts", firstLine: 1, lastLine: 500 });
  await act(async () => {
    alert?.querySelector("button")?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.deepEqual(flaky.asked, ["1-500", "1-500"]);
  assert.deepEqual(drawnLines(flaky.container), ["1", "2 lit", "3"]);
});

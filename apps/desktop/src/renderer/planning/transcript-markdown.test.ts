// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { CodeLines } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActOutcome,
  COLOURED_CODE_MAX_CHARS,
} from "#shared/messages/acts";
import { installClipboard, onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { TranscriptWords } from "./transcript-blocks";

/**
 * A transcript's fenced code, tables, and inline code, drawn through the
 * words every transcript tab draws a turn with. Main is the one double: it
 * colours a block the way the host's highlighter would, so what is read
 * here is what the window drew of the answer, and the asks it made.
 */

/** Main's colouring of a block: its first word as a keyword in each appearance, the rest in the theme's foreground. */
function coloured(code: string): CodeLines {
  return code.split("\n").map((line) => {
    const [word = "", ...rest] = line.split(" ");
    const tail = rest.length === 0 ? [] : [{ text: ` ${rest.join(" ")}` }];
    return word === "" ? tail : [{ text: word, color: "#ff7b72", lightColor: "#cf222e" }, ...tail];
  });
}

/** Every block main was asked to colour, in order, as its language and code. */
let asked: { language: string; code: string }[] = [];
const roots: Root[] = [];

beforeEach(() => {
  asked = [];
  const answer = (request: Act): Promise<ActOutcome> => {
    if (request.kind !== ACT_KIND.PLANNING_COLOUR_CODE) {
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
    }
    asked.push(request.payload);
    return Promise.resolve({
      status: ACT_OUTCOME_STATUS.DONE,
      value: coloured(request.payload.code),
    });
  };
  Object.defineProperty(window, "sidecar", { configurable: true, value: { act: answer } });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Words drawn into the document, redrawn by each `draw`, under `registry` where one is given. */
function mounted(registry?: Parameters<typeof onRegistry>[0]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (text: string) => {
    const words = createElement(TranscriptWords, { text });
    act(() => root.render(registry === undefined ? words : onRegistry(registry, words)));
  };
  return { container, draw };
}

/** Lets main's answer, and the redraw it causes, land with no time passing. */
async function settled(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

/** Each fenced block as a reader meets it: the language its header names, and its lines' runs with the colours they carry. */
function blocks(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".transcript-code")].map((block) => ({
    language: block.querySelector(".transcript-code-language")?.textContent,
    copy: block.querySelector(".transcript-code-header button")?.getAttribute("aria-label"),
    text: block.querySelector("pre")?.textContent,
    runs: [...block.querySelectorAll<HTMLElement>("pre span")].map((run) => [
      run.textContent,
      run.style.getPropertyValue("--run-dark"),
      run.style.getPropertyValue("--run-light"),
    ]),
  }));
}

test("a fenced block draws a header naming its language with a copy, over its lines in the colours main gave them", async () => {
  const { container, draw } = mounted();

  draw(
    "Two steps:\n\n```ts\nexport const seats = 3;\n\nreturn seats;\n```\n\n```\nplain words\n```",
  );
  await settled();

  assert.deepEqual(blocks(container), [
    {
      language: "ts",
      copy: "Copy code",
      text: "export const seats = 3;\n\nreturn seats;",
      runs: [
        ["export", "#ff7b72", "#cf222e"],
        [" const seats = 3;", "", ""],
        ["return", "#ff7b72", "#cf222e"],
        [" seats;", "", ""],
      ],
    },
    { language: "text", copy: "Copy code", text: "plain words", runs: [] },
  ]);
  assert.deepEqual(asked, [{ language: "ts", code: "export const seats = 3;\n\nreturn seats;" }]);
  assert.equal(
    container.querySelector('[data-streamdown="code-block"], [data-streamdown="table-wrapper"]'),
    null,
    "none of Streamdown's own block chrome is drawn",
  );
});

test("a block still streaming is drawn plain and asked for once, when its closing fence arrives, and once only however often it is drawn", async () => {
  const { container, draw } = mounted();
  const opening = "Here:\n\n```python\nimport os\n";

  draw(opening);
  draw(`${opening}print(os.getcwd())\n`);
  await settled();
  assert.deepEqual(asked, [], "nothing is asked while the block streams");
  assert.equal(blocks(container)[0]?.text, "import os\nprint(os.getcwd())");
  assert.deepEqual(blocks(container)[0]?.runs, []);

  draw(`${opening}print(os.getcwd())\n\`\`\``);
  await settled();
  draw(`${opening}print(os.getcwd())\n\`\`\`\n\nThat prints it.`);
  await settled();

  assert.deepEqual(asked, [{ language: "python", code: "import os\nprint(os.getcwd())" }]);
  assert.deepEqual(blocks(container)[0]?.runs[0], ["import", "#ff7b72", "#cf222e"]);
});

test("a block past the bound is drawn plain and never sent to main", async () => {
  const { container, draw } = mounted();
  const long = `const log = "${"x".repeat(COLOURED_CODE_MAX_CHARS)}";`;

  draw(`\`\`\`ts\n${long}\n\`\`\``);
  await settled();

  assert.deepEqual(asked, []);
  assert.equal(blocks(container)[0]?.text, long);
  assert.deepEqual(blocks(container)[0]?.runs, []);
});

test("a table draws its header and rows in the transcript's own table, its columns aligned as written, with none of Streamdown's buttons", () => {
  const { container, draw } = mounted();

  draw("| Plan | Seats |\n| --- | ---: |\n| Team | 12 |\n| Business | 250 |");

  const table = container.querySelector(".transcript-table > table");
  assert.ok(table, "the table stands in its own scrolling box");
  const rows = [...table.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll<HTMLTableCellElement>("th, td")].map((cell) => [
      cell.tagName,
      cell.textContent,
      cell.style.textAlign,
    ]),
  );
  assert.deepEqual(rows, [
    [
      ["TH", "Plan", ""],
      ["TH", "Seats", "right"],
    ],
    [
      ["TD", "Team", ""],
      ["TD", "12", "right"],
    ],
    [
      ["TD", "Business", ""],
      ["TD", "250", "right"],
    ],
  ]);
  assert.equal(container.querySelector(".transcript-table button"), null);
  assert.equal(container.querySelector("table[class], th[class], td[class]"), null);
});

test("an inline span of code is drawn in the transcript's inline code, not as a block", () => {
  const { container, draw } = mounted();

  draw("Run `pnpm check` first.");

  const spans = [...container.querySelectorAll("code")].map((code) => [
    code.className,
    code.textContent,
  ]);
  assert.deepEqual(spans, [["transcript-inline-code", "pnpm check"]]);
  assert.equal(container.querySelector(".transcript-code"), null);
});

it.effect("a block's copy hands the clipboard its code, the glyph turning to a check", () =>
  Effect.gen(function* () {
    const clipboard = installClipboard();
    const { container, draw } = mounted(yield* registryOnTestClock);
    draw("```sh\npnpm install\npnpm test\n```");
    const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]');
    assert.ok(copy);

    act(() => copy.click());
    yield* Effect.promise(settled);

    assert.deepEqual(clipboard.copied, ["pnpm install\npnpm test"]);
    assert.equal(copy.querySelector(".copy-glyph")?.getAttribute("data-state"), "copied");
  }),
);

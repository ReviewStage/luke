// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, type Mention, type MentionLines } from "@repo/features/mention-link";
import { CALL_KIND, type CallKind } from "@repo/features/turn-rows";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool.js";
import {
  type AnyAct,
  fakeActPort,
  fakeAppBridge,
  type OpenedLink,
  openingLinks,
} from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TranscriptTool, TranscriptWords } from "./transcript-blocks.js";

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/relay";
const COMMIT = "0a1b2c3d";
const ISSUE_URL = "https://linear.app/acme/issue/ACME-142/fix-the-thing";

const WORDS = [
  `Read [the rollout](https://vespin.dev/acme/plan/${TASK_ID}#rollout),`,
  `[the store](https://github.com/${REPOSITORY}/blob/${COMMIT}/apps/web/store.ts#L3-L5),`,
  `${ISSUE_URL}, and [the docs](https://example.com/docs).`,
  "Not `https://linear.app/acme/issue/LUKE-9` nor `[@x](https://linear.app/acme)`.",
].join(" ");

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];
const told: (AnyAct | OpenedLink)[] = [];

beforeEach(() => {
  told.length = 0;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort(openingLinks((link) => told.push(link)));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function taskPage(
  opened: Mention[],
  files: { path: string; lines: MentionLines | undefined }[],
): TaskMentionsValue {
  return {
    holder: { taskId: TASK_ID },
    taskName: "Invitations",
    workspace: "acme",
    repository: REPOSITORY,
    text: () => "## Rollout\n\nStore first.\n",
    doors: {
      holder: { taskId: TASK_ID },
      place: { workspace: "acme", repository: REPOSITORY },
      anchors: new Set(["rollout"]),
      onOpenTask: (mention) => opened.push(mention),
      onOpenFile: (path, lines) => files.push({ path, lines }),
    },
  };
}

function drawn(page: TaskMentionsValue | undefined, text: string = WORDS): HTMLElement {
  return drawnElement(page, createElement(TranscriptWords, { text }));
}

function drawnElement(page: TaskMentionsValue | undefined, words: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        page === undefined ? words : createElement(TaskMentions, { value: page, children: words }),
      ),
    ),
  );
  return container;
}

function chips(container: HTMLElement): [string | undefined, string | null][] {
  return [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")].map((chip) => [
    chip.dataset.kind,
    chip.querySelector(".ui-inline-ref-label")?.textContent ?? null,
  ]);
}

function carriesTarget(container: HTMLElement): boolean {
  const masked = new Set(["title", "href", "xmlns"]);
  return [...container.querySelectorAll("*")]
    .flatMap((element) => [...element.attributes])
    .some((attribute) => !masked.has(attribute.name) && attribute.value.includes("://"));
}

test("on a plan's page a plan's link, a file's lines, and a Linear page are chips, the section called by its heading now, any other link a link, and code is code", () => {
  const opened: Mention[] = [];
  const files: { path: string; lines: MentionLines | undefined }[] = [];
  const container = drawn(taskPage(opened, files));

  assert.deepEqual(chips(container), [
    [MENTION_KIND.SECTION, "Rollout"],
    [MENTION_KIND.FILE, "the store"],
    [MENTION_KIND.LINK, "ACME-142/fix-the-thing"],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll("a:not([data-mention-ref])")].map((link) => link.textContent),
    ["the docs"],
  );
  assert.deepEqual(
    [...container.querySelectorAll("code")].map((code) => code.textContent),
    ["https://linear.app/acme/issue/LUKE-9", "[@x](https://linear.app/acme)"],
  );
  assert.equal(carriesTarget(container), false);

  for (const chip of container.querySelectorAll<HTMLElement>(":is(button, a)[data-mention-ref]")) {
    act(() => chip.click());
  }
  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "rollout" }]);
  assert.deepEqual(files, [
    { path: "apps/web/store.ts", lines: { commit: COMMIT, startLine: 3, endLine: 5 } },
  ]);
  assert.deepEqual(told, [{ kind: ACT_KIND.WEB_OPEN, payload: { url: ISSUE_URL } }]);
});

test("off a plan's page, as in the workspace's Inbox, the same links are chips, a file's page still the file, of the repository its address names, since none is at hand", () => {
  const container = drawn(undefined);

  assert.deepEqual(chips(container), [
    [MENTION_KIND.SECTION, "the rollout"],
    [MENTION_KIND.FILE, "the store"],
    [MENTION_KIND.LINK, "ACME-142/fix-the-thing"],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll("a:not([data-mention-ref])")].map((link) => link.textContent),
    ["the docs"],
  );
  assert.equal(carriesTarget(container), false);
});

test("a reference link is read through its definition, and a file's page far longer than a page's bound is still the file", () => {
  const files: { path: string; lines: MentionLines | undefined }[] = [];
  const longPath = `apps/${"é".repeat(400)}.ts`;
  const longPage = `https://github.com/${REPOSITORY}/blob/HEAD/apps/${"%C3%A9".repeat(400)}.ts`;
  const container = drawn(
    taskPage([], files),
    [
      `See [the store][store] and [the long one](${longPage}).`,
      "",
      `[store]: https://github.com/${REPOSITORY}/blob/HEAD/apps/web/store.ts`,
    ].join("\n"),
  );

  assert.deepEqual(chips(container), [
    [MENTION_KIND.FILE, "the store"],
    [MENTION_KIND.FILE, "the long one"],
  ]);
  for (const chip of container.querySelectorAll<HTMLElement>(":is(button, a)[data-mention-ref]")) {
    act(() => chip.click());
  }
  assert.deepEqual(
    files.map((file) => file.path),
    ["apps/web/store.ts", longPath],
  );
});

function fileCall(kind: CallKind, subject: string, named: { files?: string[]; page?: string }) {
  return createElement(TranscriptTool, {
    kind,
    state: TOOL_STATE.OUTPUT_AVAILABLE,
    subject,
    ...named,
    input: { kind: TOOL_BLOCK.TEXT, text: subject },
    output: { kind: TOOL_BLOCK.TEXT, text: "done" },
    errorText: undefined,
  });
}

test("a call's row names the first file it edited by the file's chip and how many more, the page it fetched by its site's chip, and off a repository its path", () => {
  const page = taskPage([], []);
  const edited = drawnElement(
    page,
    fileCall(CALL_KIND.EDIT, "src/members/list.ts +1", {
      files: ["src/members/list.ts", "src/members/invite.ts"],
    }),
  );
  const fetched = drawnElement(
    page,
    fileCall(CALL_KIND.WEB_PAGE, "www.rfc-editor.org/rfc/rfc9110", {
      page: "https://www.rfc-editor.org/rfc/rfc9110",
    }),
  );
  const elsewhere = drawnElement(
    undefined,
    fileCall(CALL_KIND.READ_FILE, "src/members/list.ts", { files: ["src/members/list.ts"] }),
  );

  assert.deepEqual(chips(edited), [[MENTION_KIND.FILE, "list.ts"]]);
  assert.equal(edited.querySelector("summary")?.textContent, "Edited file list.ts +1");
  assert.equal(fetched.querySelector("[data-site-chip]")?.textContent, "rfc-editor.org");
  assert.deepEqual(chips(elsewhere), []);
  assert.equal(elsewhere.querySelector("summary")?.textContent, "Read src/members/list.ts");
});

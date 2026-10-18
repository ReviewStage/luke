// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, type Mention, type MentionLines } from "@luke/features/mention-link";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { DESKTOP_LINKS, fakeAppPlatform } from "#testing/app-platform";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions";
import { TranscriptWords } from "./transcript-blocks";

/**
 * transcript-link-chips.test.ts -- a link an agent or Luke writes in its
 * words, labelled as it likes or bare, is drawn as the chip of what it
 * names wherever a transcript's words are drawn: an agent's reply, a
 * subagent's, the Call tab, and an Inbox item's Markdown, which all draw
 * through `TranscriptWords`. A link that names nothing stays a link, and
 * code stays code. Synthetic task and repository.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/relay";
const COMMIT = "0a1b2c3d";
const ISSUE_URL = "https://linear.app/acme/issue/LUKE-142/fix-the-thing";

const WORDS = [
  `Read [the rollout](https://tryluke.dev/acme/plan/${TASK_ID}#rollout),`,
  `[the store](https://github.com/${REPOSITORY}/blob/${COMMIT}/apps/web/store.ts#L3-L5),`,
  `${ISSUE_URL}, and [the docs](https://example.com/docs).`,
  "Not `https://linear.app/acme/issue/LUKE-9` nor `[@x](https://linear.app/acme)`.",
].join(" ");

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];
const told: Act[] = [];

beforeEach(() => {
  told.length = 0;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      told.push(request);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** What a task's page hands its places, each task and file a chip opened kept. */
function taskPage(
  opened: Mention[],
  files: { path: string; lines: MentionLines | undefined }[],
): TaskMentionsValue {
  return {
    taskId: TASK_ID,
    taskName: "Invitations",
    workspace: "acme",
    repository: REPOSITORY,
    text: () => "## Rollout\n\nStore first.\n",
    doors: {
      taskId: TASK_ID,
      place: { workspace: "acme", repository: REPOSITORY },
      anchors: new Set(["rollout"]),
      onOpenTask: (mention) => opened.push(mention),
      onOpenFile: (path, lines) => files.push({ path, lines }),
    },
  };
}

/** The words drawn as a transcript draws them, on the task's page given or off any. */
function drawn(page: TaskMentionsValue | undefined, text: string = WORDS): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const words = createElement(TranscriptWords, { text });
  act(() =>
    root.render(
      page === undefined ? words : createElement(TaskMentions, { value: page, children: words }),
    ),
  );
  return container;
}

/** Each chip drawn: its kind and the name it says. */
function chips(container: HTMLElement): [string | undefined, string | null][] {
  return [...container.querySelectorAll<HTMLElement>(".mention-chip")].map((chip) => [
    chip.dataset.kind,
    chip.querySelector(".mention-chip-label")?.textContent ?? null,
  ]);
}

/** Whether any element drawn carries an address on an attribute the recording keeps, other than a link's own. */
function carriesTarget(container: HTMLElement): boolean {
  const masked = new Set(["title", "href", "xmlns"]);
  return [...container.querySelectorAll("*")]
    .flatMap((element) => [...element.attributes])
    .some((attribute) => !masked.has(attribute.name) && attribute.value.includes("://"));
}

test("on a plan's page a plan's link, a file's lines, and a Linear page are chips, any other link a link, and code is code", () => {
  const opened: Mention[] = [];
  const files: { path: string; lines: MentionLines | undefined }[] = [];
  const container = drawn(taskPage(opened, files));

  assert.deepEqual(chips(container), [
    [MENTION_KIND.SECTION, "the rollout"],
    [MENTION_KIND.FILE, "the store"],
    [MENTION_KIND.LINK, "LUKE-142/fix-the-thing"],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll("a")].map((link) => link.textContent),
    ["the docs"],
  );
  assert.deepEqual(
    [...container.querySelectorAll("code")].map((code) => code.textContent),
    ["https://linear.app/acme/issue/LUKE-9", "[@x](https://linear.app/acme)"],
  );
  assert.equal(carriesTarget(container), false);

  for (const chip of container.querySelectorAll<HTMLButtonElement>("button.mention-chip")) {
    act(() => chip.click());
  }
  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "rollout" }]);
  assert.deepEqual(files, [
    { path: "apps/web/store.ts", lines: { commit: COMMIT, startLine: 3, endLine: 5 } },
  ]);
  assert.deepEqual(told, [{ kind: ACT_KIND.WEB_OPEN, payload: { url: ISSUE_URL } }]);
});

test("off a plan's page, as in the workspace's Inbox, the same links are chips, a file's page GitHub's, since no repository is at hand", () => {
  const container = drawn(undefined);

  assert.deepEqual(chips(container), [
    [MENTION_KIND.SECTION, "the rollout"],
    [MENTION_KIND.LINK, "the store"],
    [MENTION_KIND.LINK, "LUKE-142/fix-the-thing"],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll("a")].map((link) => link.textContent),
    ["the docs"],
  );
  assert.equal(carriesTarget(container), false);
});

test("a reference link is read through its definition, and a file's page far longer than a page's bound is still the file", () => {
  const files: { path: string; lines: MentionLines | undefined }[] = [];
  // Each letter spelled in six characters, so the address passes a page's bound while its path stays inside a path's.
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
  for (const chip of container.querySelectorAll<HTMLButtonElement>("button.mention-chip")) {
    act(() => chip.click());
  }
  assert.deepEqual(
    files.map((file) => file.path),
    ["apps/web/store.ts", longPath],
  );
});

import assert from "node:assert/strict";
import { CODING_AGENT_BRIEF } from "@luke/features/coding-agent-wire";
import { LINK_PLACE, readLink } from "@luke/features/link-grammar";
import { decodeMention, isMentionLabel, MENTION_KIND } from "@luke/features/mention-link";
import { test } from "vitest";
import { INBOX_TOOLS } from "./coder-host/inbox.js";
import { coderInstructions } from "./coder-host/instructions.js";
import { EDIT_PLAN_TOOL } from "./coder-host/plan-edit.js";

/**
 * link-examples.test.ts -- the link every author is shown how to write a
 * file, a pull request, or an issue with is one Luke draws as a chip: the
 * coding agent's instructions, which show every kind it names as a mention,
 * and its inbox and plan tools; the coding agent's last example is another
 * agent's. An example spelled with `<owner>/<name>` and `<path>` is
 * read as an author fills it in. Synthetic repository.
 */

const REPOSITORY = "Acme/Relay";

/** What an author fills an example's placeholders in with. */
const FILLED: ReadonlyMap<string, string> = new Map([
  ["<owner>/<name>", REPOSITORY],
  ["<path>", "apps/web/store.ts"],
  ["<commit>", "3f9c2e1d5b7a4c6e8f0a2b4c6d8e0f1a3b5c7d9e"],
  ["<page-id>", "page-1"],
  ["<task-id>", "pl_2"],
  ["<agent-id>", "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f"],
  ["<issue-id>", "3f0e6f5c-7d1a-4f6e-9a55-000000000042"],
  ["<item-id>", "9b2e4c6a-1d3f-4e5a-8b7c-0d1e2f3a4b5c"],
]);

/** The task the coding agent works on, whose link its instructions are handed. */
const TASK_ADDRESS = "https://tryluke.dev/acme/plan/pl_1";

/** Every Markdown link to a web page the words show, its label and its target, the placeholders filled in as an author would. */
function linksIn(words: string): { label: string; target: string }[] {
  return [...words.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/gu)].map(([, label, target]) => ({
    label: label ?? "",
    target: [...FILLED].reduce(
      (filled, [hole, value]) => filled.replace(hole, value),
      target ?? "",
    ),
  }));
}

/** Every Markdown link to a web page the words show, its placeholders filled in as an author would. */
function examplesIn(words: string): string[] {
  return linksIn(words).map(({ target }) => target);
}

/** What each example link is drawn as: the kind of mention its chip names, else the kind of place in Luke it names, or nothing where it stays a link. */
function drawnAs(words: string): (string | undefined)[] {
  return examplesIn(words).map(
    (target) => decodeMention(target, REPOSITORY)?.kind ?? readLink(target)?.place.kind,
  );
}

test("a coding agent is shown to name each kind as a mention Luke draws as its chip, its task's own under its task's link and only where it has a task, and one on no task its own pages under its own link", () => {
  const shared = [MENTION_KIND.FILE, MENTION_KIND.FILE, MENTION_KIND.LINK, MENTION_KIND.LINK];
  const own = [MENTION_KIND.TASK, MENTION_KIND.SECTION, MENTION_KIND.PAGE];
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const onTask of [true, false]) {
      const words = coderInstructions(REPOSITORY, brief, true, onTask ? TASK_ADDRESS : null);
      const told = words.slice(words.indexOf("## What your messages are"));
      assert.deepEqual(
        drawnAs(told),
        [
          ...shared,
          ...(onTask ? own : [MENTION_KIND.PAGE]),
          MENTION_KIND.AGENT,
          LINK_PLACE.INBOX_ITEM,
        ],
        `${brief} ${onTask}`,
      );
      assert.deepEqual(
        linksIn(told).filter(({ label }) => !isMentionLabel(label)),
        [],
        "every example is written as a mention",
      );
    }
  }
});

test("the thread post tool and the plan's edit tool show a file's link Luke draws as its chip, written as a mention", () => {
  for (const description of [INBOX_TOOLS.POST.description, EDIT_PLAN_TOOL.description]) {
    assert.deepEqual(drawnAs(description), [MENTION_KIND.FILE]);
    assert.ok(
      linksIn(description).every(({ label }) => isMentionLabel(label)),
      description,
    );
  }
});

/** Every mention of an app-only thing the words show, as the mention its target names, and whether its label is a mention's. */
function appMentionsIn(words: string): { kind: string | undefined; mention: boolean }[] {
  return [...words.matchAll(/\[([^\]]+)\]\((luke:\/\/mcp\/[^)\s`]+)\)/gu)].map(
    ([, label, target]) => ({
      kind: decodeMention(target ?? "", REPOSITORY)?.kind,
      mention: isMentionLabel(label ?? ""),
    }),
  );
}

test("a coding agent is shown to name an MCP server as a mention Luke draws as its chip, a second account's among them", () => {
  for (const onTask of [true, false]) {
    const words = coderInstructions(
      REPOSITORY,
      CODING_AGENT_BRIEF.PROMPT,
      true,
      onTask ? TASK_ADDRESS : null,
    );
    assert.deepEqual(appMentionsIn(words), [
      { kind: MENTION_KIND.SERVER, mention: true },
      { kind: MENTION_KIND.SERVER, mention: true },
    ]);
  }
});

/** Every date mention the words show, as the mention its target names. */
function datesIn(words: string): (string | undefined)[] {
  return [...words.matchAll(/\]\((luke:\/\/date\/[^)\s`]+)\)/gu)].map(
    ([, target]) => decodeMention(target ?? "", REPOSITORY)?.kind,
  );
}

test("a coding agent is shown a day, a time, and a range, each a date Luke draws as its chip", () => {
  const words = coderInstructions(REPOSITORY, CODING_AGENT_BRIEF.PLAN, true, TASK_ADDRESS);
  assert.deepEqual(datesIn(words), [MENTION_KIND.DATE, MENTION_KIND.DATE, MENTION_KIND.DATE]);
});

import assert from "node:assert/strict";
import { CODING_AGENT_BRIEF } from "@luke/features/coding-agent-wire";
import { decodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { test } from "vitest";
import { BRAIN_INSTRUCTIONS, SCRIBE_INSTRUCTIONS } from "./brain-host/brain.js";
import { INBOX_TOOLS } from "./coder-host/inbox.js";
import { coderInstructions } from "./coder-host/instructions.js";
import { EDIT_PLAN_TOOL } from "./coder-host/plan-edit.js";

/**
 * link-examples.test.ts -- the link every author is shown how to write a
 * file, a pull request, or an issue with is one Luke draws as a chip: the
 * coding agent's instructions, its inbox and plan tools, the planner's, and
 * the notetaker's. An example spelled with `<owner>/<name>` and `<path>` is
 * read as an author fills it in. Synthetic repository.
 */

const REPOSITORY = "Acme/Relay";

/** Every Markdown link to a web page the words show, its placeholders filled in as an author would. */
function examplesIn(words: string): string[] {
  return [...words.matchAll(/\[[^\]]+\]\((https:\/\/[^)\s]+)\)/gu)].map(([, target]) =>
    (target ?? "").replace("<owner>/<name>", REPOSITORY).replace("<path>", "apps/web/store.ts"),
  );
}

/** What each example link is drawn as: the kind of mention its chip names, or nothing where it stays a link. */
function drawnAs(words: string): (string | undefined)[] {
  return examplesIn(words).map((target) => decodeMention(target, REPOSITORY)?.kind);
}

test("a coding agent is shown to write a file of its own repository as a link Luke draws as the file's chip", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const onTask of [true, false]) {
      const words = coderInstructions(REPOSITORY, brief, true, onTask);
      const told = words.slice(words.indexOf("## What your messages are"));
      assert.deepEqual(drawnAs(told), [MENTION_KIND.FILE], brief);
    }
  }
});

test("the inbox's post tool, the plan's edit tool, and the planner show a file's link Luke draws as its chip", () => {
  assert.deepEqual(drawnAs(INBOX_TOOLS.POST.description), [MENTION_KIND.FILE]);
  assert.deepEqual(drawnAs(EDIT_PLAN_TOOL.description), [MENTION_KIND.FILE]);
  assert.deepEqual(drawnAs(BRAIN_INSTRUCTIONS), [MENTION_KIND.FILE]);
});

test("the notetaker shows an issue's link Luke draws as the integration page's chip", () => {
  assert.deepEqual(drawnAs(SCRIBE_INSTRUCTIONS), [MENTION_KIND.LINK]);
});

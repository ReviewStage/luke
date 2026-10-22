// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  MENTION_KIND,
  type MentionPlace,
  mentionMarkdown,
  mentionsIn,
  sectionAnchors,
} from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, test } from "vitest";
import { retargetedMention } from "../tasks/mention-chip.js";
import { installEditorLayout } from "../testing/composer.js";
import type { ComposerTrigger, MentionNode, PlanEditorHandle } from "./contract.js";
import { mountPlanEditor } from "./plan-editor.js";

/**
 * The plan editor's mentions over the real editor: a mention in the text
 * opened as its node, drawn by the panel, and written back as the link it was
 * read from; an `@` word reported and a pick written in its place; no `@` in
 * code or inside a word; and a heading renamed in the edit, or one laid in
 * that a later heading's anchor steps aside for, renaming the text's own
 * mentions of it. Synthetic plan.
 */

const TASK_ID = "pl_1";

const PLACE: MentionPlace = { workspace: "acme", repository: "acme/checkout" };

/** A mention of the section an anchor names, written with the name given. */
const named = (anchor: string, name: string) =>
  mentionMarkdown({ kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor }, name, PLACE);

const section = (heading: string) => named(sectionAnchors([heading])[0] ?? "", heading);

const TEXT = `## Goal\n\nShip as ${section("Rollout")} says.\n\n## Rollout\n\nStore first.\n`;

/** A page of an integration's, as the panel names it. */
const ISSUE_URL = "https://linear.app/acme/issue/LUKE-142/fix-the-thing";
const ISSUE = { name: "LUKE-142/fix-the-thing", target: ISSUE_URL };

const editors: PlanEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on the text, with every draft, report, drawn mention, and key the list was offered written down. */
function mounted(markdown: string) {
  const offered: string[] = [];
  const drafts: string[] = [];
  const triggers: (ComposerTrigger | undefined)[] = [];
  const drawn: MentionNode[] = [];
  let finished = 0;
  const host = document.createElement("div");
  document.body.append(host);
  const handle = mountPlanEditor(host, {
    markdown,
    placement: undefined,
    focus: true,
    label: "Plan",
    className: "markdown plan-unit",
    onDraft: (draft) => drafts.push(draft),
    onFinish: () => {
      finished += 1;
    },
    onLeaveUp: () => undefined,
    mentions: {
      onTrigger: (trigger) => triggers.push(trigger),
      onKey: (event) => {
        offered.push(event.key);
        return false;
      },
      drawMention: (element, mention) => {
        element.textContent = `@${mention.name}`;
        drawn.push(mention);
        return () => undefined;
      },
      retarget: (target, change) => retargetedMention(TASK_ID, PLACE, target, change),
      namesMention: () => false,
      // The panel reads the one page of an integration's this plan is pasted.
      pasted: (words) => (words.trim() === ISSUE_URL ? ISSUE : undefined),
    },
  });
  editors.push(handle);
  const element = host.querySelector<TiptapEditorHTMLElement>(".plan-document-text");
  const editor = element?.editor;
  assert.ok(editor, "the editor is running");
  /** The caret put right after the words given, and the words typed there. */
  const typeAfter = (words: string, typed: string) => {
    let at: number | undefined;
    editor.state.doc.descendants((node, position) => {
      if (at === undefined && node.isText && node.text?.includes(words)) {
        at = position + (node.text.indexOf(words) + words.length);
      }
    });
    assert.ok(at !== undefined, `the text holds ${words}`);
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    editor.view.dispatch(editor.state.tr.insertText(typed));
  };
  /** A heading of the words given laid in as its own block, right after the words named. */
  const layHeadingAfter = (words: string, heading: string) => {
    typeAfter(words, "");
    editor.chain().splitBlock().setHeading({ level: 2 }).insertContent(heading).run();
  };
  /** A key pressed in the editor. */
  const press = (init: KeyboardEventInit) =>
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  /** The caret moved back by the characters given. */
  const back = (characters: number) =>
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, editor.state.selection.from - characters),
      ),
    );
  return {
    handle,
    drafts,
    triggers,
    drawn,
    offered,
    typeAfter,
    layHeadingAfter,
    press,
    back,
    last: () => drafts.at(-1) ?? "",
    /** Words pasted where the caret stands, as the system's clipboard hands them over. */
    paste: (words: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files: [],
          types: ["text/plain"],
          getData: (type: string) => (type === "text/plain" ? words : ""),
        },
      });
      editor.view.dom.dispatchEvent(event);
    },
    finished: () => finished,
  };
}

test("a mention in the text opens as its node, drawn by the panel, and writes back as the link it was read from", () => {
  const task = mounted(TEXT);

  task.typeAfter("says.", " Today.");

  assert.deepEqual(task.drawn, [
    { name: "Rollout", target: `https://tryluke.dev/acme/plan/${TASK_ID}#rollout` },
  ]);
  assert.equal(
    task.last(),
    `## Goal\n\nShip as ${section("Rollout")} says. Today.\n\n## Rollout\n\nStore first.\n`,
  );
});

test("an @ word the caret ends is reported with what follows it, and a pick writes the mention and a space in its place", () => {
  const task = mounted(TEXT);

  task.typeAfter("Store first.", " See @go");
  const reported = task.triggers.at(-1);
  task.handle.chooseMention({
    name: "Goal",
    target: `https://tryluke.dev/acme/plan/${TASK_ID}#goal`,
  });

  assert.equal(reported?.query, "go");
  assert.ok(task.last().includes(`Store first. See ${section("Goal")}`), task.last());
});

test("an @ inside a word, or inside code, opens nothing", () => {
  const task = mounted("## Goal\n\nWrite to dean\n\n```\ncode\n```\n");

  task.typeAfter("dean", "@acme");
  task.typeAfter("code", " @a");

  assert.ok(task.triggers.every((trigger) => trigger === undefined));
});

test("renaming a heading in the editor renames the text's own mentions of it, in the same edit", () => {
  const task = mounted(TEXT);

  task.typeAfter("Rollout", " plan");

  assert.equal(
    task.last(),
    `## Goal\n\nShip as ${named("rollout-plan", "Rollout")} says.\n\n## Rollout plan\n\nStore first.\n`,
  );
});

test("renaming a heading renames a mention of it written before the link was settled, into the settled form", () => {
  const task = mounted(
    `## Goal\n\nShip as [@Rollout](luke://plan/${TASK_ID}#Rollout) says.\n\n## Rollout\n\nStore first.\n`,
  );

  task.typeAfter("Rollout", " plan");

  assert.ok(task.last().includes(named("rollout-plan", "Rollout")), task.last());
});

test("a heading laid in above another of the same words moves that one's mentions onto its new anchor", () => {
  const task = mounted(`## Goal\n\nShip.\n\n## Notes\n\nSee ${named("notes", "Notes")}.\n`);

  task.layHeadingAfter("Ship.", "Notes");

  assert.ok(task.last().includes(`## Notes\n\nSee ${named("notes-1", "Notes")}.`), task.last());
});

test("renaming a heading written with its own formatting still renames its mentions, read from the heading's source", () => {
  const task = mounted(
    `## Ship _today_\n\nStore first.\n\n## Notes\n\nSee ${section("Ship _today_")}.\n`,
  );

  task.typeAfter("today", " now");

  const draft = task.last();
  const anchors = new Set(sectionAnchors(planSections(draft).map((each) => each.heading)));
  const found = mentionsIn(draft, PLACE.repository).map(({ mention }) =>
    mention.kind === MENTION_KIND.SECTION ? mention.anchor : "",
  );
  assert.equal(found.length, 1);
  assert.ok(
    anchors.has(found[0] ?? "") && found[0] !== "ship-_today_",
    `${found[0]} is an anchor of ${[...anchors].join(", ")}`,
  );
});

test("a key an input method is composing with goes to the input method, never to the list or the editor's own keys", () => {
  const task = mounted(TEXT);
  task.typeAfter("Store first.", " See @go");
  task.offered.length = 0;

  task.press({ key: "Enter", isComposing: true });
  task.press({ key: "Enter", keyCode: 229 });
  task.press({ key: "Escape", isComposing: true });
  task.press({ key: "Enter", metaKey: true, keyCode: 229 });

  assert.deepEqual(task.offered, []);
  assert.equal(task.finished(), 0);
});

test("a pick with the caret inside the word replaces the word through its end", () => {
  const task = mounted(TEXT);

  task.typeAfter("Store first.", " See @goal");
  task.back(2);
  task.handle.chooseMention({
    name: "Goal",
    target: `https://tryluke.dev/acme/plan/${TASK_ID}#goal`,
  });

  assert.ok(task.last().endsWith(`Store first. See ${section("Goal")}\n`), task.last());
});

test("a pick right before a chip replaces the word alone, and the chip stays", () => {
  const task = mounted(`## Goal\n\nSee ${section("Rollout")}\n\n## Rollout\n\nStore first.\n`);

  task.typeAfter("See ", "@go");
  task.handle.chooseMention({
    name: "Goal",
    target: `https://tryluke.dev/acme/plan/${TASK_ID}#goal`,
  });

  assert.ok(task.last().includes(`See ${section("Goal")} ${section("Rollout")}`), task.last());
});

test("a page of an integration's pasted whole is laid in as its mention, written back as its link", () => {
  const task = mounted(TEXT);

  task.typeAfter("Store first.", " See ");
  task.paste(ISSUE_URL);

  assert.ok(
    task.last().includes(`Store first. See [@LUKE-142/fix-the-thing](${ISSUE_URL})`),
    task.last(),
  );
  assert.ok(task.drawn.some((mention) => mention.target === ISSUE_URL));
});

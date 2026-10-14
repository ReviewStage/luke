// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, mentionMarkdown, mentionsIn } from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "#testing/composer";
import { retargetedMention } from "../planning/mention-chip";
import type { ComposerTrigger, MentionNode, PlanEditorHandle } from "./contract";
import { mountPlanEditor } from "./plan-editor";

/**
 * The plan editor's mentions over the real editor: a mention in the text
 * opened as its node, drawn by the panel, and written back as the link it was
 * read from; an `@` word reported and a pick written in its place; no `@` in
 * code or inside a word; and a heading renamed in the edit renaming the
 * text's own mentions of it. Synthetic plan.
 */

const PLAN_ID = "pl_1";

const section = (heading: string) =>
  mentionMarkdown({ kind: MENTION_KIND.SECTION, planId: PLAN_ID, heading }, heading);

const TEXT = `## Goal\n\nShip as ${section("Rollout")} says.\n\n## Rollout\n\nStore first.\n`;

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
      retarget: (target, renamed) => retargetedMention(PLAN_ID, target, renamed),
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
    press,
    back,
    last: () => drafts.at(-1) ?? "",
    finished: () => finished,
  };
}

test("a mention in the text opens as its node, drawn by the panel, and writes back as the link it was read from", () => {
  const plan = mounted(TEXT);

  plan.typeAfter("says.", " Today.");

  assert.deepEqual(plan.drawn, [{ name: "Rollout", target: `luke://plan/${PLAN_ID}#Rollout` }]);
  assert.equal(
    plan.last(),
    `## Goal\n\nShip as ${section("Rollout")} says. Today.\n\n## Rollout\n\nStore first.\n`,
  );
});

test("an @ word the caret ends is reported with what follows it, and a pick writes the mention and a space in its place", () => {
  const plan = mounted(TEXT);

  plan.typeAfter("Store first.", " See @go");
  const reported = plan.triggers.at(-1);
  plan.handle.chooseMention({ name: "Goal", target: `luke://plan/${PLAN_ID}#Goal` });

  assert.equal(reported?.query, "go");
  assert.ok(plan.last().includes(`Store first. See ${section("Goal")}`), plan.last());
});

test("an @ inside a word, or inside code, opens nothing", () => {
  const plan = mounted("## Goal\n\nWrite to dean\n\n```\ncode\n```\n");

  plan.typeAfter("dean", "@acme");
  plan.typeAfter("code", " @a");

  assert.ok(plan.triggers.every((trigger) => trigger === undefined));
});

test("renaming a heading in the editor renames the text's own mentions of it, in the same edit", () => {
  const plan = mounted(TEXT);

  plan.typeAfter("Rollout", " plan");

  assert.equal(
    plan.last(),
    `## Goal\n\nShip as ${mentionMarkdown({ kind: MENTION_KIND.SECTION, planId: PLAN_ID, heading: "Rollout plan" }, "Rollout")} says.\n\n## Rollout plan\n\nStore first.\n`,
  );
});

test("renaming a heading written with its own formatting still renames its mentions, read from the heading's source", () => {
  const plan = mounted(
    `## Ship _today_\n\nStore first.\n\n## Notes\n\nSee ${section("Ship _today_")}.\n`,
  );

  plan.typeAfter("today", " now");

  const draft = plan.last();
  const headings = new Set(planSections(draft).map((each) => each.heading));
  const named = mentionsIn(draft).map(({ mention }) =>
    mention.kind === MENTION_KIND.SECTION ? mention.heading : "",
  );
  assert.equal(named.length, 1);
  assert.ok(
    headings.has(named[0] ?? ""),
    `${named[0]} is a heading of ${[...headings].join(", ")}`,
  );
});

test("a key an input method is composing with goes to the input method, never to the list or the editor's own keys", () => {
  const plan = mounted(TEXT);
  plan.typeAfter("Store first.", " See @go");
  plan.offered.length = 0;

  plan.press({ key: "Enter", isComposing: true });
  plan.press({ key: "Enter", keyCode: 229 });
  plan.press({ key: "Escape", isComposing: true });
  plan.press({ key: "Enter", metaKey: true, keyCode: 229 });

  assert.deepEqual(plan.offered, []);
  assert.equal(plan.finished(), 0);
});

test("a pick with the caret inside the word replaces the word through its end", () => {
  const plan = mounted(TEXT);

  plan.typeAfter("Store first.", " See @goal");
  plan.back(2);
  plan.handle.chooseMention({ name: "Goal", target: `luke://plan/${PLAN_ID}#Goal` });

  assert.ok(plan.last().endsWith(`Store first. See ${section("Goal")}\n`), plan.last());
});

test("a pick right before a chip replaces the word alone, and the chip stays", () => {
  const plan = mounted(`## Goal\n\nSee ${section("Rollout")}\n\n## Rollout\n\nStore first.\n`);

  plan.typeAfter("See ", "@go");
  plan.handle.chooseMention({ name: "Goal", target: `luke://plan/${PLAN_ID}#Goal` });

  assert.ok(plan.last().includes(`See ${section("Goal")} ${section("Rollout")}`), plan.last());
});

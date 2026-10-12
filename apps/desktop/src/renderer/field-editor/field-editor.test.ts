// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { FIELD_KIND, type FieldEditorProps, type FieldValue } from "./contract";
import { mountFieldEditor } from "./field-editor";

/**
 * The editor as its bundle mounts it: TipTap over a host in the document.
 * jsdom lays nothing out, so a click's point is not tested here (the plan
 * document's tests hand one over); typing is the editor's own DOM changing,
 * which ProseMirror reads back as a browser's input would be.
 */

const handles: { destroy: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on `value`, with every set of words it handed over and every finish. */
function mounted(value: FieldValue, limit: number | undefined = undefined) {
  const host = document.createElement("div");
  document.body.append(host);
  const drafts: FieldValue[] = [];
  let finished = 0;
  const props: FieldEditorProps = {
    value,
    at: undefined,
    label: "Problem",
    className: "markdown plan-unit",
    limit,
    onDraft: (words) => drafts.push(words),
    onFinish: () => {
      finished += 1;
    },
  };
  handles.push(mountFieldEditor(host, props));
  const editable = host.querySelector<HTMLElement>("[contenteditable=true]");
  assert.ok(editable, "the editor's words");
  return { host, editable, drafts, finishes: () => finished };
}

/** The first text in the editor holding `words`, as the browser would leave it after typing. */
async function retype(editable: HTMLElement, words: string, next: string): Promise<void> {
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null && !node.textContent?.includes(words)) node = walker.nextNode();
  assert.ok(node, words);
  node.textContent = node.textContent?.replace(words, next) ?? next;
  // ProseMirror reads the change from its mutation observer, a task later.
  await new Promise<void>((settled) => queueMicrotask(settled));
  await new Promise<void>((settled) => queueMicrotask(settled));
}

function press(editable: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  editable.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}

test("a text field opens as its Markdown drawn, labelled as a multi-line text box, and hands over nothing until it changes", () => {
  const { editable, drafts } = mounted({
    kind: FIELD_KIND.TEXT,
    text: "Only an **admin** can add `members`.\n\n## Rejected\n\n- A separate table.",
  });

  assert.equal(editable.getAttribute("role"), "textbox");
  assert.equal(editable.getAttribute("aria-multiline"), "true");
  assert.equal(editable.getAttribute("aria-label"), "Problem");
  assert.ok(editable.classList.contains("markdown"), "the read view's classes");
  assert.equal(editable.querySelector("strong")?.textContent, "admin");
  assert.equal(editable.querySelector("code")?.textContent, "members");
  assert.equal(editable.querySelector("h2")?.textContent, "Rejected");
  assert.equal(editable.querySelector("li")?.textContent, "A separate table.");
  assert.deepEqual(drafts, []);
});

test("typing in a text field hands over its Markdown", async () => {
  const { editable, drafts } = mounted({
    kind: FIELD_KIND.TEXT,
    text: "Only an **admin** can add members.",
  });

  await retype(editable, " can add members.", " can add teammates.");

  assert.deepEqual(drafts.at(-1), {
    kind: FIELD_KIND.TEXT,
    text: "Only an **admin** can add teammates.",
  });
});

test("Esc and ⌘↩ finish the edit; a plain Return does not", () => {
  const { editable, finishes } = mounted({ kind: FIELD_KIND.TEXT, text: "Only an admin." });

  press(editable, "Escape");
  press(editable, "Enter", { metaKey: true });
  press(editable, "Enter");

  assert.equal(finishes(), 2);
});

test("the assumptions open as written, not as Markdown, and hand over plain lines", async () => {
  const { editable, drafts } = mounted({
    kind: FIELD_KIND.ASSUMPTIONS,
    text: "Invites use *the* memberships table.\nAn invite expires after 7 days.",
  });

  assert.equal(editable.querySelector("em"), null);
  assert.equal(editable.querySelectorAll("li").length, 2);
  await retype(editable, "7 days", "14 days");

  assert.deepEqual(drafts.at(-1), {
    kind: FIELD_KIND.ASSUMPTIONS,
    text: "Invites use *the* memberships table.\nAn invite expires after 14 days.",
  });
});

test("the open questions open one to a bullet and hand over one to a line", async () => {
  const { editable, drafts } = mounted({
    kind: FIELD_KIND.QUESTIONS,
    text: "Who can withdraw an invite?\nHow long is a link valid?",
  });

  assert.equal(editable.querySelectorAll("li").length, 2);
  await retype(editable, "How long", "For how long");

  assert.deepEqual(drafts.at(-1), {
    kind: FIELD_KIND.QUESTIONS,
    text: "- Who can withdraw an invite?\n- For how long is a link valid?",
  });
});

const RULE = {
  statement: "Any member may invite by `email`.",
  // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
  examples: [{ given: "A member invites Dana", when: "Dana opens the link", then: "Dana joins" }], // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
};

test("a rule opens as its statement over its examples, each clause behind a label never typed, and hands over its parts", async () => {
  const { editable, drafts } = mounted({ kind: FIELD_KIND.RULE, rule: RULE });

  assert.equal(editable.querySelector("p code")?.textContent, "email");
  assert.deepEqual(
    [...editable.querySelectorAll(".plan-rule-clause > strong")].map((label) => label.textContent),
    ["Given", "When", "Then"],
  );
  assert.ok(
    [...editable.querySelectorAll(".plan-rule-clause > strong")].every(
      (label) => label.getAttribute("contenteditable") === "false",
    ),
  );
  await retype(editable, "Dana joins", "Dana joins as a member");

  assert.deepEqual(drafts.at(-1), {
    kind: FIELD_KIND.RULE,
    rule: {
      statement: "Any member may invite by `email`.",
      examples: [
        {
          given: "A member invites Dana",
          when: "Dana opens the link",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
          then: "Dana joins as a member", // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
        },
      ],
    },
  });
});

test("Return in a rule's statement with no examples starts its first, a Given, When, and Then", () => {
  const { editable, drafts } = mounted({
    kind: FIELD_KIND.RULE,
    rule: { statement: "Invites expire after 7 days.", examples: [] },
  });

  press(editable, "Enter");

  assert.equal(editable.querySelectorAll("li").length, 1);
  assert.deepEqual(drafts.at(-1), {
    kind: FIELD_KIND.RULE,
    rule: {
      statement: "Invites expire after 7 days.",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
      examples: [{ given: "", when: "", then: "" }], // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
    },
  });
});

test("a text field holds no more than its limit", async () => {
  const { editable, drafts } = mounted({ kind: FIELD_KIND.TEXT, text: "Short." }, 10);

  await retype(editable, "Short.", "Far longer than ten.");

  assert.ok(drafts.every((draft) => draft.kind === FIELD_KIND.TEXT && draft.text.length <= 10));
});

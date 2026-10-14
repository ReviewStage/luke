import assert from "node:assert/strict";
import {
  lineParts,
  MENTIONED_HEADING,
  receivedPartsOf,
} from "@sidecar/database/models/attached-file-parts";
import { COALESCED_LINE_SEPARATOR } from "@sidecar/database/models/message-reads";
import { MENTION_KIND, mentionMarkdown } from "@sidecar/hosted/mention-link";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import { eveContent, receivedMessage } from "../server/hosted/attached-files";
import { MENTIONED_BOUNDS, mentionedContext } from "../server/hosted/mentioned-context";

/**
 * What a coding agent's message mentions of its plan, handed beside its
 * words as it stood at the send, within its bounds; and the line that
 * carried it matched by eve's receipt of what eve was handed, its words
 * alone read back as the developer's. Synthetic plan.
 */

const PLAN: Plan = {
  id: "7d4f3c2a-1b0e-4f6a-9c8d-2e1f0a9b8c7d",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1_000,
  updatedAt: 1_000,
  repository: "acme/relay",
  document: {
    body: [
      "## Goal",
      "",
      "Any member can invite a teammate by email.",
      "",
      "## Rollout",
      "",
      "Store first, then the desktop.",
    ].join("\n"),
    assumptions: [],
  },
};

const section = (heading: string) =>
  mentionMarkdown({ kind: MENTION_KIND.SECTION, planId: PLAN.id, heading }, heading);

test("a section the words mention is handed as it stands, under the part's heading", () => {
  const part = mentionedContext(`Do what ${section("Rollout")} says.`, PLAN);

  assert.equal(
    part,
    `${MENTIONED_HEADING}\n\nThe plan's section "Rollout":\n\n## Rollout\n\nStore first, then the desktop.`,
  );
});

test("the whole plan the words mention is handed as an agent started on it is", () => {
  const part = mentionedContext(
    `Read ${mentionMarkdown({ kind: MENTION_KIND.PLAN, planId: PLAN.id }, PLAN.name)} first.`,
    PLAN,
  );

  assert.match(part ?? "", /The whole plan:\n\n# Teammate invitations\n\n## Goal/u);
  assert.match(part ?? "", /Store first, then the desktop\.$/u);
});

test("a section the plan no longer holds is named as gone", () => {
  const part = mentionedContext(`See ${section("Old flow")}.`, PLAN);

  assert.match(part ?? "", /The section "Old flow": no longer in the plan\./u);
});

test("words that mention only files, folders, another plan, or nothing are handed nothing more", () => {
  for (const words of [
    "Fix [@a.ts](luke://file/src/a.ts) and look through [@src/](luke://folder/src/).",
    `See ${mentionMarkdown({ kind: MENTION_KIND.SECTION, planId: "another-plan", heading: "Goal" }, "Goal")}.`,
    "No mention here, only [a link](https://example.com).",
    "`[@Rollout](luke://plan/7d4f3c2a-1b0e-4f6a-9c8d-2e1f0a9b8c7d#Rollout)` is code.",
  ]) {
    assert.equal(mentionedContext(words, PLAN), undefined, words);
  }
});

test("a section mentioned twice is handed once", () => {
  const part = mentionedContext(`${section("Goal")} and again ${section("Goal")}.`, PLAN);

  assert.equal(part?.split('The plan\'s section "Goal"').length, 2);
});

test("a long section is cut on a line, saying how much was left out, and a full part names what it left out", () => {
  const long = Array.from({ length: 400 }, (_, at) => `- step ${at}: ${"x".repeat(20)}`).join("\n");
  const headings = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"];
  const plan: Plan = {
    ...PLAN,
    document: {
      body: headings.map((heading) => `## ${heading}\n\n${long}`).join("\n\n"),
      assumptions: [],
    },
  };

  const part = mentionedContext(headings.map(section).join(" "), plan) ?? "";

  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, `${part.length} characters`);
  assert.match(part, /… \(\d+ more characters\)/u);
  assert.match(part, /\d+ more mentions? of the plan left out, since this part is full/u);
});

test("a line carrying what it mentioned is matched by eve's receipt of it, and reads back as its words alone", () => {
  const words = `Do what ${section("Rollout")} says.`;
  const mentioned = mentionedContext(words, PLAN);
  const handed = eveContent(words, [], mentioned);
  assert.ok(Array.isArray(handed));
  const receipt = receivedMessage({
    message: words,
    parts: handed.flatMap((part) =>
      part.type === "text" ? [{ type: "text", text: part.text }] : [],
    ),
  });

  const line = receivedPartsOf(lineParts(words, [], mentioned));

  assert.equal(line?.join(COALESCED_LINE_SEPARATOR), receipt.text);
  assert.equal(receipt.words, words);
});

test("words that mention nothing of the plan go to eve as the words alone, as every message did before", () => {
  assert.equal(eveContent("Use the helper.", [], undefined), "Use the helper.");
});

test("however long the headings of what is left out, the part stays inside its bound", () => {
  const long = "x".repeat(3_900);
  const headings = Array.from({ length: 12 }, (_, at) => `${"Heading ".repeat(100)}${at}`);
  const plan: Plan = {
    ...PLAN,
    document: {
      body: headings.map((heading) => `## ${heading}\n\n${long}`).join("\n\n"),
      assumptions: [],
    },
  };

  const part = mentionedContext(headings.map(section).join(" "), plan) ?? "";

  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, `${part.length} characters`);
});

test("a plan cut short names every section past the cut, one whose heading earlier words quote included", () => {
  const filler = Array.from({ length: 700 }, (_, at) => `- line ${at} of the context`).join("\n");
  const plan: Plan = {
    ...PLAN,
    document: {
      body: `## Context\n\nSee Rollout below.\n\n${filler}\n\n## Rollout\n\nStore first.`,
      assumptions: [],
    },
  };

  const part =
    mentionedContext(
      mentionMarkdown({ kind: MENTION_KIND.PLAN, planId: PLAN.id }, PLAN.name),
      plan,
    ) ?? "";

  assert.match(part, /The whole plan, cut short/u);
  assert.match(part, /Its other sections: Rollout\./u);
});

test("a message whose words happen to open as the mentioned part does still reads back as its words", () => {
  const words = `${MENTIONED_HEADING} is how the part opens.`;

  const receipt = receivedMessage({ message: words, parts: [{ type: "text", text: words }] });

  assert.equal(receipt.words, words);
});

test("a section too long for the room left is passed over, and a shorter one after it still goes", () => {
  const plan: Plan = {
    ...PLAN,
    document: {
      body: [
        "## Big",
        "",
        ...Array.from({ length: 6 }, () => "x".repeat(3_900)),
        "## Huge",
        "",
        ...Array.from({ length: 6 }, () => "y".repeat(3_900)),
        "## Small",
        "",
        "Store first.",
      ].join("\n"),
      assumptions: [],
    },
  };
  const many = Array.from({ length: 5 }, (_, at) => `## S${at}\n\n${"z".repeat(3_950)}`).join(
    "\n\n",
  );
  const crowded: Plan = {
    ...plan,
    document: { body: `${many}\n\n${plan.document.body}`, assumptions: [] },
  };
  const words = [
    ...Array.from({ length: 5 }, (_, at) => section(`S${at}`)),
    section("Big"),
    section("Small"),
  ].join(" ");

  const part = mentionedContext(words, crowded) ?? "";

  assert.match(part, /The plan's section "Small"/u);
  assert.match(part, /1 more mention of the plan left out/u);
  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS);
});

test("a cut plan with many long headings past the cut is still handed, its list of them bounded", () => {
  const sections = Array.from(
    { length: 60 },
    (_, at) => `## ${"Long heading ".repeat(70)}${at}\n\n${"w".repeat(400)}`,
  );
  const plan: Plan = { ...PLAN, document: { body: sections.join("\n\n"), assumptions: [] } };

  const part =
    mentionedContext(
      mentionMarkdown({ kind: MENTION_KIND.PLAN, planId: PLAN.id }, PLAN.name),
      plan,
    ) ?? "";

  assert.match(part, /The whole plan, cut short/u);
  assert.match(part, /and \d+ more\./u);
  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, `${part.length} characters`);
});

import assert from "node:assert/strict";
import { test } from "vitest";
import { planMarkdown } from "./plan-markdown.js";
import { EMPTY_PLAN_FIELDS, planBody } from "./plan-template.js";
import type { PlanDocument } from "./plan-wire.js";

const BODY = [
  "# Teammate invitations",
  "",
  "## Goal",
  "Invite a teammate by email.",
  "",
  "## Open questions",
  "",
  "- Who can withdraw an invite in `acme/relay`?",
].join("\n");

test("the copy is the body as saved, then every assumption as a list item", () => {
  const document: PlanDocument = {
    body: `${BODY}\n`,
    assumptions: [
      { text: "Members and admins can both invite." },
      { text: "An invite expires after 7 days." },
    ],
  };

  assert.equal(
    planMarkdown(document),
    `${BODY}

## Assumptions

- Members and admins can both invite.
- An invite expires after 7 days.
`,
  );
});

test("the assumptions' section stands on every copy, saying none is recorded while the list is empty", () => {
  assert.equal(
    planMarkdown({ body: BODY, assumptions: [] }),
    `${BODY}\n\n## Assumptions\n\n_None recorded_\n`,
  );
  assert.equal(
    planMarkdown({ body: "", assumptions: [{ text: "Invites are by email." }] }),
    "## Assumptions\n\n- Invites are by email.\n",
  );
  assert.equal(planMarkdown({ body: "", assumptions: [] }), "## Assumptions\n\n_None recorded_\n");
});

test("a draft of the fixed template copies every section in order, its unanswered fields, and every assumption", () => {
  const body = planBody(
    {
      name: "Teammate invitations",
    },
    {
      ...EMPTY_PLAN_FIELDS,
      rules: [{ statement: "An accepted invite is never reused.", examples: null }],
    },
  );

  const copied = planMarkdown({
    body,
    assumptions: [
      { text: "An accepted invite is never reused." },
      { text: "An invite expires after 7 days." },
    ],
  });

  assert.equal(
    copied,
    `${body.trimEnd()}\n\n## Assumptions\n\n- An accepted invite is never reused.\n- An invite expires after 7 days.\n`,
  );
  const sections = copied.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(sections, [
    "## Goal",
    "## Scope",
    "## Rules",
    "## Implementation",
    "## Decisions",
    "## Verification",
    "## Left to the agent",
    "## Open questions",
    "## Assumptions",
  ]);
  assert.ok(copied.includes("### Rule 1: An accepted invite is never reused.\n"));
  assert.ok(copied.includes("## Decisions\n\n_Unanswered_\n"));
});

test("an assumption spanning lines stays one list item", () => {
  const copied = planMarkdown({
    body: BODY,
    assumptions: [{ text: "Invites expire.\n\nAfter 7 days." }],
  });

  assert.ok(copied.endsWith("\n- Invites expire. After 7 days.\n"));
});

test("a long run of spaces holding no line break is kept as written, however long", () => {
  const spaces = " ".repeat(300_000);
  const copied = planMarkdown({
    body: "",
    assumptions: [{ text: `Invites expire.${spaces}After 7 days.\nEventually.` }],
  });

  assert.equal(copied, `## Assumptions\n\n- Invites expire.${spaces}After 7 days. Eventually.\n`);
});

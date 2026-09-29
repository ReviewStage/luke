import assert from "node:assert/strict";
import { EMPTY_PLAN_UPDATE, planBody } from "@sidecar/hosted/plan-template";
import { PLAN_BOUNDS, type PlanDocument } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import { ACT_KIND, parsedAct } from "./messages/acts";
import { planMarkdown } from "./plan-markdown";

const BODY = [
  "# Teammate invitations",
  "",
  "## Goal",
  "Invite a teammate by email.",
  "",
  "## Handoff prompt",
  "",
  "You are implementing teammate invitations in `acme/relay`.",
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
      repository: {
        owner: "acme",
        name: "relay",
        branch: "main",
        commit: "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4",
      },
    },
    {
      ...EMPTY_PLAN_UPDATE,
      behavior: {
        ...EMPTY_PLAN_UPDATE.behavior,
        invariants: "An accepted invite is never reused.",
      },
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
    "## Purpose and users",
    "## Scope",
    "## Existing system",
    "## Behavior",
    "## Data and interfaces",
    "## Quality requirements",
    "## Implementation guidance",
    "## Acceptance",
    "## Open questions",
    "## Handoff prompt",
    "## Assumptions",
  ]);
  assert.ok(copied.includes("### Invariants\n\nAn accepted invite is never reused.\n"));
  assert.ok(copied.includes("### Decisions\n\n_Unanswered_\n"));
  assert.ok(copied.includes("## Handoff prompt\n\n_Not prepared_\n"));
});

test("an assumption spanning lines stays one list item", () => {
  const copied = planMarkdown({
    body: BODY,
    assumptions: [{ text: "Invites expire.\n\nAfter 7 days." }],
  });

  assert.ok(copied.endsWith("\n- Invites expire. After 7 days.\n"));
});

test("the longest document the store holds is admitted whole by the copy act, and so is an empty one", () => {
  const longest: PlanDocument = {
    body: "b".repeat(PLAN_BOUNDS.MAX_BODY_CHARS),
    assumptions: Array.from({ length: PLAN_BOUNDS.MAX_ASSUMPTIONS }, () => ({
      text: "a".repeat(PLAN_BOUNDS.MAX_ASSUMPTION_CHARS),
    })),
  };

  for (const document of [longest, { body: "", assumptions: [] }]) {
    const words = planMarkdown(document);
    const sent = { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words } };
    assert.deepEqual(parsedAct(sent), sent);
  }
});

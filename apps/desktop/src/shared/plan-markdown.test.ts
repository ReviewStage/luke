import assert from "node:assert/strict";
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

test("the copy is the body as saved, then every assumption as a checklist item carrying its flag", () => {
  const document: PlanDocument = {
    body: `${BODY}\n`,
    assumptions: [
      { text: "Members and admins can both invite.", confirmed: true },
      { text: "An invite expires after 7 days.", confirmed: false },
    ],
  };

  assert.equal(
    planMarkdown(document),
    `${BODY}

## Assumptions

- [x] Members and admins can both invite.
- [ ] An invite expires after 7 days.
`,
  );
});

test("a document with no assumption confirmed copies whole, the same as any other", () => {
  const document: PlanDocument = {
    body: BODY,
    assumptions: [
      { text: "Only admins can invite teammates.", confirmed: false },
      { text: "An invite expires after 7 days.", confirmed: false },
    ],
  };

  const copied = planMarkdown(document);

  assert.ok(copied.startsWith(`${BODY}\n\n## Assumptions\n`));
  assert.ok(copied.includes("- [ ] Only admins can invite teammates.\n"));
  assert.ok(copied.includes("- [ ] An invite expires after 7 days.\n"));
});

test("a document without assumptions is its body, and one without a body is its checklist", () => {
  assert.equal(planMarkdown({ body: BODY, assumptions: [] }), `${BODY}\n`);
  assert.equal(
    planMarkdown({ body: "", assumptions: [{ text: "Invites are by email.", confirmed: true }] }),
    "## Assumptions\n\n- [x] Invites are by email.\n",
  );
  assert.equal(planMarkdown({ body: "", assumptions: [] }), "");
});

test("an assumption spanning lines stays one checklist item", () => {
  const copied = planMarkdown({
    body: BODY,
    assumptions: [{ text: "Invites expire.\n\nAfter 7 days.", confirmed: false }],
  });

  assert.ok(copied.endsWith("\n- [ ] Invites expire. After 7 days.\n"));
});

test("the longest document the store holds is admitted whole by the copy act, and so is an empty one", () => {
  const longest: PlanDocument = {
    body: "b".repeat(PLAN_BOUNDS.MAX_BODY_CHARS),
    assumptions: Array.from({ length: PLAN_BOUNDS.MAX_ASSUMPTIONS }, () => ({
      text: "a".repeat(PLAN_BOUNDS.MAX_ASSUMPTION_CHARS),
      confirmed: true,
    })),
  };

  for (const document of [longest, { body: "", assumptions: [] }]) {
    const words = planMarkdown(document);
    const sent = { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words } };
    assert.deepEqual(parsedAct(sent), sent);
  }
});

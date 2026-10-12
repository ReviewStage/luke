import assert from "node:assert/strict";
import { Schema as EffectSchema } from "effect";
import { test } from "vitest";
import { planMarkdown } from "./plan-markdown.js";
import { PLAN_EMPTY_TEXT } from "./plan-template.js";
import { ROLLOUT_BASE, ROLLOUT_BOUNDS, type Rollout, rolloutSchema } from "./plan-wire.js";

/** The rollout's section on a plan with no rollout yet, which ends every copy of one. */
const NO_ROLLOUT = `## Rollout\n\n${PLAN_EMPTY_TEXT.NO_ROLLOUT}\n`;

/** Three pull requests: a table on main, then a route and a screen that each need only the table. */
const ROLLOUT: Rollout = [
  {
    title: "Add the invite table",
    scope: "The `invite` table and its migration.",
    base: ROLLOUT_BASE.MAIN,
    acceptance: "A store test writes and reads an invite.",
  },
  { title: "Invite route", scope: "The `invite` route over the table.", base: 1, acceptance: null },
  {
    title: "Invite screen",
    scope: "The form that sends an invite.\n## Not a section",
    base: 1,
    acceptance: "The form posts and shows the sent invite.",
  },
];

/** The three pull requests as the rollout's section draws them. */
const ROLLOUT_SECTION = [
  "## Rollout",
  "",
  "1. **Add the invite table** · base: main",
  "",
  "   The `invite` table and its migration.",
  "",
  "   Done when: A store test writes and reads an invite.",
  "2. **Invite route** · base: #1",
  "",
  "   The `invite` route over the table.",
  "3. **Invite screen** · base: #1",
  "",
  "   The form that sends an invite.",
  "   \\## Not a section",
  "",
  "   Done when: The form posts and shows the sent invite.",
  "",
].join("\n");

test("a plan copies as its name for a title over its text, which holds its assumptions, then its rollout's section saying there is none yet", () => {
  const text =
    "## Goal\n\nInvite a teammate by email.\n\n## Assumptions\n\n- An invite expires after 7 days.\n";

  const copied = planMarkdown({
    name: "Teammate\ninvitations ",
    document: { body: text, assumptions: [] },
    rollout: [],
  });

  assert.equal(copied, `# Teammate invitations\n\n${text}\n${NO_ROLLOUT}`);
  assert.equal(
    planMarkdown({
      name: "Teammate invitations",
      document: { body: "", assumptions: [] },
      rollout: [],
    }),
    `# Teammate invitations\n\n${NO_ROLLOUT}`,
  );
});

test("the rollout is drawn after the text as numbered pull requests, each with its base, scope, and what it is done when", () => {
  const text = "## Goal\n\nInvite a teammate by email.\n";

  const copied = planMarkdown({
    name: "Teammate invitations",
    document: { body: text, assumptions: [] },
    rollout: ROLLOUT,
  });

  assert.equal(copied, `# Teammate invitations\n\n${text}\n${ROLLOUT_SECTION}`);
});

test("a rollout whose pull request bases on itself or a later one, or past its bound, is refused", () => {
  const decode = (rollout: Rollout) => EffectSchema.decodeUnknownExit(rolloutSchema)(rollout)._tag;
  const [first, second] = ROLLOUT;
  assert.ok(first !== undefined && second !== undefined);
  const full = Array.from({ length: ROLLOUT_BOUNDS.MAX_PULL_REQUESTS }, () => first);

  assert.equal(decode(ROLLOUT), "Success");
  assert.equal(decode(full), "Success");
  assert.equal(decode([{ ...first, base: 1 }]), "Failure");
  assert.equal(decode([first, { ...second, base: 2 }]), "Failure");
  assert.equal(decode([{ ...first, base: 2 }, second]), "Failure");
  assert.equal(decode([...full, first]), "Failure");
});

import assert from "node:assert/strict";
import { CODING_AGENT_BRIEF } from "@sidecar/hosted/coding-agent-wire";
import type { RolloutItem } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import { type BriefPlan, briefOf, pullRequestBrief } from "../server/hosted/coder-host/brief";

/**
 * coder-host-brief.test.ts -- the brief a rollout's worker is handed, over a sibling pair and a chain.
 *
 * A plan's sections under the Context and Goal headings are handed verbatim, the worker's own pull request whole, the
 * chain from main with the branches below it, a link command only off main,
 * and every other pull request by title as out of scope.
 */

const CONTEXT = "A workspace member cannot bring a teammate in without an admin.";

const GOAL = "Invite a teammate by email.";

const SCHEMA: RolloutItem = {
  title: "Invitation table",
  scope: "Add the `invitation` table and its store.",
  base: "main",
  acceptance: "An invitation round-trips through the store.",
};

const ROUTE: RolloutItem = {
  title: "Invite route",
  scope: "POST /api/invitations over the store.",
  base: 1,
  acceptance: null,
};

const SCREEN: RolloutItem = {
  title: "Invite screen",
  scope: "The invite form in Settings.",
  base: 1,
  acceptance: "The form sends an invitation.",
};

const ACCEPT: RolloutItem = {
  title: "Accept flow",
  scope: "Accept an invitation from its link.",
  base: 2,
  acceptance: null,
};

/** A plan holding a Context and a Goal, with the rollout given. */
function documentPlan(rollout: readonly RolloutItem[]): BriefPlan {
  return { text: `## Context\n\n${CONTEXT}\n\n## Goal\n\n${GOAL}\n`, rollout };
}

test("the lowest pull request is handed the plan's context and goal, its own scope and acceptance, a stack of main alone, no link command, and its siblings as out of scope", () => {
  const brief = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN]), 1, new Map());

  assert.ok(brief !== undefined);
  assert.ok(brief.startsWith("# Pull request 1 of 3: Invitation table\n"));
  assert.ok(brief.includes(`## Context\n\n${CONTEXT}\n`));
  assert.ok(brief.includes(`## Goal\n\n${GOAL}\n`));
  assert.ok(brief.includes("Add the `invitation` table and its store."));
  assert.ok(brief.includes("Done when: An invitation round-trips through the store."));
  assert.ok(brief.includes("- main\n  - #1 Invitation table (yours)"));
  assert.ok(!brief.includes("gh stack link"));
  assert.ok(brief.includes("- #2 Invite route\n- #3 Invite screen"));
});

test("a sibling on the first pull request is handed the chain from main through its base's branch, the command linking its stack, and no acceptance where none is set", () => {
  const branches = new Map([[1, "luke/invites/1-schema"]]);

  const route = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN]), 2, branches);
  const screen = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN]), 3, branches);

  assert.ok(route !== undefined && screen !== undefined);
  assert.ok(
    route.includes(
      "- main\n  - #1 Invitation table on `luke/invites/1-schema`\n    - #2 Invite route (yours)",
    ),
  );
  assert.ok(route.includes("`gh stack link luke/invites/1-schema <your branch>`"));
  assert.ok(!route.includes("Done when:"));
  assert.ok(route.includes("- #1 Invitation table\n- #3 Invite screen"));
  assert.ok(!route.includes("#3 Invite screen (yours)"));
  assert.ok(screen.includes("    - #3 Invite screen (yours)"));
  assert.ok(!screen.includes("#2 Invite route (yours)"));
  assert.ok(screen.includes("Done when: The form sends an invitation."));
});

test("the top of a chain is handed every pull request below it, naming by position a branch nobody has recorded", () => {
  const branches = new Map([[2, "luke/invites/2-route"]]);

  const brief = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN, ACCEPT]), 4, branches);

  assert.ok(brief !== undefined);
  assert.ok(
    brief.includes(
      "- main\n  - #1 Invitation table\n    - #2 Invite route on `luke/invites/2-route`\n      - #4 Accept flow (yours)",
    ),
  );
  assert.ok(!brief.includes("#3 Invite screen\n      -"));
  assert.ok(
    brief.includes("`gh stack link <the branch of #1> luke/invites/2-route <your branch>`"),
  );
  assert.ok(brief.includes("- #1 Invitation table\n- #2 Invite route\n- #3 Invite screen\n"));
});

test("a plan hands its Context and Goal sections verbatim and leaves a missing one out", () => {
  const text = `Started from the template.\n\n## Context\n\n${CONTEXT}\n\n### Why now\n\nAdmins are swamped.\n\n## Approach\n\nA table, a route, a screen.\n`;

  const documented = pullRequestBrief({ text, rollout: [SCHEMA] }, 1, new Map());

  assert.ok(documented !== undefined);
  assert.ok(
    documented.includes(`## Context\n\n${CONTEXT}\n\n### Why now\n\nAdmins are swamped.\n`),
  );
  assert.ok(!documented.includes("## Goal"));
  assert.ok(!documented.includes("A table, a route, a screen."));
  assert.ok(!documented.includes("Started from the template."));
  assert.ok(!documented.includes("## Out of scope"));
});

test("a position the rollout does not name has no brief", () => {
  assert.equal(pullRequestBrief(documentPlan([SCHEMA]), 2, new Map()), undefined);
  assert.equal(pullRequestBrief(documentPlan([]), 1, new Map()), undefined);
});

test("what an agent was handed is read off its row: its task first, then a pull request where it holds a position, else the plan", () => {
  assert.equal(briefOf({ task: "Fix the typo.", position: 2 }), CODING_AGENT_BRIEF.TASK);
  assert.equal(briefOf({ task: null, position: 2 }), CODING_AGENT_BRIEF.PULL_REQUEST);
  assert.equal(briefOf({ task: null, position: null }), CODING_AGENT_BRIEF.PLAN);
});

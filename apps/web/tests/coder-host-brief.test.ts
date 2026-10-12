import assert from "node:assert/strict";
import { CODING_AGENT_BRIEF, ROLLOUT_ROLE } from "@sidecar/hosted/coding-agent-wire";
import type { RolloutItem } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import {
  type BriefPlan,
  briefOf,
  pullRequestBrief,
  stackKeeperBrief,
} from "../server/hosted/coder-host/brief";

/**
 * coder-host-brief.test.ts -- the briefs a rollout's builder and its stack keeper are handed, over a sibling pair and a chain.
 *
 * A builder is handed the plan's sections under the Context and Goal
 * headings verbatim, its own pull request whole, the chain from main with
 * the branches below it, every other pull request by title as out of scope,
 * and the rule that its own branch is all it pushes, with no command that
 * touches the stack. The keeper is handed every pull request with its base
 * and branch, and the chains it keeps as GitHub stacks.
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

/** The plan the keeper's rollout belongs to, whose builders' branches are cut under `luke/5f3c2a1e/`. */
const PLAN_ID = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";

/** Commands that change a stack's structure, none of which a builder is ever told to run. */
const STACK_COMMANDS = [
  "gh stack link",
  "gh stack init",
  "gh stack sync",
  "gh stack rebase",
  "gh stack push",
  "gh pr merge",
  "gh pr edit",
  "git rebase",
  "git push --force",
];

test("the lowest pull request is handed the plan's context and goal, its own scope and acceptance, a stack of main alone, and its siblings as out of scope", () => {
  const brief = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN]), 1, new Map());

  assert.ok(brief !== undefined);
  assert.ok(brief.startsWith("# Pull request 1 of 3: Invitation table\n"));
  assert.ok(brief.includes(`## Context\n\n${CONTEXT}\n`));
  assert.ok(brief.includes(`## Goal\n\n${GOAL}\n`));
  assert.ok(brief.includes("Add the `invitation` table and its store."));
  assert.ok(brief.includes("Done when: An invitation round-trips through the store."));
  assert.ok(brief.includes("- main\n  - #1 Invitation table (yours)"));
  assert.ok(brief.includes("- #2 Invite route\n- #3 Invite screen"));
});

test("a sibling on the first pull request is handed the chain from main through its base's branch, and no acceptance where none is set", () => {
  const branches = new Map([[1, "luke/invites/1-schema"]]);

  const route = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN]), 2, branches);
  const screen = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN]), 3, branches);

  assert.ok(route !== undefined && screen !== undefined);
  assert.ok(
    route.includes(
      "- main\n  - #1 Invitation table on `luke/invites/1-schema`\n    - #2 Invite route (yours)",
    ),
  );
  assert.ok(!route.includes("Done when:"));
  assert.ok(route.includes("- #1 Invitation table\n- #3 Invite screen"));
  assert.ok(!route.includes("#3 Invite screen (yours)"));
  assert.ok(screen.includes("    - #3 Invite screen (yours)"));
  assert.ok(!screen.includes("#2 Invite route (yours)"));
  assert.ok(screen.includes("Done when: The form sends an invitation."));
});

test("the top of a chain is handed every pull request below it, with a branch only where one is recorded", () => {
  const branches = new Map([[2, "luke/invites/2-route"]]);

  const brief = pullRequestBrief(documentPlan([SCHEMA, ROUTE, SCREEN, ACCEPT]), 4, branches);

  assert.ok(brief !== undefined);
  assert.ok(
    brief.includes(
      "- main\n  - #1 Invitation table\n    - #2 Invite route on `luke/invites/2-route`\n      - #4 Accept flow (yours)",
    ),
  );
  assert.ok(!brief.includes("#3 Invite screen\n      -"));
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

test("a plan that repeats its Context hands every one of them, in the order they stand", () => {
  const text = `## Context\n\n${CONTEXT}\n\n## Goal\n\n${GOAL}\n\n## Context\n\nInvites must survive a restart.\n`;

  const brief = pullRequestBrief({ text, rollout: [SCHEMA] }, 1, new Map());

  assert.ok(brief !== undefined);
  assert.ok(
    brief.includes(
      `## Context\n\n${CONTEXT}\n\n## Context\n\nInvites must survive a restart.\n\n## Goal\n\n${GOAL}\n`,
    ),
  );
});

test("a position the rollout does not name has no brief", () => {
  assert.equal(pullRequestBrief(documentPlan([SCHEMA]), 2, new Map()), undefined);
  assert.equal(pullRequestBrief(documentPlan([]), 1, new Map()), undefined);
});

test("every builder pushes its own branch alone, is told never to touch the stack and to reset to its remote head on a resync, and is told to run no command that changes a stack", () => {
  const rollout = [SCHEMA, ROUTE, SCREEN, ACCEPT];
  const branches = new Map([
    [1, "luke/invites/1-schema"],
    [2, "luke/invites/2-route"],
  ]);

  for (const position of [1, 2, 4]) {
    const brief = pullRequestBrief(documentPlan(rollout), position, branches);
    assert.ok(brief !== undefined);
    assert.ok(brief.includes("Push your own branch and nothing else."), `#${position}`);
    assert.ok(
      brief.includes(
        "never run `gh stack`, never rebase your branch onto a base that moved, never retarget your pull request, and never merge anything",
      ),
      `#${position}`,
    );
    assert.ok(
      brief.includes(
        "When you are told to resync, run `git fetch origin <your branch> && git reset --hard origin/<your branch>`",
      ),
      `#${position}`,
    );
    assert.ok(
      brief.includes("where you still hold edits or commits you have not pushed, reset nothing"),
      `#${position}`,
    );
    for (const command of STACK_COMMANDS) {
      assert.ok(!brief.includes(command), `#${position}: ${command}`);
    }
  }
});

test("the keeper of a sibling pair is handed every pull request with its base and branch, and two stacks: the chain up from main, and the sibling on the pull request it shares", () => {
  const brief = stackKeeperBrief(
    PLAN_ID,
    [SCHEMA, ROUTE, SCREEN],
    new Map([[1, "luke/5f3c2a1e/1-schema"]]),
  );

  assert.ok(brief !== undefined);
  assert.ok(brief.startsWith("# Stack keeper: 3 pull requests in 2 stacks\n"));
  assert.ok(
    brief.includes(
      "- #1 Invitation table · base: main · `luke/5f3c2a1e/1-schema`\n- #2 Invite route · base: #1 · no branch yet\n- #3 Invite screen · base: #1 · no branch yet\n",
    ),
  );
  assert.ok(
    brief.includes(
      "1. On main: #1 Invitation table → #2 Invite route\n2. On #1 Invitation table: #3 Invite screen\n",
    ),
  );
});

test("the keeper of a chain is handed one stack bottom to top, and the commands that keep it: link, restack in one pass, retarget after a merge, and merge on the developer's go", () => {
  const brief = stackKeeperBrief(
    PLAN_ID,
    [SCHEMA, { ...ROUTE }, { ...ACCEPT, base: 2 }],
    new Map([
      [1, "luke/5f3c2a1e/1-schema"],
      [2, "luke/5f3c2a1e/2-route"],
      [3, "luke/5f3c2a1e/3-accept"],
    ]),
  );

  assert.ok(brief !== undefined);
  assert.ok(brief.startsWith("# Stack keeper: 3 pull requests in 1 stack\n"));
  assert.ok(brief.includes("1. On main: #1 Invitation table → #2 Invite route → #3 Accept flow\n"));
  assert.ok(!brief.includes("2. On"));
  for (const kept of [
    "Every builder's branch is `luke/5f3c2a1e/<position>-<slug>`, fetched in your checkout under `origin/luke/5f3c2a1e/`",
    "`gh stack init <branch> <branch> …`",
    "`gh stack add <branch>`",
    "`gh stack submit`",
    "`gh stack sync`",
    "`gh stack rebase --continue`",
    "`gh stack rebase --abort`",
    "`gh stack push`",
    "`--force-with-lease`",
    "`gh pr edit <number> --base main`",
    "Merge only when Luke relays the developer's go",
    "`gh pr merge <number> --squash`",
    "Write no feature code.",
    "report it as `conflict`",
  ]) {
    assert.ok(brief.includes(kept), kept);
  }
});

test("a rollout with nothing in it has no keeper's brief", () => {
  assert.equal(stackKeeperBrief(PLAN_ID, [], new Map()), undefined);
});

test("what an agent was handed is read off its row: the keeper's stacks for the keeper whatever else it holds, then its task, then a pull request where it holds a position, else the plan", () => {
  const keeper = { position: null, role: ROLLOUT_ROLE.KEEPER };
  const builder = { position: 2, role: ROLLOUT_ROLE.BUILDER };
  assert.equal(briefOf({ ...builder, task: "Fix the typo." }), CODING_AGENT_BRIEF.TASK);
  assert.equal(briefOf({ ...keeper, task: "Fix the typo." }), CODING_AGENT_BRIEF.STACK_KEEPER);
  assert.equal(briefOf({ ...keeper, task: null }), CODING_AGENT_BRIEF.STACK_KEEPER);
  assert.equal(briefOf({ ...builder, task: null }), CODING_AGENT_BRIEF.PULL_REQUEST);
  assert.equal(briefOf({ task: null, position: null, role: null }), CODING_AGENT_BRIEF.PLAN);
});

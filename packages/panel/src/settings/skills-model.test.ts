import assert from "node:assert/strict";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { test } from "vitest";
import {
  failureLine,
  fencedSkillFile,
  installScopes,
  SKILL_ACTION,
  shareFailureLine,
  shareQuestion,
  skillActions,
  skillGroups,
} from "./skills-model.js";

/**
 * Settings › Skills judged without drawing: the workspace's skills before
 * the account's own, each saying where its files came from and who
 * installed it; the scopes the dialog offers by role and workspace; every
 * refusal said in words that name the skill; what each row's ⋯ holds and
 * what Share asks; and how View fences a skill's text. Synthetic names and
 * ids.
 */

const READER = "user-ada";
const SHA = "3f9c2e1aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";

function skill(
  name: string,
  scope: InstalledSkillSummary["scope"],
  extra: Partial<InstalledSkillSummary> = {},
): InstalledSkillSummary {
  return {
    id: `id-${name}`,
    scope,
    name,
    description: `${name} described`,
    userInvocable: true,
    source: { type: INSTALLED_SKILL_SOURCE.TEXT },
    enabled: true,
    installedBy: READER,
    manageable: true,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

const GITHUB = {
  type: INSTALLED_SKILL_SOURCE.GITHUB,
  owner: "acme",
  repo: "agent-skills",
  path: "skills/release-notes",
  ref: "main",
  sha: SHA,
} as const;

function workspace(extra: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-stage",
    name: "Stage",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
    ...extra,
  };
}

test("the workspace's skills come before the account's own, by name, each with its source and a teammate's name", () => {
  const groups = skillGroups(
    [
      skill("zeta", INSTALLED_SKILL_SCOPE.PERSONAL),
      skill("triage", INSTALLED_SKILL_SCOPE.WORKSPACE, { installedBy: "user-dean" }),
      skill("release-notes", INSTALLED_SKILL_SCOPE.WORKSPACE, {
        installedBy: READER,
        source: GITHUB,
      }),
      skill("alpha", INSTALLED_SKILL_SCOPE.PERSONAL, { source: GITHUB }),
    ],
    READER,
    [{ userId: "user-dean", name: "Dean", email: "dean@example.com", role: WORKSPACE_ROLE.ADMIN }],
  );

  assert.deepEqual(
    groups.workspace.map((row) => [row.skill.name, row.source, row.line]),
    [
      ["release-notes", "workspace", "acme/agent-skills @ 3f9c2e1 · by you"],
      ["triage", "workspace", "Pasted · by Dean"],
    ],
  );
  assert.deepEqual(
    groups.personal.map((row) => [row.skill.name, row.source, row.line, row.fromGitHub]),
    [
      ["alpha", "personal", "acme/agent-skills @ 3f9c2e1", true],
      ["zeta", "personal", "Pasted", false],
    ],
  );
});

test("a workspace skill whose installer is gone or unknown names nobody", () => {
  const groups = skillGroups(
    [
      skill("gone", INSTALLED_SKILL_SCOPE.WORKSPACE, { installedBy: null }),
      skill("unknown", INSTALLED_SKILL_SCOPE.WORKSPACE, { installedBy: "user-left" }),
    ],
    READER,
    [],
  );

  assert.deepEqual(
    groups.workspace.map((row) => row.line),
    ["Pasted", "Pasted"],
  );
});

test("Everyone in the workspace is offered to every member, and never in a personal workspace", () => {
  const labels = (shown: Workspace) => installScopes(shown).map((each) => each.label);

  assert.deepEqual(labels(workspace()), ["Only you", "Everyone in Stage"]);
  assert.deepEqual(labels(workspace({ role: WORKSPACE_ROLE.ADMIN })), [
    "Only you",
    "Everyone in Stage",
  ]);
  assert.deepEqual(labels(workspace({ role: WORKSPACE_ROLE.OWNER })), [
    "Only you",
    "Everyone in Stage",
  ]);
  assert.deepEqual(labels(workspace({ role: WORKSPACE_ROLE.OWNER, personal: true })), ["Only you"]);
});

test("every failure is said in words, a refused skill named where the service named it", () => {
  for (const failure of Object.values(INSTALLED_SKILL_CALL_FAILURE)) {
    assert.notEqual(failureLine({ failure }), "");
  }
  assert.equal(
    failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.CREDENTIAL, skillName: "release-notes" }),
    "release-notes holds what looks like a credential. A skill must never carry one.",
  );
  assert.equal(
    failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN }),
    "This skill is already installed there. Remove it first, or install for the other scope.",
  );
});

/** The one row a skill draws, wherever its group puts it. */
function rowOf(one: InstalledSkillSummary) {
  const groups = skillGroups([one], READER, []);
  return [...groups.workspace, ...groups.personal][0] ?? assert.fail("no row");
}

test("a row's ⋯ holds View, Share for the account's own skill, and Update for a GitHub one, then Remove", () => {
  const own = rowOf(skill("pr-style", INSTALLED_SKILL_SCOPE.PERSONAL, { source: GITHUB }));
  const pasted = rowOf(skill("pr-style", INSTALLED_SKILL_SCOPE.PERSONAL));
  assert.deepEqual(skillActions(own, workspace()), [
    [SKILL_ACTION.VIEW, SKILL_ACTION.SHARE, SKILL_ACTION.UPDATE],
    [SKILL_ACTION.REMOVE],
  ]);
  assert.deepEqual(skillActions(pasted, workspace()), [
    [SKILL_ACTION.VIEW, SKILL_ACTION.SHARE],
    [SKILL_ACTION.REMOVE],
  ]);
});

test("Share is never offered for a workspace's skill or in a personal workspace", () => {
  const shared = rowOf(skill("release-notes", INSTALLED_SKILL_SCOPE.WORKSPACE));
  const own = rowOf(skill("pr-style", INSTALLED_SKILL_SCOPE.PERSONAL));
  assert.deepEqual(skillActions(shared, workspace()), [[SKILL_ACTION.VIEW], [SKILL_ACTION.REMOVE]]);
  assert.deepEqual(skillActions(own, workspace({ personal: true })), [
    [SKILL_ACTION.VIEW],
    [SKILL_ACTION.REMOVE],
  ]);
});

test("a skill the account may not change offers View alone, even from GitHub", () => {
  const locked = rowOf(
    skill("release-notes", INSTALLED_SKILL_SCOPE.WORKSPACE, { manageable: false, source: GITHUB }),
  );
  assert.deepEqual(skillActions(locked, workspace()), [[SKILL_ACTION.VIEW]]);
});

test("Share asks in plain words who gets the skill and that it leaves the account's own, and a taken name is said for the workspace", () => {
  assert.deepEqual(shareQuestion("grill-me", workspace()), {
    title: "Share grill-me with Stage?",
    body: "Everyone in Stage will get grill-me. It leaves your personal skills.",
    verb: "Share with workspace",
    running: "Sharing",
  });
  assert.equal(
    shareFailureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN }, "grill-me", workspace()),
    "Stage already has a skill named grill-me. Remove one of them first.",
  );
  assert.equal(
    shareFailureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED }, "grill-me", workspace()),
    "The service could not be reached. Try again.",
  );
});

test("View draws a skill's text in one fence nothing inside it can close, ending on its last line", () => {
  assert.equal(fencedSkillFile("# Grill me\n\n"), "```markdown\n# Grill me\n```");
  assert.equal(
    fencedSkillFile("Run:\n````sh\nnpm test\n````"),
    "`````markdown\nRun:\n````sh\nnpm test\n````\n`````",
  );
});

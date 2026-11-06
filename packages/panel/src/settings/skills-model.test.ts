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
  skillActions,
  skillGroups,
} from "./skills-model.js";

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
    groups.personal.map((row) => [row.skill.name, row.source, row.line]),
    [
      ["alpha", "personal", "acme/agent-skills @ 3f9c2e1"],
      ["zeta", "personal", "Pasted"],
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

function rowOf(one: InstalledSkillSummary) {
  const groups = skillGroups([one], READER, []);
  return [...groups.workspace, ...groups.personal][0] ?? assert.fail("no row");
}

test("a row's ⋯ holds View, then Remove, and View alone for a skill the account may not remove", () => {
  const own = rowOf(skill("pr-style", INSTALLED_SKILL_SCOPE.PERSONAL));
  const locked = rowOf(
    skill("release-notes", INSTALLED_SKILL_SCOPE.WORKSPACE, { manageable: false }),
  );
  assert.deepEqual(skillActions(own), [[SKILL_ACTION.VIEW], [SKILL_ACTION.REMOVE]]);
  assert.deepEqual(skillActions(locked), [[SKILL_ACTION.VIEW]]);
});

test("View draws a skill's text in one fence nothing inside it can close, ending on its last line", () => {
  assert.equal(fencedSkillFile("# Grill me\n\n"), "```markdown\n# Grill me\n```");
  assert.equal(
    fencedSkillFile("Run:\n````sh\nnpm test\n````"),
    "`````markdown\nRun:\n````sh\nnpm test\n````\n`````",
  );
});

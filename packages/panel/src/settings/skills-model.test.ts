import assert from "node:assert/strict";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  type InstalledSkillCandidate,
  type InstalledSkillPreview,
  type InstalledSkillSummary,
} from "@luke/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import { parseSkillPaste, SKILL_PASTE_KIND } from "@luke/features/skill-paste";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { test } from "vitest";
import {
  DETECTED_TONE,
  failureLine,
  initialTicks,
  installRequest,
  installScopes,
  pastedLine,
  previewLine,
  skillGroups,
} from "./skills-model.js";

/**
 * Settings › Skills judged without drawing: the workspace's skills before
 * the account's own, each saying where its files came from and who
 * installed it; the scopes the dialog offers by role and workspace; what
 * the box says at once and once the service previewed it; the skills
 * ticked as a preview lands; what an install sends; and every refusal said
 * in words that name the skill. Synthetic names and ids.
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

function candidate(
  name: string,
  extra: Partial<InstalledSkillCandidate> = {},
): InstalledSkillCandidate {
  return {
    name,
    path: `skills/${name}`,
    fileCount: 1,
    bytes: 400,
    selected: false,
    problems: [],
    ...extra,
  };
}

const SOURCE: InstalledSkillPreview = {
  kind: SKILL_PASTE_KIND.SOURCE,
  owner: "vercel-labs",
  repo: "agent-skills",
  ref: "main",
  sha: SHA,
  missing: [],
  skills: [
    candidate("web-design-guidelines", { selected: true }),
    candidate("react-best-practices"),
    candidate("leaky", { selected: true, problems: [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED] }),
  ],
};

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
    groups.workspace.map((row) => [row.skill.name, row.badge, row.line]),
    [
      ["release-notes", "Workspace", "acme/agent-skills @ 3f9c2e1 · by you"],
      ["triage", "Workspace", "pasted · by Dean"],
    ],
  );
  assert.deepEqual(
    groups.personal.map((row) => [row.skill.name, row.badge, row.line, row.fromGitHub]),
    [
      ["alpha", "Personal", "acme/agent-skills @ 3f9c2e1", true],
      ["zeta", "Personal", "pasted", false],
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
    ["pasted", "pasted"],
  );
});

test("Everyone in the workspace is offered to its owners and admins alone, and never in a personal workspace", () => {
  const labels = (shown: Workspace) => installScopes(shown).map((each) => each.label);

  assert.deepEqual(labels(workspace()), ["Just me"]);
  assert.deepEqual(labels(workspace({ role: WORKSPACE_ROLE.ADMIN })), [
    "Just me",
    "Everyone in Stage",
  ]);
  assert.deepEqual(labels(workspace({ role: WORKSPACE_ROLE.OWNER })), [
    "Just me",
    "Everyone in Stage",
  ]);
  assert.deepEqual(labels(workspace({ role: WORKSPACE_ROLE.OWNER, personal: true })), ["Just me"]);
});

test("the box says at once what it was read as, and a source on another host says only GitHub for now", () => {
  assert.equal(pastedLine(parseSkillPaste("   ")), undefined);
  assert.deepEqual(pastedLine(parseSkillPaste("npx skills add vercel-labs/agent-skills")), {
    text: "GitHub vercel-labs/agent-skills · Reading…",
    tone: DETECTED_TONE.WAITING,
  });
  assert.equal(
    pastedLine(parseSkillPaste("---\nname: pr-style\ndescription: How PRs read.\n---\n# PR style"))
      ?.text,
    "Skill text · pr-style · Reading…",
  );
  assert.deepEqual(pastedLine(parseSkillPaste("npx skills add https://gitlab.com/acme/skills")), {
    text: "Only GitHub sources for now.",
    tone: DETECTED_TONE.PROBLEM,
  });
});

test("the service's preview says how many skills the repository holds at which commit, or that it holds none", () => {
  assert.deepEqual(previewLine(SOURCE), {
    text: `Detected: 3 skills in vercel-labs/agent-skills @ 3f9c2e1`,
    tone: DETECTED_TONE.DETECTED,
  });
  assert.equal(previewLine({ ...SOURCE, skills: [] })?.tone, DETECTED_TONE.PROBLEM);
});

test("a preview ticks the skills the paste asked for, never one with problems", () => {
  assert.deepEqual([...initialTicks(SOURCE)], ["web-design-guidelines"]);
});

test("a source installs the ticked skills that may install, and nothing while none is ticked", () => {
  const state = {
    workspaceId: "workspace-stage",
    text: "npx skills add vercel-labs/agent-skills",
    scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
    preview: SOURCE,
    fill: { name: "", description: "" },
  };

  assert.deepEqual(
    installRequest({ ...state, ticked: new Set(["react-best-practices", "leaky"]) }),
    {
      text: state.text,
      workspaceId: state.workspaceId,
      scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
      skills: ["react-best-practices"],
    },
  );
  assert.equal(installRequest({ ...state, ticked: new Set(["leaky"]) }), undefined);
  assert.equal(installRequest({ ...state, preview: undefined, ticked: new Set() }), undefined);
});

test("text with no description installs once one is typed, and a typed name must follow the rule", () => {
  const preview: InstalledSkillPreview = {
    kind: SKILL_PASTE_KIND.TEXT,
    bytes: 40,
    problems: [INSTALLED_SKILL_PROBLEM.NAME_MISSING, INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING],
  };
  const state = {
    workspaceId: "workspace-stage",
    text: "Always lead with the change.",
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    preview,
    ticked: new Set<string>(),
  };

  assert.equal(
    installRequest({ ...state, fill: { name: "pr-style", description: "" } }),
    undefined,
  );
  assert.equal(
    installRequest({ ...state, fill: { name: "PR Style", description: "How PRs read." } }),
    undefined,
  );
  assert.deepEqual(
    installRequest({ ...state, fill: { name: " pr-style ", description: " How PRs read. " } }),
    {
      text: state.text,
      workspaceId: state.workspaceId,
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      name: "pr-style",
      description: "How PRs read.",
    },
  );
});

test("text that declares its own name and description sends neither, and one with a problem left installs nothing", () => {
  const state = {
    workspaceId: "workspace-stage",
    text: "---\nname: pr-style\ndescription: How PRs read.\n---\n",
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    ticked: new Set<string>(),
    fill: { name: "", description: "" },
  };
  const clean: InstalledSkillPreview = {
    kind: SKILL_PASTE_KIND.TEXT,
    name: "pr-style",
    description: "How PRs read.",
    bytes: 60,
    problems: [],
  };

  assert.deepEqual(installRequest({ ...state, preview: clean }), {
    text: state.text,
    workspaceId: state.workspaceId,
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
  });
  assert.equal(
    installRequest({
      ...state,
      preview: { ...clean, problems: [INSTALLED_SKILL_PROBLEM.CREDENTIAL_SHAPED] },
    }),
    undefined,
  );
});

test("every refusal is said in words, a taken name and refused files naming the skill", () => {
  for (const failure of Object.values(INSTALLED_SKILL_CALL_FAILURE)) {
    assert.notEqual(failureLine({ failure }), "");
  }
  for (const skillRefusal of Object.values(INSTALLED_SKILL_FILES_REFUSAL)) {
    assert.match(
      failureLine({
        failure: INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED,
        skillName: "release-notes",
        skillRefusal,
      }),
      /^release-notes /u,
    );
  }
  assert.match(
    failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.NAME_TAKEN, skillName: "release-notes" }),
    /A skill named release-notes is already installed/u,
  );
  assert.match(
    failureLine({
      failure: INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED,
      skillRefusal: "credential-shaped",
    }),
    /looks like a credential/u,
  );
});

import assert from "node:assert/strict";
import {
  INSTALLED_SKILL_FILES_REFUSAL,
  INSTALLED_SKILL_PROBLEM,
  INSTALLED_SKILL_STANDING,
  type InstalledSkillCandidate,
  type InstalledSkillPreview,
  type InstalledSkillSummary,
  SKILL_AUDIT_RISK,
} from "@luke/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@luke/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  type InstalledSkillScope,
} from "@luke/features/installed-skill-wire";
import { parseSkillPaste, SKILL_PASTE_KIND } from "@luke/features/skill-paste";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { STATUS_TONE } from "@luke/ui";
import { test } from "vitest";
import {
  ADD_SKILL_SCREEN,
  addSkillScreen,
  addSkillTitle,
  auditParts,
  candidateFacts,
  candidateMarks,
  candidateNote,
  confirmView,
  everyTicked,
  failureLine,
  fencedSkillFile,
  initialTicks,
  installLabel,
  installPlan,
  installRequest,
  installScopes,
  missingLine,
  pastedAtOnce,
  pastedLine,
  previewLine,
  previewSourceLine,
  SKILL_ACTION,
  shareFailureLine,
  shareQuestion,
  skillActions,
  skillGroups,
  skillList,
  textDeclares,
  textFill,
  withEvery,
  withTick,
} from "./skills-model.js";

/**
 * Settings › Skills judged without drawing: the workspace's skills before
 * the account's own, each saying where its files came from and who
 * installed it; the scopes the dialog offers by role and workspace; what
 * the box says at once; which screen a preview lands on, as `npx skills
 * add` chooses between confirming and picking; the skills a ticked one
 * pulls in and the unticks that keep them out; what is already installed
 * in the scope chosen; the marks, ratings, sorting, grouping, and search of
 * the list; what an install sends and the button says; every refusal said
 * in words that name the skill; what each row's ⋯ holds and what Share asks;
 * and what the page says once an install lands. Synthetic names and ids.
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

/** mattpocock/skills as its preview reads: grill-me named, handing off to grilling, which hands off to tdd. */
const MATT_SKILLS: readonly InstalledSkillCandidate[] = [
  candidate("grill-me", { selected: true, references: ["grilling"] }),
  candidate("grilling", { references: ["tdd", "grill-me"] }),
  candidate("tdd"),
  candidate("zoom-out"),
  candidate("caveman", { references: ["zoom-out"] }),
];

const MATT: InstalledSkillPreview = {
  kind: SKILL_PASTE_KIND.SOURCE,
  owner: "mattpocock",
  repo: "skills",
  ref: "main",
  sha: SHA,
  missing: [],
  skills: MATT_SKILLS,
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

test("the box says at once what it was read as, and a source on another host says only GitHub for now", () => {
  assert.equal(pastedLine(parseSkillPaste("   ")), undefined);
  assert.deepEqual(pastedLine(parseSkillPaste("npx skills add vercel-labs/agent-skills")), {
    text: "Reading vercel-labs/agent-skills…",
    tone: STATUS_TONE.NEUTRAL,
  });
  assert.equal(
    pastedLine(parseSkillPaste("---\nname: pr-style\ndescription: How PRs read.\n---\n# PR style"))
      ?.text,
    "Skill text · pr-style · Reading…",
  );
  assert.deepEqual(pastedLine(parseSkillPaste("npx skills add https://gitlab.com/acme/skills")), {
    text: "Only GitHub sources for now.",
    tone: STATUS_TONE.ATTENTION,
  });
});

test("a preview with skills says nothing under the box, and a repository with none says so", () => {
  assert.equal(previewLine(SOURCE), undefined);
  assert.deepEqual(previewLine({ ...SOURCE, skills: [] }), {
    text: "No skills found in vercel-labs/agent-skills @ 3f9c2e1.",
    tone: STATUS_TONE.ATTENTION,
  });
});

test("only a change that came at once, as a paste does, folds the box", () => {
  assert.equal(pastedAtOnce("", "npx skills add acme/skills"), true);
  assert.equal(pastedAtOnce("# PR styl", "# PR style"), false);
  assert.equal(pastedAtOnce("npx skills add acme/skills", ""), false);
});

test("a paste that named skills is confirmed as cards, as the skills tool's Selected N skills, and one that named none, every one, or one missing is browsed", () => {
  const named = parseSkillPaste(
    "npx skills add vercel-labs/agent-skills --skill web-design-guidelines",
  );
  const bare = parseSkillPaste("npx skills add vercel-labs/agent-skills");
  const every = parseSkillPaste("npx skills add vercel-labs/agent-skills --skill '*'");
  const none = {
    ...SOURCE,
    skills:
      SOURCE.kind === SKILL_PASTE_KIND.SOURCE
        ? SOURCE.skills.map((each) => ({ ...each, selected: false }))
        : [],
  };

  assert.equal(addSkillScreen(undefined, named, false), ADD_SKILL_SCREEN.PASTE);
  assert.equal(addSkillScreen({ ...SOURCE, skills: [] }, named, false), ADD_SKILL_SCREEN.PASTE);
  assert.equal(addSkillScreen(SOURCE, named, false), ADD_SKILL_SCREEN.CONFIRM);
  assert.equal(addSkillScreen(SOURCE, named, true), ADD_SKILL_SCREEN.BROWSE);
  assert.equal(addSkillScreen(none, bare, false), ADD_SKILL_SCREEN.BROWSE);
  assert.equal(addSkillScreen(SOURCE, every, false), ADD_SKILL_SCREEN.BROWSE);
  assert.equal(
    addSkillScreen({ ...SOURCE, missing: ["grill-mee"] }, named, false),
    ADD_SKILL_SCREEN.BROWSE,
  );
  assert.equal(
    addSkillScreen(
      { kind: SKILL_PASTE_KIND.TEXT, bytes: 10, problems: [] },
      parseSkillPaste("# x"),
      false,
    ),
    ADD_SKILL_SCREEN.TEXT,
  );
});

test("the title names the one skill confirmed or the repository browsed, and the folded line says where from", () => {
  assert.equal(addSkillTitle(ADD_SKILL_SCREEN.CONFIRM, MATT), "Add grill-me");
  assert.equal(addSkillTitle(ADD_SKILL_SCREEN.BROWSE, MATT), "Add skills from mattpocock/skills");
  assert.equal(addSkillTitle(ADD_SKILL_SCREEN.PASTE, undefined), "Add skill");
  assert.equal(
    previewSourceLine(ADD_SKILL_SCREEN.CONFIRM, MATT),
    "From mattpocock/skills @ 3f9c2e1",
  );
  assert.equal(
    previewSourceLine(ADD_SKILL_SCREEN.BROWSE, MATT),
    "mattpocock/skills @ 3f9c2e1 · 5 skills",
  );
  assert.equal(
    previewSourceLine(ADD_SKILL_SCREEN.TEXT, {
      kind: SKILL_PASTE_KIND.TEXT,
      bytes: 1229,
      problems: [],
    }),
    "Pasted text · 1.2 kB",
  );
  assert.equal(
    missingLine({ ...MATT, missing: ["grill-mee"] }),
    "No skill named grill-mee in mattpocock/skills. Pick from its 5 skills.",
  );
  assert.equal(missingLine(MATT), undefined);
});

test("a ticked skill pulls in the skills it hands off to, and theirs in turn, each by the skill that named it first", () => {
  const plan = installPlan(MATT_SKILLS, initialTicks(MATT), INSTALLED_SKILL_SCOPE.PERSONAL);

  assert.deepEqual(plan.install, ["grill-me", "grilling", "tdd"]);
  assert.deepEqual(
    [...plan.pulled],
    [
      ["grilling", "grill-me"],
      ["tdd", "grilling"],
    ],
  );
  assert.equal(installLabel(plan.install), "Install 3 skills");
  assert.deepEqual(confirmView(MATT_SKILLS, plan), {
    cards: [MATT_SKILLS[0]],
    pulled: [
      { candidate: MATT_SKILLS[1], by: "grill-me" },
      { candidate: MATT_SKILLS[2], by: "grilling" },
    ],
    others: 2,
  });
});

test("unticking a pulled-in skill keeps it and what only it pulled in out, and ticking it again brings them back", () => {
  const scope = INSTALLED_SKILL_SCOPE.PERSONAL;
  const declined = withTick(MATT_SKILLS, initialTicks(MATT), scope, "grilling", false);

  assert.deepEqual(installPlan(MATT_SKILLS, declined, scope).install, ["grill-me"]);
  assert.equal(installLabel(installPlan(MATT_SKILLS, declined, scope).install), "Install grill-me");
  const back = withTick(MATT_SKILLS, declined, scope, "grilling", true);
  assert.deepEqual(installPlan(MATT_SKILLS, back, scope).install, ["grill-me", "grilling", "tdd"]);
});

test("unticking the skill that pulled the others in takes them out too", () => {
  const scope = INSTALLED_SKILL_SCOPE.PERSONAL;
  const none = withTick(MATT_SKILLS, initialTicks(MATT), scope, "grill-me", false);

  assert.deepEqual(installPlan(MATT_SKILLS, none, scope).install, []);
  assert.equal(installLabel([]), "Install");
});

test("what is already installed in the scope chosen is neither sent nor counted, and is recomputed for the other scope", () => {
  const skills = [
    candidate("grill-me", { selected: true, references: ["grilling"] }),
    candidate("grilling", {
      installed: [
        {
          id: "a",
          scope: INSTALLED_SKILL_SCOPE.PERSONAL,
          standing: INSTALLED_SKILL_STANDING.CURRENT,
        },
      ],
    }),
    candidate("tdd", {
      installed: [
        {
          id: "b",
          scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
          standing: INSTALLED_SKILL_STANDING.UPDATE,
        },
      ],
    }),
    candidate("testing", {
      installed: [
        {
          id: "c",
          scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
          standing: INSTALLED_SKILL_STANDING.TAKEN,
        },
      ],
    }),
  ];
  const ticks = withEvery(
    skills,
    initialTicks({ ...MATT, skills }),
    INSTALLED_SKILL_SCOPE.PERSONAL,
    ["tdd", "testing"],
    true,
  );

  assert.deepEqual(installPlan(skills, ticks, INSTALLED_SKILL_SCOPE.PERSONAL).install, [
    "grill-me",
    "tdd",
    "testing",
  ]);
  assert.deepEqual(installPlan(skills, ticks, INSTALLED_SKILL_SCOPE.WORKSPACE).install, [
    "grill-me",
    "grilling",
  ]);
  const marks = (name: string, scope: InstalledSkillScope) =>
    candidateMarks(
      skills.find((each) => each.name === name) ?? assert.fail(name),
      scope,
      workspace(),
    ).map((mark) => mark.text);
  assert.deepEqual(marks("grilling", INSTALLED_SKILL_SCOPE.PERSONAL), ["Installed"]);
  assert.deepEqual(marks("grilling", INSTALLED_SKILL_SCOPE.WORKSPACE), []);
  assert.deepEqual(marks("tdd", INSTALLED_SKILL_SCOPE.WORKSPACE), ["Update available"]);
  assert.deepEqual(marks("testing", INSTALLED_SKILL_SCOPE.WORKSPACE), ["Name taken in Stage"]);
  assert.match(
    candidateNote(skills[2] ?? assert.fail(), INSTALLED_SKILL_SCOPE.WORKSPACE)?.text ?? "",
    /from the Skills page/u,
  );
});

test("a skill that ships scripts says so, and skills.sh's ratings read in the tool's order with high and critical marked", () => {
  const rated = candidate("grill-me", {
    hasScripts: true,
    audit: {
      snyk: { risk: SKILL_AUDIT_RISK.HIGH },
      zeta: { risk: SKILL_AUDIT_RISK.UNKNOWN },
      ath: { risk: SKILL_AUDIT_RISK.SAFE },
      socket: { risk: SKILL_AUDIT_RISK.LOW, alerts: 0 },
    },
  });

  assert.deepEqual(
    candidateMarks(rated, INSTALLED_SKILL_SCOPE.PERSONAL, workspace()).map((mark) => mark.text),
    ["scripts"],
  );
  assert.deepEqual(auditParts(rated), [
    { text: "Gen safe", warn: false },
    { text: "Socket low risk", warn: false },
    { text: "Snyk high risk", warn: true },
    { text: "zeta unrated", warn: false },
  ]);
  assert.deepEqual(auditParts(candidate("plain")), []);
  assert.equal(
    candidateFacts(candidate("plain", { fileCount: 2, bytes: 410 })),
    "2 files · 410 B · skills/plain",
  );
});

test("Select all ticks every skill shown that may install, and unticks them all once every one is", () => {
  const scope = INSTALLED_SKILL_SCOPE.PERSONAL;
  const shown = ["grill-me", "grilling", "tdd", "zoom-out"];
  const none = withTick(MATT_SKILLS, initialTicks(MATT), scope, "grill-me", false);

  assert.deepEqual(everyTicked(shown, []), { checked: false, mixed: false });
  assert.deepEqual(everyTicked(shown, ["tdd"]), { checked: false, mixed: true });
  const all = withEvery(MATT_SKILLS, none, scope, shown, true);
  const install = installPlan(MATT_SKILLS, all, scope).install;
  assert.deepEqual(everyTicked(shown, install), { checked: true, mixed: false });
  const cleared = withEvery(MATT_SKILLS, all, scope, shown, false);
  assert.deepEqual(installPlan(MATT_SKILLS, cleared, scope).install, []);
});

test("Select all ticks each skill it shows itself, so one another pulls in stays when that other is unticked", () => {
  const scope = INSTALLED_SKILL_SCOPE.PERSONAL;
  const none = withTick(MATT_SKILLS, initialTicks(MATT), scope, "grill-me", false);
  const all = withEvery(MATT_SKILLS, none, scope, ["grill-me", "grilling", "tdd"], true);

  const left = withTick(MATT_SKILLS, all, scope, "grill-me", false);
  assert.deepEqual(installPlan(MATT_SKILLS, left, scope).install, ["grilling", "tdd"]);
});

test("the browse list sorts by name, groups only where the repository's plugins group any with the rest under Other last, and searches names and descriptions", () => {
  const plain = skillList(MATT_SKILLS, "");
  assert.deepEqual(
    plain.map((group) => [group.title, group.skills.map((each) => each.name)]),
    [[undefined, ["caveman", "grill-me", "grilling", "tdd", "zoom-out"]]],
  );

  const grouped = [
    candidate("tdd", { group: "engineering" }),
    candidate("caveman"),
    candidate("code-review", { group: "engineering" }),
    candidate("grill-me", { group: "productivity", description: "Sharpen a plan" }),
  ];
  assert.deepEqual(
    skillList(grouped, "").map((group) => [group.title, group.skills.map((each) => each.name)]),
    [
      ["engineering", ["code-review", "tdd"]],
      ["productivity", ["grill-me"]],
      ["Other", ["caveman"]],
    ],
  );
  assert.deepEqual(
    skillList(grouped, "PLAN").map((group) => [group.title, group.skills.map((each) => each.name)]),
    [["productivity", ["grill-me"]]],
  );
  assert.deepEqual(skillList(grouped, "nothing like it"), []);
  // Each word may land in a different line: the name holds one, the description the other.
  assert.deepEqual(
    skillList(grouped, "grill plan").map((group) => group.skills.map((each) => each.name)),
    [["grill-me"]],
  );
  assert.deepEqual(skillList(grouped, "grill nothing"), []);
});

test("a source installs what the plan installs, and nothing while it installs nothing", () => {
  const state = {
    workspaceId: "workspace-stage",
    text: "npx skills add vercel-labs/agent-skills",
    scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
    preview: SOURCE,
    fill: { name: "", description: "" },
    declares: { name: false, description: false },
  };

  assert.deepEqual(
    installRequest({ ...state, install: ["web-design-guidelines", "react-best-practices"] }),
    {
      text: state.text,
      workspaceId: state.workspaceId,
      scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
      skills: ["web-design-guidelines", "react-best-practices"],
    },
  );
  assert.equal(installRequest({ ...state, install: [] }), undefined);
  assert.equal(installRequest({ ...state, preview: undefined, install: ["leaky"] }), undefined);
});

test("a preview ticks the skills the paste asked for, never one with problems", () => {
  assert.deepEqual([...initialTicks(SOURCE).ticked], ["web-design-guidelines"]);
});

test("text with no frontmatter suggests its name from its heading, both fields the member's, and installs once both follow the rules", () => {
  const text = "# PR style\n\nAlways lead with the change.";
  const paste = parseSkillPaste(text);
  const preview: InstalledSkillPreview = {
    kind: SKILL_PASTE_KIND.TEXT,
    name: "pr-style",
    bytes: 40,
    problems: [INSTALLED_SKILL_PROBLEM.DESCRIPTION_MISSING],
  };
  const declares = textDeclares(paste);
  const state = {
    workspaceId: "workspace-stage",
    text,
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    preview,
    install: [],
    declares,
  };

  assert.deepEqual(declares, { name: false, description: false });
  assert.deepEqual(textFill(preview), { name: "pr-style", description: "" });
  assert.equal(
    installRequest({ ...state, fill: { name: "pr-style", description: "" } }),
    undefined,
  );
  assert.equal(
    installRequest({ ...state, fill: { name: "PR Style", description: "How PRs read." } }),
    undefined,
  );
  assert.equal(
    installRequest({ ...state, fill: { name: "pr-style", description: "x".repeat(1025) } }),
    undefined,
  );
  assert.deepEqual(
    installRequest({ ...state, fill: { name: " pr-notes ", description: " How PRs read. " } }),
    {
      text,
      workspaceId: state.workspaceId,
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      name: "pr-notes",
      description: "How PRs read.",
    },
  );
});

test("text that declares its own name and description sends neither, since the service refuses one that contradicts them, and one with a problem left installs nothing", () => {
  const text = "---\nname: pr-style\ndescription: How PRs read.\n---\n";
  const clean: InstalledSkillPreview = {
    kind: SKILL_PASTE_KIND.TEXT,
    name: "pr-style",
    description: "How PRs read.",
    bytes: 60,
    problems: [],
  };
  const state = {
    workspaceId: "workspace-stage",
    text,
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    install: [],
    fill: textFill(clean),
    declares: textDeclares(parseSkillPaste(text)),
  };

  assert.deepEqual(state.declares, { name: true, description: true });
  assert.deepEqual(installRequest({ ...state, preview: clean }), {
    text,
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

/** The one row a skill draws, wherever its group puts it. */
function rowOf(one: InstalledSkillSummary) {
  const groups = skillGroups([one], READER, []);
  return [...groups.workspace, ...groups.personal][0] ?? assert.fail("no row");
}

test("a row's ⋯ holds View, Share for the account's own skill, and Update where one is out, then Remove", () => {
  const own = rowOf(skill("pr-style", INSTALLED_SKILL_SCOPE.PERSONAL, { source: GITHUB }));
  assert.deepEqual(skillActions(own, { workspace: workspace(), updateAvailable: true }), [
    [SKILL_ACTION.VIEW, SKILL_ACTION.SHARE, SKILL_ACTION.UPDATE],
    [SKILL_ACTION.REMOVE],
  ]);
  assert.deepEqual(skillActions(own, { workspace: workspace(), updateAvailable: false }), [
    [SKILL_ACTION.VIEW, SKILL_ACTION.SHARE],
    [SKILL_ACTION.REMOVE],
  ]);
});

test("Share is never offered for a workspace's skill or in a personal workspace", () => {
  const shared = rowOf(skill("release-notes", INSTALLED_SKILL_SCOPE.WORKSPACE));
  const own = rowOf(skill("pr-style", INSTALLED_SKILL_SCOPE.PERSONAL));
  assert.deepEqual(skillActions(shared, { workspace: workspace(), updateAvailable: false }), [
    [SKILL_ACTION.VIEW],
    [SKILL_ACTION.REMOVE],
  ]);
  assert.deepEqual(
    skillActions(own, { workspace: workspace({ personal: true }), updateAvailable: false }),
    [[SKILL_ACTION.VIEW], [SKILL_ACTION.REMOVE]],
  );
});

test("a skill the account may not change offers View alone, even with an update out", () => {
  const locked = rowOf(
    skill("release-notes", INSTALLED_SKILL_SCOPE.WORKSPACE, { manageable: false, source: GITHUB }),
  );
  assert.deepEqual(skillActions(locked, { workspace: workspace(), updateAvailable: true }), [
    [SKILL_ACTION.VIEW],
  ]);
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

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RUN_ORIGIN } from "./identifiers.js";
import {
  buildSystemPrompt,
  gatherPromptFacts,
  PROMPT_DIAGNOSTIC,
  PROMPT_PROFILE,
  PROMPT_SECTION,
  type PromptFacts,
} from "./prompt.js";
import {
  BUILTIN_CONTEXT_ENGINE,
  BUILTIN_MODEL_ADAPTER,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  defaultAgentConfiguration,
  TOOL_LOOP_RUNTIME,
} from "./registry.js";
import {
  BOOTSTRAP_BOUNDS,
  boundBootstrapFiles,
  seedWorkspace,
  WORKSPACE_FILE,
  type WorkspaceFile,
  type WorkspaceSeeds,
} from "./workspace.js";

/** Seeds for these tests alone: the runtime knows the files, never their words. */
const testSeed = (name: WorkspaceFile) => `# ${name}\n\nseeded for the test\n`;
const TEST_SEEDS: WorkspaceSeeds = {
  [WORKSPACE_FILE.AGENTS]: testSeed(WORKSPACE_FILE.AGENTS),
  [WORKSPACE_FILE.IDENTITY]: testSeed(WORKSPACE_FILE.IDENTITY),
  [WORKSPACE_FILE.USER]: testSeed(WORKSPACE_FILE.USER),
  [WORKSPACE_FILE.MEMORY]: testSeed(WORKSPACE_FILE.MEMORY),
  [WORKSPACE_FILE.BOOTSTRAP]: testSeed(WORKSPACE_FILE.BOOTSTRAP),
};

const FILES = boundBootstrapFiles([
  { name: WORKSPACE_FILE.AGENTS, path: "/w/AGENTS.md", content: "# AGENTS.md\n\nBe brief." },
  { name: WORKSPACE_FILE.IDENTITY, path: "/w/IDENTITY.md", content: "Name: Luke" },
  { name: WORKSPACE_FILE.USER, path: "/w/USER.md", content: "Prefers tests." },
  { name: WORKSPACE_FILE.BOOTSTRAP, path: "/w/BOOTSTRAP.md", content: undefined },
  { name: WORKSPACE_FILE.MEMORY, path: "/w/MEMORY.md", content: "Remember the deploy." },
]);

function facts(overrides: Partial<PromptFacts> = {}): PromptFacts {
  return {
    profile: PROMPT_PROFILE.FULL,
    identity: "You are the agent under test.",
    persona: "Witty and warm.",
    tools: [
      { name: "list_sessions", groups: ["read"] },
      { name: "read_transcript", groups: ["read"] },
      { name: "announce", groups: ["speak"] },
    ],
    toolNotes: ["The turns.", "An ask is the developer speaking."],
    runtimeContextMarker: "[context]",
    skills: [
      {
        id: "deploy",
        name: "deploy",
        description: "Ship a release",
        location: "/skills/deploy/SKILL.md",
        enabled: true,
        agents: [],
      },
    ],
    workspaceDirectory: "/w",
    bootstrapFiles: FILES,
    runtime: { agentId: "main", runtimeId: "tool-loop", model: "m" },
    ...overrides,
  };
}

test("the full profile emits every section in order, files injected, skills listed by location, boundary before the dynamic tail", () => {
  const built = buildSystemPrompt(
    facts({ executionDirectory: { path: "/repo", instructions: "Run pnpm." } }),
  );
  assert.deepEqual(
    built.sections.map((section) => section.id),
    [
      PROMPT_SECTION.IDENTITY,
      PROMPT_SECTION.PERSONA,
      PROMPT_SECTION.TOOLING,
      PROMPT_SECTION.TOOL_NOTES,
      PROMPT_SECTION.SAFETY,
      PROMPT_SECTION.RUNTIME_CONTEXT,
      PROMPT_SECTION.SKILLS,
      PROMPT_SECTION.MEMORY,
      PROMPT_SECTION.WORKSPACE,
      PROMPT_SECTION.WORKSPACE_FILES,
      PROMPT_SECTION.EXECUTION_DIRECTORY,
      PROMPT_SECTION.RUNTIME,
    ],
  );
  assert.equal(built.text, `${built.stablePrefix}\n\n${built.dynamicSuffix}`);
  assert.equal(built.chars, built.text.length);
  // The absent BOOTSTRAP.md is the ordinary state after setup, not a diagnostic.
  assert.deepEqual(
    built.diagnostics.map((diagnostic) => diagnostic.kind),
    [PROMPT_DIAGNOSTIC.SKILL_LISTED],
  );
});

test("the stable prefix is byte-identical across turns whose dynamic facts differ", () => {
  const first = buildSystemPrompt(facts({ runtime: { agentId: "main", runtimeId: "tool-loop" } }));
  const second = buildSystemPrompt(
    facts({
      runtime: { agentId: "main", runtimeId: "tool-loop" },
      executionDirectory: { path: "/elsewhere" },
    }),
  );
  assert.equal(first.stablePrefix, second.stablePrefix);
  assert.notEqual(first.dynamicSuffix, second.dynamicSuffix);
});

test("the minimal profile carries AGENTS.md alone and no persona, identity, user, or memory file", () => {
  const built = buildSystemPrompt(facts({ profile: PROMPT_PROFILE.MINIMAL }));
  assert.ok(!built.sections.some((section) => section.id === PROMPT_SECTION.MEMORY));
  assert.ok(!built.sections.some((section) => section.id === PROMPT_SECTION.PERSONA));
  assert.ok(
    built.diagnostics.some(
      (diagnostic) =>
        diagnostic.kind === PROMPT_DIAGNOSTIC.SECTION_OMITTED &&
        diagnostic.subject === PROMPT_SECTION.PERSONA,
    ),
  );
  assert.ok(built.sections.some((section) => section.id === PROMPT_SECTION.SAFETY));
  assert.ok(built.sections.some((section) => section.id === PROMPT_SECTION.SKILLS));
  assert.ok(
    built.diagnostics.some(
      (diagnostic) =>
        diagnostic.kind === PROMPT_DIAGNOSTIC.SECTION_OMITTED &&
        diagnostic.subject === PROMPT_SECTION.MEMORY,
    ),
  );
});

test("a truncated or missing file is named in the notice and the diagnostics", () => {
  const perFile = BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;
  const bounded = boundBootstrapFiles([
    { name: WORKSPACE_FILE.AGENTS, path: "/w/AGENTS.md", content: "a".repeat(perFile + 50) },
    { name: WORKSPACE_FILE.IDENTITY, path: "/w/IDENTITY.md", content: undefined },
  ]);
  const built = buildSystemPrompt(facts({ bootstrapFiles: bounded, skills: [] }));
  assert.deepEqual(
    built.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.subject]),
    [
      [PROMPT_DIAGNOSTIC.FILE_TRUNCATED, WORKSPACE_FILE.AGENTS],
      [PROMPT_DIAGNOSTIC.FILE_MISSING, WORKSPACE_FILE.IDENTITY],
    ],
  );
});

test("gathering reads the workspace under the configuration, lists eligible skills, and a child reads AGENTS.md alone", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "luke-prompt-"));
  const workspace = path.join(root, "workspace");
  const skills = path.join(root, "skills");
  await seedWorkspace(workspace, TEST_SEEDS);
  await fs.mkdir(path.join(skills, "deploy"), { recursive: true });
  await fs.writeFile(
    path.join(skills, "deploy", "SKILL.md"),
    "---\nname: deploy\ndescription: Ship a release\n---\n# Deploy\n",
  );
  await fs.mkdir(path.join(skills, "secret"), { recursive: true });
  await fs.writeFile(
    path.join(skills, "secret", "SKILL.md"),
    "---\nname: secret\nagents: [other]\n---\n",
  );
  await fs.mkdir(path.join(skills, "off"), { recursive: true });
  await fs.writeFile(path.join(skills, "off", "SKILL.md"), "---\nname: off\nenabled: false\n---\n");
  const store = new ConfigurationStore(
    defaultAgentConfiguration({
      agentRuntimeId: TOOL_LOOP_RUNTIME.ID,
      modelAdapterId: BUILTIN_MODEL_ADAPTER.HOSTED,
      contextEngineId: BUILTIN_CONTEXT_ENGINE.RESPONSES,
      credential: { kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT },
      workspaceDirectory: workspace,
      skillRoots: [skills],
    }),
  );
  const common = {
    configuration: store.snapshot(),
    identity: "You are the agent under test.",
    persona: "Witty and warm.",
    tools: [],
    toolNotes: [],
    runtimeContextMarker: "[context]",
    runtimeId: TOOL_LOOP_RUNTIME.ID,
  };
  const full = await gatherPromptFacts({ ...common, run: { origin: RUN_ORIGIN.USER } });
  assert.deepEqual(
    full.skills.map((skill) => skill.name),
    ["deploy"],
  );
  assert.equal(full.bootstrapFiles.length, 5);
  assert.ok(full.bootstrapFiles.every((file) => !file.missing));
  const child = await gatherPromptFacts({
    ...common,
    run: { origin: RUN_ORIGIN.USER, child: { depth: 1 } },
  });
  assert.deepEqual(
    child.bootstrapFiles.map((file) => file.name),
    [WORKSPACE_FILE.AGENTS],
  );
  const built = buildSystemPrompt(child);
  assert.equal(built.profile, PROMPT_PROFILE.MINIMAL);
});

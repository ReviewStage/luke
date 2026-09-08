import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RUN_ORIGIN } from "@sidecar/runtime-contracts";
import {
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  defaultAgentConfiguration,
} from "./configuration.js";
import {
  buildSystemPrompt,
  PROMPT_DIAGNOSTIC,
  PROMPT_PROFILE,
  PROMPT_SECTION,
  type PromptFacts,
} from "./prompt.js";
import { createRuntimeRegistries } from "./registry.js";
import { gatherPromptFacts, promptProfileFor } from "./runtime-facts.js";
import { boundBootstrapFiles, seedWorkspace, WORKSPACE_FILE } from "./workspace.js";

const FILES = boundBootstrapFiles([
  { name: WORKSPACE_FILE.AGENTS, path: "/w/AGENTS.md", content: "# AGENTS.md\n\nBe brief." },
  { name: WORKSPACE_FILE.SOUL, path: "/w/SOUL.md", content: "# SOUL.md\n\nDry wit." },
  { name: WORKSPACE_FILE.IDENTITY, path: "/w/IDENTITY.md", content: "Name: Luke" },
  { name: WORKSPACE_FILE.USER, path: "/w/USER.md", content: "Prefers tests." },
  { name: WORKSPACE_FILE.BOOTSTRAP, path: "/w/BOOTSTRAP.md", content: undefined },
  { name: WORKSPACE_FILE.MEMORY, path: "/w/MEMORY.md", content: "Remember the deploy." },
]);

function facts(overrides: Partial<PromptFacts> = {}): PromptFacts {
  return {
    profile: PROMPT_PROFILE.FULL,
    tools: [
      { name: "list_sessions", description: "the roster", parameters: {} },
      { name: "announce", description: "a briefing", parameters: {} },
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
    runtime: { agentId: "main", origin: RUN_ORIGIN.USER, runtimeId: "tool-loop", model: "m" },
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
  assert.ok(built.stablePrefix.includes("## SOUL.md\n\n# SOUL.md\n\nDry wit."));
  assert.ok(built.stablePrefix.includes("<location>/skills/deploy/SKILL.md</location>"));
  assert.ok(built.stablePrefix.includes("- announce: a briefing"));
  assert.ok(!built.stablePrefix.includes("Run pnpm."));
  assert.ok(built.dynamicSuffix.includes("Run pnpm."));
  assert.ok(built.dynamicSuffix.includes("run origin: user"));
  assert.equal(built.text, `${built.stablePrefix}\n\n${built.dynamicSuffix}`);
  assert.equal(built.chars, built.text.length);
  // The absent BOOTSTRAP.md is the ordinary state after setup, not a diagnostic.
  assert.deepEqual(
    built.diagnostics.map((diagnostic) => diagnostic.kind),
    [PROMPT_DIAGNOSTIC.SKILL_LISTED],
  );
});

test("the stable prefix is byte-identical across turns whose dynamic facts differ", () => {
  const first = buildSystemPrompt(
    facts({ runtime: { agentId: "main", origin: RUN_ORIGIN.USER, runtimeId: "tool-loop" } }),
  );
  const second = buildSystemPrompt(
    facts({
      runtime: { agentId: "main", origin: RUN_ORIGIN.OBSERVATION, runtimeId: "tool-loop" },
      executionDirectory: { path: "/elsewhere" },
    }),
  );
  assert.equal(first.stablePrefix, second.stablePrefix);
  assert.notEqual(first.dynamicSuffix, second.dynamicSuffix);
});

test("the minimal profile carries AGENTS.md alone and no persona, identity, user, or memory file", () => {
  const built = buildSystemPrompt(facts({ profile: PROMPT_PROFILE.MINIMAL }));
  assert.ok(built.text.includes("Be brief."));
  for (const absent of ["Dry wit.", "Name: Luke", "Prefers tests.", "Remember the deploy."]) {
    assert.ok(!built.text.includes(absent), absent);
  }
  assert.ok(!built.sections.some((section) => section.id === PROMPT_SECTION.MEMORY));
  assert.ok(built.sections.some((section) => section.id === PROMPT_SECTION.SAFETY));
  assert.ok(built.sections.some((section) => section.id === PROMPT_SECTION.SKILLS));
  assert.ok(
    built.diagnostics.some(
      (diagnostic) =>
        diagnostic.kind === PROMPT_DIAGNOSTIC.SECTION_OMITTED &&
        diagnostic.subject === PROMPT_SECTION.MEMORY,
    ),
  );
  const none = buildSystemPrompt(facts({ profile: PROMPT_PROFILE.NONE }));
  assert.equal(none.sections.length, 1);
  assert.equal(none.dynamicSuffix, "");
});

test("a truncated or missing file is named in the notice and the diagnostics", () => {
  const bounded = boundBootstrapFiles(
    [
      { name: WORKSPACE_FILE.AGENTS, path: "/w/AGENTS.md", content: "a".repeat(50) },
      { name: WORKSPACE_FILE.SOUL, path: "/w/SOUL.md", content: undefined },
    ],
    { maximumCharsPerFile: 10, maximumTotalChars: 100 },
  );
  const built = buildSystemPrompt(facts({ bootstrapFiles: bounded, skills: [] }));
  const notice = built.sections.find((section) => section.id === PROMPT_SECTION.BOOTSTRAP_NOTICE);
  assert.ok(notice?.text.includes("AGENTS.md: 10 of 50 characters shown"));
  assert.ok(notice?.text.includes("Read the affected file directly"));
  assert.deepEqual(
    built.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.subject]),
    [
      [PROMPT_DIAGNOSTIC.FILE_TRUNCATED, WORKSPACE_FILE.AGENTS],
      [PROMPT_DIAGNOSTIC.FILE_MISSING, WORKSPACE_FILE.SOUL],
    ],
  );
});

test("profiles follow the run: ordinary and heartbeat runs are full, a child is minimal", () => {
  assert.equal(promptProfileFor({ origin: RUN_ORIGIN.USER }), PROMPT_PROFILE.FULL);
  assert.equal(promptProfileFor({ origin: RUN_ORIGIN.OBSERVATION }), PROMPT_PROFILE.FULL);
  assert.equal(promptProfileFor({ origin: RUN_ORIGIN.HEARTBEAT }), PROMPT_PROFILE.FULL);
  assert.equal(
    promptProfileFor({ origin: RUN_ORIGIN.USER, child: { depth: 1 } }),
    PROMPT_PROFILE.MINIMAL,
  );
});

test("gathering reads the workspace under the configuration, lists eligible skills, and a child reads AGENTS.md alone", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "luke-prompt-"));
  const workspace = path.join(root, "workspace");
  const skills = path.join(root, "skills");
  await seedWorkspace(workspace);
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
  const registries = createRuntimeRegistries();
  registries.agentRuntimes.register({
    id: "loop",
    itemFormat: { format: "f", version: 1 },
    create: () => {
      throw new Error("unused");
    },
  });
  registries.contextEngines.register({
    id: "engine",
    itemFormat: { format: "f", version: 1 },
    create: () => {
      throw new Error("unused");
    },
    checkpointFormatFor: () => ({
      runtime: "loop",
      runtimeVersion: 1,
      format: "f",
      formatVersion: 1,
    }),
  });
  registries.modelAdapters.register({
    id: "adapter",
    itemFormat: { format: "f", version: 1 },
    credentialKind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT,
    fixedToolCatalog: true,
  });
  const store = new ConfigurationStore(
    registries,
    defaultAgentConfiguration({
      agentRuntimeId: "loop",
      modelAdapterId: "adapter",
      contextEngineId: "engine",
      credential: { kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT },
      workspaceDirectory: workspace,
      skillRoots: [skills],
    }),
  );
  const common = {
    configuration: store.snapshot(),
    tools: [],
    toolNotes: [],
    runtimeContextMarker: "[context]",
    runtimeId: "loop",
  };
  const full = await gatherPromptFacts({ ...common, run: { origin: RUN_ORIGIN.USER } });
  assert.deepEqual(
    full.skills.map((skill) => skill.name),
    ["deploy"],
  );
  assert.equal(full.bootstrapFiles.length, 6);
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
  assert.ok(built.text.includes("Operating instructions for Luke's own agent"));
  assert.ok(!built.text.includes("# IDENTITY.md"));
});

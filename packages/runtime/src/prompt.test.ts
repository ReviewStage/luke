import assert from "node:assert/strict";
import { test } from "vitest";
import { buildSystemPrompt, PROMPT_PROFILE, type PromptFacts } from "./prompt.js";
import {
  BOOTSTRAP_BOUNDS,
  boundBootstrapFiles,
  CURATED_FILE_BUDGET,
  WORKSPACE_FILE,
} from "./workspace.js";

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
    toolNotes: ["The turns.", "An ask is the developer speaking."],
    runtimeContextMarker: "[context]",
    workspaceDirectory: "/w",
    bootstrapFiles: FILES,
    runtime: { agentId: "main", runtimeId: "tool-loop", model: "m" },
    ...overrides,
  };
}

test("the full profile opens on the identity, injects the files, and ends on the runtime line", () => {
  const built = buildSystemPrompt(facts());
  assert.ok(built.text.startsWith("# Identity\n\nYou are the agent under test."));
  assert.ok(built.text.includes("Prefers tests."));
  assert.ok(built.text.endsWith("# Runtime\n\nagent: main\nruntime: tool-loop\nmodel: m"));
  assert.equal(built.chars, built.text.length);
});

test("the stable sections are byte-identical across turns whose dynamic facts differ", () => {
  const first = buildSystemPrompt(facts({ runtime: { agentId: "main", runtimeId: "tool-loop" } }));
  const second = buildSystemPrompt(
    facts({ runtime: { agentId: "main", runtimeId: "tool-loop", model: "other" } }),
  );
  const stable = (text: string) => text.slice(0, text.lastIndexOf("# Runtime"));
  assert.equal(stable(first.text), stable(second.text));
  assert.notEqual(first.text, second.text);
});

test("the minimal profile carries AGENTS.md alone and no persona, identity, user, or memory file", () => {
  const built = buildSystemPrompt(facts({ profile: PROMPT_PROFILE.MINIMAL }));
  assert.ok(!built.text.includes("# Persona"));
  assert.ok(!built.text.includes("Prefers tests."));
  assert.ok(built.text.includes("Be brief."));
});

test("a truncated file is named in the notice, a curated file at its own budget", () => {
  const perFile = BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;
  const budget = CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY];
  const bounded = boundBootstrapFiles([
    { name: WORKSPACE_FILE.AGENTS, path: "/w/AGENTS.md", content: "a".repeat(perFile + 50) },
    { name: WORKSPACE_FILE.IDENTITY, path: "/w/IDENTITY.md", content: undefined },
    { name: WORKSPACE_FILE.MEMORY, path: "/w/MEMORY.md", content: "m".repeat(budget + 50) },
  ]);
  const built = buildSystemPrompt(facts({ bootstrapFiles: bounded }));
  assert.ok(built.text.includes(`- MEMORY.md: ${budget} of ${budget + 50} characters shown`));
  assert.ok(built.text.includes(`- AGENTS.md: ${perFile} of ${perFile + 50} characters shown`));
  assert.ok(built.text.includes(`[truncated: ${budget + 50} characters on disk]`));
});

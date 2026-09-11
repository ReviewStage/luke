import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { RUN_ORIGIN } from "./identifiers.js";
import { gatherPromptFactsEffect } from "./prompt.effect.js";
import {
  BUILTIN_CONTEXT_ENGINE,
  BUILTIN_MODEL_ADAPTER,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  defaultAgentConfiguration,
  TOOL_LOOP_RUNTIME,
} from "./registry.js";
import {
  seedWorkspace,
  WORKSPACE_FILE,
  type WorkspaceFile,
  type WorkspaceSeeds,
} from "./workspace.js";

const testSeed = (name: WorkspaceFile) => `# ${name}\n\nseeded for the test\n`;
const TEST_SEEDS: WorkspaceSeeds = {
  [WORKSPACE_FILE.AGENTS]: testSeed(WORKSPACE_FILE.AGENTS),
  [WORKSPACE_FILE.IDENTITY]: testSeed(WORKSPACE_FILE.IDENTITY),
  [WORKSPACE_FILE.USER]: testSeed(WORKSPACE_FILE.USER),
  [WORKSPACE_FILE.MEMORY]: testSeed(WORKSPACE_FILE.MEMORY),
  [WORKSPACE_FILE.BOOTSTRAP]: testSeed(WORKSPACE_FILE.BOOTSTRAP),
};

describe("gatherPromptFactsEffect", () => {
  it.effect("gathers the seeded bootstrap files and the eligible skills", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(path.join(os.tmpdir(), "luke-prompt-effect-")),
      );
      const workspace = path.join(root, "workspace");
      const skills = path.join(root, "skills");
      yield* Effect.promise(() => seedWorkspace(workspace, TEST_SEEDS));
      yield* Effect.promise(() => fs.mkdir(path.join(skills, "deploy"), { recursive: true }));
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(skills, "deploy", "SKILL.md"),
          "---\nname: deploy\ndescription: Ship a release\n---\n# Deploy\n",
        ),
      );
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

      const full = yield* gatherPromptFactsEffect({
        configuration: store.snapshot(),
        identity: "You are the agent under test.",
        tools: [],
        toolNotes: [],
        runtimeContextMarker: "[context]",
        runtimeId: TOOL_LOOP_RUNTIME.ID,
        run: { origin: RUN_ORIGIN.USER },
      });

      assert.deepEqual(
        full.skills.map((skill) => skill.name),
        ["deploy"],
      );
      assert.equal(full.bootstrapFiles.length, 5);
      assert.ok(full.bootstrapFiles.every((file) => !file.missing));

      const child = yield* gatherPromptFactsEffect({
        configuration: store.snapshot(),
        identity: "You are the agent under test.",
        tools: [],
        toolNotes: [],
        runtimeContextMarker: "[context]",
        runtimeId: TOOL_LOOP_RUNTIME.ID,
        run: { origin: RUN_ORIGIN.USER, child: { depth: 1 } },
      });

      assert.deepEqual(
        child.bootstrapFiles.map((file) => file.name),
        [WORKSPACE_FILE.AGENTS],
      );
    }),
  );
});

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { AGENT_ROLE, type AgentRole } from "../server/hosted/agent-runtime/role";
import { AGENT_TOOL, TOOL_ROLES, toolsOf } from "../server/hosted/agent-runtime/tools";
import { planningToolDeclarations } from "../server/hosted/brain-host/planning";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";

/**
 * The one tool registry against what each root really offers: the planning
 * root's hosted resolver and its authored files, and the store writer's sets,
 * so a tool added in one place and not the other fails here rather than in a
 * turn. The coding agent's files are held to the registry beside its other
 * tool tests (`coder-agent.test.ts`).
 */

/** The planning root's authored tool files, by the name each mounts its tool under, beside the hosted resolver's own file. */
const PLANNING_TOOL_FILES = readdirSync(join(import.meta.dirname, "..", "eve", "tools"))
  .filter((file) => file.endsWith(".ts") && file !== "brain.ts")
  .map((file) => file.slice(0, -".ts".length));

const HOSTED = new Set(planningToolDeclarations().map((declared) => declared.name));

test("the planner is offered exactly its registry tools: the hosted resolver's and its authored files, and its worker the hosted reads its role lists", () => {
  assert.deepEqual(
    [...HOSTED, ...PLANNING_TOOL_FILES].sort(),
    [...toolsOf(AGENT_ROLE.PLANNER)].sort(),
  );
  for (const tool of toolsOf(AGENT_ROLE.PLANNER_WORKER)) assert.ok(HOSTED.has(tool), tool);
});

test("every tool serves a role, and each role's rows are held to a set that names every tool it is offered", () => {
  for (const tool of Object.values(AGENT_TOOL)) {
    const roles: readonly AgentRole[] = TOOL_ROLES[tool];
    assert.ok(roles.length > 0, tool);
  }
  const heldBy = {
    [AGENT_ROLE.PLANNER]: HOSTED_TOOL_SET,
    [AGENT_ROLE.PLANNER_WORKER]: HOSTED_TOOL_SET,
    [AGENT_ROLE.CODER]: CODER_TOOL_SET,
    [AGENT_ROLE.CODER_WORKER]: CODER_TOOL_SET,
  } as const;
  for (const role of Object.values(AGENT_ROLE)) {
    for (const tool of toolsOf(role))
      assert.ok(heldBy[role][tool] !== undefined, `${role}: ${tool}`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_EFFECT, TOOL_EXECUTION, type ToolDescriptor } from "./registry.js";
import {
  CHILD_DEPTH_CAP,
  CHILD_TOOL_EXCLUSIONS,
  resolveToolPolicy,
  TOOL_POLICY_LAYER,
  TOOL_POLICY_ORDER,
} from "./tool-policy.js";

function tool(id: string, groups: readonly string[]): ToolDescriptor {
  return {
    id,
    schema: { name: id, description: id, parameters: {} },
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups,
  };
}

const CATALOG: readonly ToolDescriptor[] = [
  tool("list_sessions", ["read"]),
  tool("read_transcript", ["read"]),
  tool("send_session_message", ["acts", "session"]),
  tool("open_session", ["acts", "session"]),
  tool("announce", ["speak"]),
  tool("sessions_spawn", ["delegation"]),
  tool("conversations_list", ["admin"]),
  tool("message", ["admin"]),
];

const names = (policy: ReturnType<typeof resolveToolPolicy>) =>
  policy.allowed.map((entry) => entry.id);

test("no layers offer the whole catalog in order", () => {
  const policy = resolveToolPolicy(CATALOG, {});
  assert.deepEqual(
    names(policy),
    CATALOG.map((entry) => entry.id),
  );
  assert.deepEqual(policy.denied, []);
});

test("layers apply in the pinned order, allow narrows, deny wins, and groups expand", () => {
  assert.deepEqual(TOOL_POLICY_ORDER, ["global", "agent", "provider", "session", "child"]);
  const policy = resolveToolPolicy(CATALOG, {
    global: { deny: ["message"] },
    agent: { allow: ["group:read", "group:acts", "announce", "conversations_*"] },
    provider: { deny: ["open_session"] },
    session: { deny: ["announce"] },
  });
  assert.deepEqual(names(policy), [
    "list_sessions",
    "read_transcript",
    "send_session_message",
    "conversations_list",
  ]);
  assert.deepEqual(policy.denied, [
    { tool: "message", layer: TOOL_POLICY_LAYER.GLOBAL },
    { tool: "sessions_spawn", layer: TOOL_POLICY_LAYER.AGENT },
    { tool: "open_session", layer: TOOL_POLICY_LAYER.PROVIDER },
    { tool: "announce", layer: TOOL_POLICY_LAYER.SESSION },
  ]);
  assert.ok(policy.allows("send_session_message"));
  assert.ok(!policy.allows("open_session"));
  assert.ok(!policy.allows("not_a_tool"));
});

test("a later allow cannot restore what an earlier layer denied", () => {
  const policy = resolveToolPolicy(CATALOG, {
    global: { deny: ["group:acts"] },
    agent: { allow: ["send_session_message", "list_sessions"] },
  });
  assert.deepEqual(names(policy), ["list_sessions"]);
});

test("a child loses the fixed exclusions after every configured layer, and the delegation tools at the depth cap", () => {
  const below = resolveToolPolicy(
    CATALOG,
    { agent: { allow: ["sessions_spawn", "conversations_list", "message", "list_sessions"] } },
    { depth: 1 },
  );
  assert.deepEqual(names(below), ["list_sessions", "sessions_spawn"]);
  assert.ok(below.denied.some((denial) => denial.tool === "message" && denial.layer === "child"));
  const capped = resolveToolPolicy(CATALOG, {}, { depth: CHILD_DEPTH_CAP });
  assert.ok(!capped.allows("sessions_spawn"));
  assert.ok(!capped.allows("conversations_list"));
  assert.ok(capped.allows("send_session_message"));
  assert.deepEqual(CHILD_TOOL_EXCLUSIONS.AT_DEPTH_CAP, [
    "subagents",
    "sessions_list",
    "sessions_history",
    "sessions_spawn",
  ]);
});

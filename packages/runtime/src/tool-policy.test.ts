import assert from "node:assert/strict";
import { test } from "vitest";
import { TOOL_EFFECT, TOOL_EXECUTION, type ToolDescriptor } from "./registry.js";
import { resolveToolPolicy, TOOL_POLICY_LAYER } from "./tool-policy.js";

function tool(name: string, groups: readonly string[]): ToolDescriptor {
  return {
    schema: { name, description: name, parameters: {} },
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups,
  };
}

const CATALOG: readonly ToolDescriptor[] = [
  tool("list_sessions", ["read"]),
  tool("read_transcript", ["read"]),
  tool("send_session_message", ["actions", "session"]),
  tool("open_session", ["actions", "session"]),
  tool("announce", ["speak"]),
  tool("sessions_spawn", ["delegation"]),
  tool("conversations_list", ["admin"]),
  tool("message", ["admin"]),
];

const names = (policy: ReturnType<typeof resolveToolPolicy>) =>
  policy.allowed.map((entry) => entry.schema.name);

test("no layers offer the whole catalog in order", () => {
  const policy = resolveToolPolicy(CATALOG, {});
  assert.deepEqual(
    names(policy),
    CATALOG.map((entry) => entry.schema.name),
  );
  assert.deepEqual(policy.denied, []);
});

test("layers apply in the pinned order, allow narrows, deny wins, and groups expand", () => {
  const policy = resolveToolPolicy(CATALOG, {
    global: { deny: ["message"] },
    agent: { allow: ["group:read", "group:actions", "announce", "conversations_*"] },
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

test("the turn's own layer applies last, after every configured layer, and names itself in the denial", () => {
  const policy = resolveToolPolicy(
    CATALOG,
    { agent: { allow: ["group:read", "announce"] } },
    {
      deny: ["announce"],
    },
  );
  assert.deepEqual(names(policy), ["list_sessions", "read_transcript"]);
  assert.equal(policy.deniedBy("announce"), TOOL_POLICY_LAYER.TURN);
  assert.equal(policy.deniedBy("send_session_message"), TOOL_POLICY_LAYER.AGENT);
  assert.equal(policy.deniedBy("list_sessions"), undefined);
  assert.equal(policy.deniedBy("not_a_tool"), undefined);
  // A configured deny of the same tool is the layer named, not the turn's.
  const configured = resolveToolPolicy(
    CATALOG,
    { session: { deny: ["announce"] } },
    {
      deny: ["announce"],
    },
  );
  assert.equal(configured.deniedBy("announce"), TOOL_POLICY_LAYER.SESSION);
  assert.deepEqual(configured.denied, [{ tool: "announce", layer: TOOL_POLICY_LAYER.SESSION }]);
});

test("a later allow cannot restore what an earlier layer denied", () => {
  const policy = resolveToolPolicy(CATALOG, {
    global: { deny: ["group:actions"] },
    agent: { allow: ["send_session_message", "list_sessions"] },
  });
  assert.deepEqual(names(policy), ["list_sessions"]);
});

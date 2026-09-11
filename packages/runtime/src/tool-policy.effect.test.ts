import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { TOOL_EFFECT, TOOL_EXECUTION, type ToolDescriptor } from "./registry.js";
import { requireAllowed, resolvePolicy, TOOL_CALL_REFUSAL } from "./tool-policy.effect.js";
import { TOOL_POLICY_LAYER } from "./tool-policy.js";

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
  tool("send_session_message", ["actions"]),
  tool("message", ["admin"]),
];

describe("resolvePolicy", () => {
  it.effect("answers the same effective policy the port computes", () =>
    Effect.gen(function* () {
      const policy = yield* resolvePolicy(CATALOG, { global: { deny: ["message"] } });

      assert.deepEqual(
        policy.allowed.map((entry) => entry.schema.name),
        ["list_sessions", "send_session_message"],
      );
      assert.deepEqual(policy.denied, [{ tool: "message", layer: TOOL_POLICY_LAYER.GLOBAL }]);
    }),
  );
});

describe("requireAllowed", () => {
  it.effect("answers the tool descriptor on the right when the policy allows the call", () =>
    Effect.gen(function* () {
      const policy = yield* resolvePolicy(CATALOG, {});
      const result = requireAllowed(policy, CATALOG, "list_sessions");

      assert.ok(Either.isRight(result));
      assert.equal(result.right.schema.name, "list_sessions");
    }),
  );

  it.effect("refuses a name outside the catalog as uncataloged", () =>
    Effect.gen(function* () {
      const policy = yield* resolvePolicy(CATALOG, {});
      const result = requireAllowed(policy, CATALOG, "not_a_tool");

      assert.ok(Either.isLeft(result));
      assert.equal(result.left._tag, "ToolCallRefused");
      assert.equal(result.left.code, TOOL_CALL_REFUSAL.UNCATALOGED);
      assert.equal(result.left.tool, "not_a_tool");
      assert.equal(result.left.layer, undefined);
    }),
  );

  it.effect("refuses a catalog name a layer denied, naming the layer", () =>
    Effect.gen(function* () {
      const policy = yield* resolvePolicy(CATALOG, { global: { deny: ["message"] } });
      const result = requireAllowed(policy, CATALOG, "message");

      assert.ok(Either.isLeft(result));
      assert.equal(result.left.code, TOOL_CALL_REFUSAL.DENIED);
      assert.equal(result.left.tool, "message");
      assert.equal(result.left.layer, TOOL_POLICY_LAYER.GLOBAL);
    }),
  );
});

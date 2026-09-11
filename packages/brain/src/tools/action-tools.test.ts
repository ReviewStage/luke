import assert from "node:assert/strict";
import {
  ACTION_KIND,
  ACTION_OUTPUT_STATUS,
  ACTION_REFUSAL,
  ACTIONS,
  acceptedActionOutput,
  type ValidatedAction,
} from "@sidecar/actions";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import { normalizeSession, SESSION_STATUS } from "@sidecar/session";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { test } from "vitest";
import { ACTION_TOOLS, type ActionToolContext, actionToolNamed } from "./action-tools.js";

const NOW = 1_800_000_000_000;

const observed = normalizeSession(
  { id: "claude-code", displayName: "Claude Code" },
  {
    providerSessionId: "abc",
    title: "Claude Code: abc",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
    advertises: [{ kind: ACTION_KIND.MESSAGE }],
  },
);

const MESSAGE_INPUT = { provider_id: "claude-code", provider_session_id: "abc", text: "go" };

/** A turn's standing over a roster of one session, whose carrier records what it was handed. */
function context(revoked: () => boolean = () => false) {
  const carried: ValidatedAction[] = [];
  const rosterReads: number[] = [];
  const ctx: ActionToolContext = {
    conversationId: MAIN_SESSION_KEY,
    turnId: "run-1",
    runId: "run-1",
    origin: RUN_ORIGIN.USER,
    isRevoked: revoked,
    signal: new AbortController().signal,
    admission: {
      roster: {
        read: async () => {
          rosterReads.push(rosterReads.length + 1);
          return [observed];
        },
      },
    },
    carry: async (action) => {
      carried.push(action);
      return acceptedActionOutput();
    },
  };
  return { ctx, carried, rosterReads };
}

test("every row of the actions table is a module, in the table's order, the notebook's two writes among them", () => {
  const rows = Object.values(ACTIONS);
  assert.deepEqual(
    ACTION_TOOLS.map((tool) => [tool.name, tool.kind, tool.family]),
    rows.map((spec) => [spec.name, spec.kind, spec.family]),
  );
  for (const [index, tool] of ACTION_TOOLS.entries()) {
    const request = rows[index]?.request;
    assert.ok(request);
    assert.deepEqual(tool.inputSchema.jsonSchema(), emitJsonSchema(request));
    assert.equal(actionToolNamed(tool.name), tool);
  }
  assert.equal(actionToolNamed("remember_fact")?.kind, ACTION_KIND.REMEMBER);
  assert.equal(actionToolNamed("forget_fact")?.kind, ACTION_KIND.FORGET);
  assert.equal(actionToolNamed("delete_everything"), undefined);
});

test("execute admits over the roster admission reads for itself, then carries what admission minted", async () => {
  const tool = actionToolNamed("send_session_message");
  assert.ok(tool);
  const { ctx, carried, rosterReads } = context();
  const output = await tool.execute(MESSAGE_INPUT, ctx);
  assert.equal(output.status, ACTION_OUTPUT_STATUS.ACCEPTED);
  assert.deepEqual(rosterReads, [1]);
  assert.deepEqual(carried, [
    {
      kind: ACTION_KIND.MESSAGE,
      identity: { providerId: "claude-code", providerSessionId: "abc" },
      text: "go",
      origin: RUN_ORIGIN.USER,
    },
  ]);
});

test("a call admission refuses carries nothing, and a standing already revoked reads no roster at all", async () => {
  const tool = actionToolNamed("send_session_message");
  assert.ok(tool);
  const stranger = context();
  const refused = await tool.execute(
    { ...MESSAGE_INPUT, provider_session_id: "ghost" },
    stranger.ctx,
  );
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(stranger.carried, []);
  assert.deepEqual(stranger.rosterReads, [1]);

  const over = context(() => true);
  const late = await tool.execute(MESSAGE_INPUT, over.ctx);
  assert.deepEqual(late, {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: ACTION_REFUSAL.TURN_OVER,
  });
  assert.deepEqual(over.carried, []);
  assert.deepEqual(over.rosterReads, []);
});

test("a standing revoked while admission read the roster refuses before the carrier, with the same word", async () => {
  const tool = actionToolNamed("send_session_message");
  assert.ok(tool);
  let revoked = false;
  const { ctx, carried } = context(() => revoked);
  const reading = {
    ...ctx,
    admission: {
      roster: {
        read: async () => {
          revoked = true;
          return [observed];
        },
      },
    },
  };
  const late = await tool.execute(MESSAGE_INPUT, reading);
  assert.deepEqual(late, {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: ACTION_REFUSAL.TURN_OVER,
  });
  assert.deepEqual(carried, []);
});

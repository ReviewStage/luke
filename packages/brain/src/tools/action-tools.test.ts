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
import {
  normalizeSession,
  type ObservedWorkspaceProject,
  SESSION_STATUS,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect } from "effect";
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

const PROJECT: ObservedWorkspaceProject = {
  providerId: "conductor",
  providerName: "Conductor",
  providerProjectId: "proj-1",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

/** A turn's standing over a roster of one session and one project, whose carrier records what it was handed. */
function context(revoked: () => boolean = () => false) {
  const carried: ValidatedAction[] = [];
  const carriedFields: WireRecord[] = [];
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
        read: () =>
          Effect.sync(() => {
            rosterReads.push(rosterReads.length + 1);
            return [observed];
          }),
      },
      projects: {
        read: () => Effect.succeed([PROJECT]),
        defaults: () => Effect.succeed({}),
        agentModels: () => [
          { agent: "codex", models: [{ id: "gpt-5.4", label: "GPT-5.4" }], efforts: ["high"] },
        ],
      },
    },
    carry: (action, fields) =>
      Effect.sync(() => {
        carried.push(action);
        carriedFields.push(fields);
        return acceptedActionOutput();
      }),
  };
  return { ctx, carried, carriedFields, rosterReads };
}

test("every row of the actions table is a module, in the table's order", () => {
  const rows = Object.values(ACTIONS);
  assert.deepEqual(
    ACTION_TOOLS.map((tool) => [tool.name, tool.kind, tool.family]),
    rows.map((spec) => [spec.name, spec.kind, spec.family]),
  );
  for (const [index, tool] of ACTION_TOOLS.entries()) {
    const request = rows[index]?.request;
    assert.ok(request);
    assert.deepEqual(emitJsonSchema(tool.inputSchema), emitJsonSchema(request));
    assert.equal(actionToolNamed(tool.name), tool);
  }
  assert.equal(actionToolNamed("send_session_message")?.kind, ACTION_KIND.MESSAGE);
  assert.equal(actionToolNamed("delete_everything"), undefined);
});

test("execute admits over the roster admission reads for itself, then carries what admission minted", async () => {
  const tool = actionToolNamed("send_session_message");
  assert.ok(tool);
  const { ctx, carried, rosterReads } = context();
  const output = await Effect.runPromise(tool.execute(MESSAGE_INPUT, ctx));
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

test("a creation is cut to the fields its tool declares before admission, so a model the call added never rides", async () => {
  const tool = actionToolNamed("create_workspace");
  assert.ok(tool);
  const { ctx, carried, carriedFields } = context();
  // Every key the model wrote beside the declaration is dropped: a codex model
  // at high effort that admission would otherwise resolve, and an agent kind.
  const output = await Effect.runPromise(
    tool.execute(
      {
        provider_id: "conductor",
        project_id: "proj-1",
        name: "Checkout",
        agent: "codex",
        model: "gpt-5.4",
        effort: "high",
      },
      ctx,
    ),
  );
  assert.equal(output.status, ACTION_OUTPUT_STATUS.ACCEPTED);
  assert.deepEqual(carried, [
    {
      kind: ACTION_KIND.CREATE_WORKSPACE,
      providerId: "conductor",
      providerProjectId: "proj-1",
      name: "Checkout",
      origin: RUN_ORIGIN.USER,
    },
  ]);
  assert.deepEqual(carriedFields, [
    { provider_id: "conductor", project_id: "proj-1", name: "Checkout" },
  ]);
});

test("a call admission refuses carries nothing, and a standing already revoked reads no roster at all", async () => {
  const tool = actionToolNamed("send_session_message");
  assert.ok(tool);
  const stranger = context();
  const refused = await Effect.runPromise(
    tool.execute({ ...MESSAGE_INPUT, provider_session_id: "ghost" }, stranger.ctx),
  );
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(stranger.carried, []);
  assert.deepEqual(stranger.rosterReads, [1]);

  const over = context(() => true);
  const late = await Effect.runPromise(tool.execute(MESSAGE_INPUT, over.ctx));
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
        read: () =>
          Effect.sync(() => {
            revoked = true;
            return [observed];
          }),
      },
    },
  };
  const late = await Effect.runPromise(tool.execute(MESSAGE_INPUT, reading));
  assert.deepEqual(late, {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason: ACTION_REFUSAL.TURN_OVER,
  });
  assert.deepEqual(carried, []);
});

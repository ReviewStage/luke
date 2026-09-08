import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL } from "@sidecar/acts";
import { TOOL_POLICY_LAYER } from "@sidecar/runtime";
import { RUN_ORIGIN, type ToolInvocation } from "@sidecar/runtime-contracts";
import { ACT_RESULT_STATUS, isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { BrainJournal } from "./journal.js";
import {
  createTurnToolExecutor,
  journaledEffect,
  refusalForPolicy,
  type ToolExecutorDependencies,
  type ToolExecutorTurn,
} from "./tool-executor.js";
import { BRAIN_TOOL, brainToolCatalog, resolveTurnToolPolicy } from "./tools.js";
import {
  BRAIN_TURN_TRIGGER,
  type BrainTurnTrigger,
  REFUSAL_REASON,
  type TurnContext,
} from "./turn.js";

/**
 * The executor alone, over a policy and a journal and nothing else: the
 * agent's own tests drive it through a whole turn, and these pin the gate
 * it keeps at the door of every dispatch.
 */

const CATALOG = brainToolCatalog();

/** The arguments a test's model emits, well formed or not: the executor's parsing is what is under test. */
type EmittedArguments = Readonly<Record<string, string | number | null>>;

function call(name: string, args: EmittedArguments, callId = `call-${name}`): ToolInvocation {
  return { callId, name, argumentsJson: JSON.stringify(args) };
}

function parsed(outputJson: string) {
  // SAFETY: the executor answers JSON.stringify output; the record check is the validation.
  const value = JSON.parse(outputJson) as UnparsedWireValue;
  assert.ok(isRecord(value));
  return value;
}

function executor(trigger: BrainTurnTrigger = BRAIN_TURN_TRIGGER.WAKE) {
  const policy = resolveTurnToolPolicy(CATALOG, {}, trigger);
  const journal = new BrainJournal();
  const written: [string, string][] = [];
  const checkpoints: number[] = [];
  const run = {
    runId: "run-1",
    generation: { journal, abort: new AbortController() },
    recorded: true,
    abort: new AbortController(),
    cancelled: false,
    timedOut: false,
    checkpointFailed: false,
    performedActs: 0,
    unknownActs: 0,
  };
  // SAFETY: the executor reads the generation's journal and the run's controls; nothing else of the turn context.
  const context = {
    generation: run.generation,
    run,
    signal: run.abort.signal,
  } as unknown as TurnContext;
  const dependencies: ToolExecutorDependencies = {
    roster: () => ({ text: "roster", identities: [] }),
    acts: { perform: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) },
    children: undefined,
    workspace: {
      read: async (name) => ({ ok: true, content: `content of ${name}` }),
      write: async (name, content) => {
        written.push([name, content]);
        return { ok: true, chars: content.length };
      },
      loadSkill: async () => ({ ok: true, instructions: "do it", truncated: false }),
    },
    readWhole: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED, transcript: "whole" }),
    checkpoint: async () => {
      checkpoints.push(journal.entries().length);
      return true;
    },
    runRevoked: () => false,
    now: () => 1_800_000_000_000,
  };
  const turn: ToolExecutorTurn = {
    policy,
    context,
    execution: {
      runId: run.runId,
      origin: RUN_ORIGIN.OBSERVATION,
      isRevoked: () => false,
      signal: run.abort.signal,
    },
    onBriefing: () => undefined,
  };
  const tools = createTurnToolExecutor(dependencies, turn);
  return {
    policy,
    journal,
    written,
    checkpoints,
    execute: async (invocation: ToolInvocation) =>
      parsed(
        (
          await tools.execute(invocation, {
            runId: run.runId,
            signal: run.abort.signal,
            isRevoked: () => false,
          })
        ).outputJson,
      ),
  };
}

test("a workspace write with a missing or non-string argument is refused before anything is journaled, and the file is untouched", async () => {
  const h = executor();
  const malformed: readonly EmittedArguments[] = [
    { name: "MEMORY.md" },
    { content: "words" },
    { name: 7, content: "words" },
    { name: "MEMORY.md", content: null },
  ];
  for (const args of malformed) {
    const output = await h.execute(call(BRAIN_TOOL.WRITE_WORKSPACE_FILE, args));
    assert.equal(output.status, ACT_RESULT_STATUS.REJECTED);
    assert.equal(output.reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
  }
  assert.deepEqual(h.written, []);
  assert.deepEqual(h.journal.entries(), []);
  assert.deepEqual(h.checkpoints, []);
  for (const [name, args] of [
    [BRAIN_TOOL.READ_WORKSPACE_FILE, {}],
    [BRAIN_TOOL.LOAD_SKILL, { location: 3 }],
  ] as const) {
    const output = await h.execute(call(name, args));
    assert.equal(output.reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
  }

  const written = await h.execute(
    call(BRAIN_TOOL.WRITE_WORKSPACE_FILE, { name: "MEMORY.md", content: "# MEMORY.md\n" }),
  );
  assert.equal(written.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(h.written, [["MEMORY.md", "# MEMORY.md\n"]]);
  // The write went through the journal: started and checkpointed before the effect, settled after.
  assert.deepEqual(h.checkpoints, [1]);
  assert.equal(h.journal.entries().length, 1);
});

test("the refusal names the policy's own answer: the turn layer for announce in an ask, no such tool for a name outside the catalog, and not allowed otherwise", async () => {
  const ask = resolveTurnToolPolicy(CATALOG, {}, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(ask.deniedBy(BRAIN_TOOL.ANNOUNCE), TOOL_POLICY_LAYER.TURN);
  assert.equal(refusalForPolicy(ask, BRAIN_TOOL.ANNOUNCE)?.reason, REFUSAL_REASON.ANNOUNCE_IN_ASK);
  assert.equal(refusalForPolicy(ask, "delete_everything")?.reason, REFUSAL_REASON.NOT_OFFERED);
  assert.equal(refusalForPolicy(ask, BRAIN_TOOL.LIST_SESSIONS), undefined);

  const configured = resolveTurnToolPolicy(
    CATALOG,
    { agent: { deny: [BRAIN_TOOL.ANNOUNCE, REALTIME_TOOL.SEND_SESSION_MESSAGE] } },
    BRAIN_TURN_TRIGGER.ASK,
  );
  // A configured deny is not the turn's: the model is told the policy, not to reply in text.
  assert.equal(
    refusalForPolicy(configured, BRAIN_TOOL.ANNOUNCE)?.reason,
    REFUSAL_REASON.NOT_ALLOWED,
  );
  assert.equal(
    refusalForPolicy(configured, REALTIME_TOOL.SEND_SESSION_MESSAGE)?.reason,
    REFUSAL_REASON.NOT_ALLOWED,
  );

  const h = executor(BRAIN_TURN_TRIGGER.ASK);
  const refused = await h.execute(call(BRAIN_TOOL.ANNOUNCE, { briefing: "words" }));
  assert.equal(refused.reason, REFUSAL_REASON.ANNOUNCE_IN_ASK);
  assert.deepEqual(h.journal.entries(), []);
});

test("an effect is journaled by what the catalog says the tool is: every act and the workspace write, never a read or the briefing", () => {
  const wake = resolveTurnToolPolicy(CATALOG, {}, BRAIN_TURN_TRIGGER.WAKE);
  assert.ok(journaledEffect(wake, REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(journaledEffect(wake, BRAIN_TOOL.WRITE_WORKSPACE_FILE));
  assert.ok(!journaledEffect(wake, BRAIN_TOOL.READ_WORKSPACE_FILE));
  assert.ok(!journaledEffect(wake, BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(!journaledEffect(wake, BRAIN_TOOL.ANNOUNCE));
  assert.ok(!journaledEffect(wake, "not_a_tool"));
  // A tool the policy removed is refused, not journaled.
  const noActs = resolveTurnToolPolicy(CATALOG, { agent: { deny: ["group:acts"] } });
  assert.ok(!journaledEffect(noActs, REALTIME_TOOL.SEND_SESSION_MESSAGE));
});

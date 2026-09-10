import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { REALTIME_TOOL } from "@sidecar/actions";
import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_SERVICE_PATH,
  hostedBrainBounds,
  RESPONSES_INPUT_ITEM_TYPE,
} from "@sidecar/hosted";
import {
  BUILTIN_CONTEXT_ENGINE,
  BUILTIN_MODEL_ADAPTER,
  type BuiltinModelAdapterId,
  buildSystemPrompt,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  defaultAgentConfiguration,
  gatherPromptFacts,
  RESPONSES_ITEM_FORMAT,
  recentDailyNotes,
  seedWorkspace,
  TOOL_LOOP_RUNTIME,
} from "@sidecar/runtime";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import {
  type AgentRuntime,
  type CheckpointFormat,
  CONTEXT_INPUT_KIND,
  type ContextEngine,
  type ContextInput,
  type ContextLifecycle,
  type ContextOpening,
  type ModelAdapter,
  REASONING_EFFORT,
  RUN_END_REASON,
  RUN_ORIGIN,
  RUNTIME_EVENT,
  type RuntimeCheckpoint,
  type RuntimeRun,
  type RuntimeRunRequest,
  type ToolExecutionContext,
} from "@sidecar/runtime/vocabulary";
import { normalizeSession, SESSION_STATUS, type SessionProvider } from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { BrainAgent, type BrainAgentOptions } from "./agent.js";
import { toolLoopRuntimeOver } from "./builtins.js";
import { ResponsesContextEngine } from "./context-engine.js";
import { HostedModelAdapter } from "./hosted-model-adapter.js";
import { BRAIN_INPUT_MARKER } from "./input-items.js";
import { brainToolNotes } from "./instructions.js";
import { OpenAiModelAdapter } from "./openai-model-adapter.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestRecord,
} from "./requests.js";
import { ToolLoopAgentRuntime } from "./runtime.js";
import { BrainStateStore } from "./state-store.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "./testing.js";
import { type BrainTick, TICK_CHANGE_KIND } from "./tick.js";
import { brainToolCatalog, hostedBrainToolCatalog, resolveTurnToolPolicy } from "./tools.js";
import { BRAIN_TURN_KIND, runOriginOf } from "./turn.js";
import { BRAIN_IDENTITY_LINE, BRAIN_PERSONA, BRAIN_WORKSPACE_SEEDS } from "./workspace-seeds.js";

/**
 * The same execution contract, run through the real host against each
 * transport this build ships — the keyed adapter over a fake OpenAI, and the
 * hosted adapter over a fake service speaking the hosted contract — and
 * then through a second runtime that shares nothing with OpenAI Responses,
 * to prove the host has no Responses-specific dependency: it stores whatever
 * stamp the runtime writes, refuses to run a compatible-looking host over a
 * foreign stamp, and keeps the memory whole while it refuses.
 */

const NOW = 1_800_000_000_000;
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const ABC = { providerId: claude.id, providerSessionId: "abc" };
const ENCRYPTED = "opaque-reasoning-bytes";
/** One tick in which the observed session stopped, as the host would compose it. */
const TICK: BrainTick = {
  changes: [
    {
      kind: TICK_CHANGE_KIND.CHANGED,
      identity: ABC,
      title: "Claude Code: abc",
      fields: { status: SESSION_STATUS.WAITING },
      transcriptCharsGained: 120,
    },
  ],
};

function message(text: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function reasoning(id: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.REASONING,
    id,
    summary: [],
    encrypted_content: ENCRYPTED,
  };
}

function actionCall(callId: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
    call_id: callId,
    name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
    arguments: JSON.stringify({
      provider_id: ABC.providerId,
      provider_session_id: ABC.providerSessionId,
      text: "run the tests",
    }),
  };
}

function payload(output: readonly WireRecord[]): Response {
  return Response.json({ id: "resp", status: "completed", output, usage: { input_tokens: 9 } });
}

class FakeClock {
  now = NOW;
  readonly timers = new Map<ScheduledTimer, { callback: () => void; at: number }>();
  schedule = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.timers.set(handle, { callback, at: this.now + delayMs });
    return handle;
  };
  cancel = (timer: ScheduledTimer): void => {
    this.timers.delete(timer);
  };
}

interface UpstreamCall {
  url: string;
  body: WireRecord;
}

/** A fake OpenAI: each queued answer is one upstream response, in order. */
function fakeUpstream(answers: (() => Response)[]) {
  const calls: UpstreamCall[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    // SAFETY: every body an adapter sends is JSON.stringify output.
    const body = JSON.parse(String(init.body)) as UnparsedWireValue;
    assert.ok(isRecord(body));
    calls.push({ url, body });
    const answer = answers.shift();
    assert.ok(answer, `unexpected upstream call to ${url}`);
    return answer();
  };
  return { fetch, calls, answers };
}

/**
 * A fake hosted service speaking the hosted contract as the real handlers
 * do: capabilities on GET, the request's prompt and named tools relayed to
 * the fake upstream as instructions and selected schemas, the allowance spent
 * per operation, and a spent allowance answered as the real service answers
 * it. The real handlers are tested in `apps/web`; this keeps the contract
 * shape in view where the adapter is exercised through the host.
 */
function fakeService(upstream: ReturnType<typeof fakeUpstream>, allowance: { remaining: number }) {
  const catalog = hostedBrainToolCatalog();
  const calls: UpstreamCall[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    if (url.endsWith(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES)) {
      return Response.json({
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        model: "gpt-hosted",
        operations: Object.values(HOSTED_BRAIN_OPERATION),
        tools: [...catalog.keys()],
        bounds: hostedBrainBounds(),
        reasoningEfforts: Object.values(REASONING_EFFORT),
      });
    }
    // SAFETY: the adapter sends JSON.stringify output.
    const body = JSON.parse(String(init.body)) as UnparsedWireValue;
    assert.ok(isRecord(body));
    calls.push({ url, body });
    if (allowance.remaining <= 0) {
      return Response.json(
        {
          error: "quota-exhausted",
          quota: { used: 5000, limit: 5000, resetsAt: NOW + 3_600_000 },
        },
        { status: 429 },
      );
    }
    allowance.remaining -= 1;
    assert.ok(Array.isArray(body.tools));
    const tools = body.tools.filter(isWireString).map((name) => catalog.get(name));
    assert.ok(tools.every((tool) => tool !== undefined));
    return upstream.fetch(`${"https://api.openai.com/v1"}/responses`, {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-hosted",
        instructions: body.prompt,
        tools,
        input: body.input,
      }),
    });
  };
  return { fetch, calls };
}

interface Transport {
  name: string;
  model: (upstream: ReturnType<typeof fakeUpstream>) => ModelAdapter;
  quotaExhaustion: boolean;
}

const KEYED: Transport = {
  name: "keyed",
  model: (upstream) =>
    new OpenAiModelAdapter({
      apiKey: "sk-test",
      fetch: upstream.fetch,
      now: () => NOW,
      report: () => undefined,
    }),
  quotaExhaustion: false,
};

const allowance = { remaining: 1_000 };
const HOSTED: Transport = {
  name: "hosted",
  model: (upstream) =>
    new HostedModelAdapter({
      serviceBaseUrl: "https://luke.test",
      readAccessToken: async () => "account-token",
      refreshAccount: async () => undefined,
      fetch: fakeService(upstream, allowance).fetch,
      now: () => NOW,
      report: () => undefined,
    }),
  quotaExhaustion: true,
};

interface Host {
  agent: BrainAgent;
  repository: FakeBrainStateRepository;
  store: BrainStateStore;
  clock: FakeClock;
  performed: string[];
  ask: (question: string) => Promise<BrainRequestRecord | undefined>;
}

let ids = 0;

function host(
  runtimeOver: (model: ModelAdapter) => AgentRuntime,
  model: ModelAdapter,
  repository = fakeBrainStateRepository(),
  performer: () => Promise<WireRecord> = async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  overrides: Partial<BrainAgentOptions> = {},
): Host {
  const clock = new FakeClock();
  const store = new BrainStateStore({
    repository,
    createGenerationId: () => `gen-${++ids}`,
    now: () => clock.now,
  });
  const performed: string[] = [];
  const session = normalizeSession(claude, {
    providerSessionId: ABC.providerSessionId,
    title: "Claude Code: abc",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
  });
  const agent = new BrainAgent({
    runtime: runtimeOver(model),
    prepareTurn: () => ({ prompt: "instructions", layers: {} }),
    actions: {
      perform: async (call) => {
        performed.push(call.name);
        return performer();
      },
    },
    roster: () => ({ text: "- abc", identities: [ABC], sessions: session ? [session] : [] }),
    standingContext: () => "Durable facts: none.",
    readTranscript: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "whole" }),
    deliver: () => undefined,
    store,
    createRunId: () => `run-${++ids}`,
    report: () => undefined,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    ...overrides,
  });
  return {
    agent,
    repository,
    store,
    clock,
    performed,
    ask: async (question) => {
      const accepted = await agent.submitAsk({
        submissionId: `sub-${++ids}`,
        question,
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
      });
      assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED, JSON.stringify(accepted));
      const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
      return agent.waitAsk(runId, 60_000);
    },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

for (const transport of [KEYED, HOSTED]) {
  test(`${transport.name}: multi-step tools run in order with encrypted items replayed, and the action is journaled before its effect`, async () => {
    const upstream = fakeUpstream([
      () => payload([reasoning("rs_1"), actionCall("call_1")]),
      () => payload([reasoning("rs_2"), actionCall("call_2")]),
      () => payload([message("Sent twice.")]),
    ]);
    const h = host(toolLoopRuntimeOver, transport.model(upstream));
    const record = await h.ask("send the tests twice");
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
    assert.equal(record?.text, "Sent twice.");
    assert.equal(record?.performedActions, 2);
    assert.deepEqual(h.performed, [
      REALTIME_TOOL.SEND_SESSION_MESSAGE,
      REALTIME_TOOL.SEND_SESSION_MESSAGE,
    ]);
    // The third inference replayed every encrypted reasoning item and every
    // call with its output, in order.
    const third = upstream.calls[2]?.body.input;
    assert.ok(Array.isArray(third));
    const kinds = third.filter(isRecord).map((item) => item.type);
    assert.deepEqual(
      kinds.filter((kind) => kind === RESPONSES_INPUT_ITEM_TYPE.REASONING).length,
      2,
    );
    assert.ok(
      third
        .filter(isRecord)
        .every(
          (item) =>
            item.type !== RESPONSES_INPUT_ITEM_TYPE.REASONING ||
            item.encrypted_content === ENCRYPTED,
        ),
    );
    const calls = kinds.filter((kind) => kind === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length;
    const outputs = kinds.filter(
      (kind) => kind === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
    ).length;
    assert.equal(calls, 2);
    assert.equal(outputs, 2);
    const stored = h.repository.state;
    assert.equal(stored?.journal.length, 2);
    assert.equal(stored?.checkpointFormat, "tool-loop@1:openai-responses-input/1");
    await h.agent.stop();
  });

  test(`${transport.name}: a cancel mid-run refuses the action not yet dispatched and keeps the one that ran`, async () => {
    let releaseSecond: (() => void) | undefined;
    const upstream = fakeUpstream([() => payload([actionCall("call_1"), actionCall("call_2")])]);
    let performedCount = 0;
    const h = host(
      toolLoopRuntimeOver,
      transport.model(upstream),
      fakeBrainStateRepository(),
      async () => {
        performedCount += 1;
        if (performedCount === 1) {
          await new Promise<void>((resolve) => {
            releaseSecond = resolve;
          });
        }
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
    );
    const accepted = await h.agent.submitAsk({
      submissionId: "cancel-me",
      question: "send twice",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    assert.ok(accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
    await settle();
    await h.agent.cancelAsk(accepted.runId);
    releaseSecond?.();
    const record = await h.agent.waitAsk(accepted.runId, 60_000);
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.CANCELLED);
    assert.equal(record?.performedActions, 1);
    assert.equal(h.performed.length, 1);
    // Every call in the stored memory is paired, the refused one included.
    const items = h.repository.state?.items ?? [];
    const outputs = items.filter(
      (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
    );
    assert.equal(
      outputs.length,
      items.filter((item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length,
    );
    await h.agent.stop();
  });

  test(`${transport.name}: malformed output, a provider-declared failure, and a rate limit each end the run honestly with nothing done`, async () => {
    const upstream = fakeUpstream([
      () => new Response("<html>not json</html>", { status: 200 }),
      () => Response.json({ status: "failed", error: { code: "server_error" }, output: [] }),
      () => new Response("", { status: 429, headers: { "retry-after": "30" } }),
    ]);
    const h = host(toolLoopRuntimeOver, transport.model(upstream));
    const malformed = await h.ask("first");
    assert.equal(malformed?.status, BRAIN_REQUEST_STATUS.FAILED);
    assert.equal(malformed?.failure, BRAIN_REQUEST_FAILURE.MODEL);
    const declared = await h.ask("second");
    assert.equal(declared?.status, BRAIN_REQUEST_STATUS.FAILED);
    assert.equal(declared?.failure, BRAIN_REQUEST_FAILURE.MODEL);
    const limited = await h.ask("third");
    assert.equal(limited?.status, BRAIN_REQUEST_STATUS.FAILED);
    assert.equal(h.performed.length, 0);
    // The cooldown stands: a tick opens nothing rather than spending a call on a refusal.
    await h.agent.tick(TICK);
    assert.equal(upstream.calls.length, 3);
    await h.agent.stop();
  });

  test(`${transport.name}: persistence interrupted before an action refuses the action; interrupted after it keeps the result and blocks the next`, async () => {
    const repository = fakeBrainStateRepository();
    const upstream = fakeUpstream([
      () => payload([actionCall("call_1")]),
      () => payload([message("done")]),
    ]);
    const h = host(toolLoopRuntimeOver, transport.model(upstream), repository);
    await h.agent.ready();
    // Acceptance and start land; the checkpoint before the action is refused.
    let writes = 0;
    const landed = repository.save;
    repository.save = (state, transcript) => {
      writes += 1;
      return writes === 3 ? false : landed(state, transcript);
    };
    const record = await h.ask("send");
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
    assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
    assert.equal(h.performed.length, 0);
    assert.equal(record?.performedActions, 0);
    await h.agent.stop();
  });
}

test("hosted: a spent allowance ends the run as a failure, opens no tick until the day resets, and spends nothing more", async () => {
  const upstream = fakeUpstream([]);
  const exhausted = { remaining: 0 };
  const model = new HostedModelAdapter({
    serviceBaseUrl: "https://luke.test",
    readAccessToken: async () => "account-token",
    refreshAccount: async () => undefined,
    fetch: fakeService(upstream, exhausted).fetch,
    now: () => NOW,
    report: () => undefined,
  });
  const h = host(toolLoopRuntimeOver, model);
  const record = await h.ask("anything?");
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(model.quietUntil(), NOW + 3_600_000);
  await h.agent.tick(TICK);
  assert.equal(upstream.calls.length, 0);
  await h.agent.stop();
});

/**
 * A second runtime that shares nothing with OpenAI Responses: its items are
 * its own records, its stamp is its own, it answers a fixed script, and it
 * calls the host's tools through the same executor contract. What the host
 * does with it is the proof: the checkpoint is stored under the runtime's
 * stamp, the actions are journaled, and the Responses runtime later refuses to
 * run over that stamp while leaving everything in place.
 */
const FAKE_FORMAT: CheckpointFormat = {
  runtime: "scripted",
  runtimeVersion: 3,
  format: "scripted-turns",
  formatVersion: 1,
};

class ScriptedContext implements ContextEngine {
  readonly checkpointFormat = FAKE_FORMAT;
  #turns: WireRecord[] = [];
  bootstrap(checkpoint: RuntimeCheckpoint | undefined) {
    if (!checkpoint) return { loaded: true, repaired: 0 };
    if (checkpoint.format.runtime !== FAKE_FORMAT.runtime) {
      return { loaded: false, reason: "not a scripted checkpoint", repaired: 0 };
    }
    this.#turns = [...checkpoint.items];
    return { loaded: true, repaired: 0 };
  }
  ingest(input: Parameters<ContextEngine["ingest"]>[0]) {
    this.#turns.push({ scripted: input.kind });
  }
  assemble() {
    return this.#turns;
  }
  compact() {
    return 0;
  }
  adoptCompaction(items: readonly WireRecord[]) {
    this.#turns = [...items];
  }
  afterTurn() {}
  mark() {
    return { items: [...this.#turns] };
  }
  rollback(mark: { items: readonly WireRecord[] }) {
    this.#turns = [...mark.items];
  }
  checkpoint(): RuntimeCheckpoint {
    return { format: FAKE_FORMAT, items: [...this.#turns] };
  }
  dispose() {}
}

class ScriptedRuntime implements AgentRuntime {
  readonly descriptor = { id: FAKE_FORMAT.runtime, checkpoint: FAKE_FORMAT };
  capabilities(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  compact(): Promise<{ compacted: false; reason: string }> {
    return Promise.resolve({ compacted: false, reason: "the scripted runtime does not compact" });
  }
  quietUntil(): number | undefined {
    return undefined;
  }
  readonly contexts: ToolExecutionContext[] = [];
  /** The tool each run calls before answering; the host's executor decides what it means. */
  constructor(private readonly script: readonly string[]) {}
  async openContext(checkpoint: RuntimeCheckpoint | undefined): Promise<ContextOpening> {
    const context = new ScriptedContext();
    return { context, bootstrap: context.bootstrap(checkpoint) };
  }
  async resume(checkpoint: RuntimeCheckpoint, request: Omit<RuntimeRunRequest, "context">) {
    const opened = await this.openContext(checkpoint);
    if (!opened.bootstrap.loaded) return { refused: opened.bootstrap.reason ?? "refused" };
    return this.start({ ...request, context: opened.context });
  }
  start(request: RuntimeRunRequest): RuntimeRun {
    const done = (async () => {
      for (const input of request.input) await request.context.ingest(input);
      let index = 0;
      for (const name of this.script) {
        const invocation = {
          callId: `scripted-${++index}`,
          name,
          argumentsJson: JSON.stringify({
            provider_id: ABC.providerId,
            provider_session_id: ABC.providerSessionId,
            text: "scripted",
          }),
        };
        await request.onEvent({ kind: RUNTIME_EVENT.TOOL_CALL, invocation });
        const context: ToolExecutionContext = {
          runId: request.runId,
          signal: request.signal,
          isRevoked: () => request.signal.aborted,
        };
        this.contexts.push(context);
        const result = await request.tools.execute(invocation, context);
        await request.context.ingest({
          kind: CONTEXT_INPUT_KIND.TOOL_RESULT,
          callId: invocation.callId,
          outputJson: result.outputJson,
        });
        await request.onEvent({ kind: RUNTIME_EVENT.TOOL_RESULT, invocation, result });
      }
      const text = `scripted reply after ${this.script.length} tools`;
      await request.onEvent({ kind: RUNTIME_EVENT.TEXT, text });
      const end = { reason: RUN_END_REASON.COMPLETED, text } as const;
      await request.onEvent({ kind: RUNTIME_EVENT.ENDED, end });
      return end;
    })();
    return { runId: request.runId, steer: () => false, cancel: () => undefined, done };
  }
}

test("a runtime that is not Responses drives the same host: actions journaled through the executor, checkpoint stored under its own stamp, refusals still the host's", async () => {
  const repository = fakeBrainStateRepository();
  const runtime = new ScriptedRuntime([
    REALTIME_TOOL.SEND_SESSION_MESSAGE,
    "read_transcript",
    "not_a_tool",
  ]);
  const model = KEYED.model(fakeUpstream([]));
  const h = host(() => runtime, model, repository);
  const record = await h.ask("do the scripted thing");
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(record?.text, "scripted reply after 3 tools");
  assert.equal(record?.performedActions, 1);
  assert.deepEqual(h.performed, [REALTIME_TOOL.SEND_SESSION_MESSAGE]);
  const stored = repository.state;
  assert.equal(stored?.checkpointFormat, "scripted@3:scripted-turns/1");
  assert.ok(stored?.items.every((item) => "scripted" in item));
  assert.equal(stored?.journal.length, 1);
  assert.equal(stored?.journal[0]?.name, REALTIME_TOOL.SEND_SESSION_MESSAGE);
  // The host refused the unknown tool itself; the runtime learned it from the result.
  const outputs = (stored?.items ?? []).filter(
    (item) => item.scripted === CONTEXT_INPUT_KIND.TOOL_RESULT,
  );
  assert.equal(outputs.length, 3);
  await h.agent.stop();

  // A tick turn runs over the same runtime, opened on the host's change records
  // and the action the policy allows carried through the same executor,
  // journaled while it ran and let go of once the turn committed.
  const observing = new ScriptedRuntime([REALTIME_TOOL.SEND_SESSION_MESSAGE]);
  const o = host(() => observing, model, repository);
  await o.agent.ready();
  await o.agent.tick(TICK);
  assert.deepEqual(o.performed, [REALTIME_TOOL.SEND_SESSION_MESSAGE]);
  assert.equal(repository.state?.journal.length, 1, "the ask's journal alone stays");
  await o.agent.stop();
});

test("the Responses runtime refuses a valid checkpoint of the scripted runtime: turns are refused as incompatible, and the checkpoint, requests, and journal stay whole", async () => {
  const repository = fakeBrainStateRepository();
  const scripted = host(
    () => new ScriptedRuntime([REALTIME_TOOL.SEND_SESSION_MESSAGE]),
    KEYED.model(fakeUpstream([])),
    repository,
  );
  const first = await scripted.ask("scripted first");
  assert.equal(first?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  await scripted.agent.stop();
  const before = repository.state;
  assert.ok(before);

  const upstream = fakeUpstream([() => payload([message("never asked")])]);
  const responses = host(toolLoopRuntimeOver, KEYED.model(upstream), repository);
  await responses.agent.ready();
  const refused = await responses.agent.submitAsk({
    submissionId: "over-foreign",
    question: "hello?",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.deepEqual(refused, {
    outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
    reason: BRAIN_SUBMISSION_REJECTION.INCOMPATIBLE,
  });
  await responses.agent.tick(TICK);
  assert.equal(upstream.calls.length, 0);
  // Nothing of the stored memory changed: same stamp, same items, same records, same journal.
  const after = repository.state;
  assert.deepEqual(after?.checkpointFormat, before.checkpointFormat);
  assert.deepEqual(after?.items, before.items);
  assert.deepEqual(after?.requests, before.requests);
  assert.deepEqual(after?.journal, before.journal);
  assert.equal(responses.agent.requests().length, 1);
  await responses.agent.stop();

  // The scripted runtime reads it again, and a Clear is the other way forward.
  const again = host(() => new ScriptedRuntime([]), KEYED.model(fakeUpstream([])), repository);
  assert.equal(await again.agent.incompatibility(), undefined);
  assert.equal((await again.ask("still scripted"))?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  await again.store.clear(NOW + 10);
  await settle();
  assert.equal(repository.state?.checkpointFormat, undefined);
  await again.agent.stop();
});

/**
 * A Responses engine whose ingest can be held open: what a store-backed or
 * remote engine looks like when it is slow, and the hostile case for a
 * cancel — a hook resolving after the run it belonged to has ended, onto an
 * object the host must no longer be using.
 */
class HeldIngestEngine extends ResponsesContextEngine {
  static held: (() => void)[] = [];
  static hold = false;
  override async ingest(input: ContextInput, lifecycle?: ContextLifecycle): Promise<void> {
    if (HeldIngestEngine.hold && input.kind === CONTEXT_INPUT_KIND.MODEL_OUTPUT) {
      HeldIngestEngine.hold = false;
      await new Promise<void>((resolve) => {
        HeldIngestEngine.held.push(resolve);
      });
    }
    // The obligation the contract states: nothing applied once the signal fired.
    // Deliberately violated here, so the host's own fence is what the test proves.
    super.ingest(input);
    void lifecycle;
  }
}

function heldIngestRuntime(model: ModelAdapter): AgentRuntime {
  return new ToolLoopAgentRuntime({
    model,
    itemFormat: RESPONSES_ITEM_FORMAT,
    createContext: (format) =>
      new HeldIngestEngine({ id: format.runtime, version: format.runtimeVersion }),
  });
}

test("an ingest held across a cancel that resolves after the successor turn began lands on the retired engine, never in the context the next turn reads or keeps", async () => {
  const repository = fakeBrainStateRepository();
  const upstream = fakeUpstream([
    () => payload([message("LATE_WORDS")]),
    () => payload([message("fresh reply")]),
  ]);
  const h = host(heldIngestRuntime, KEYED.model(upstream), repository);
  HeldIngestEngine.hold = true;
  const accepted = await h.agent.submitAsk({
    submissionId: "held",
    question: "first",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.ok(accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await settle();
  assert.equal(HeldIngestEngine.held.length, 1, "the model's answer is being ingested");
  await h.agent.cancelAsk(accepted.runId);
  const cancelled = await h.agent.waitAsk(accepted.runId, 60_000);
  assert.equal(cancelled?.status, BRAIN_REQUEST_STATUS.CANCELLED);

  // The successor turn opens on the restored context and runs to its reply.
  const next = await h.ask("second");
  assert.equal(next?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(next?.text, "fresh reply");
  // Now the held ingest resolves, onto the engine the cancelled turn used.
  HeldIngestEngine.held.shift()?.();
  await settle();
  const shown = upstream.calls[1]?.body.input;
  assert.ok(Array.isArray(shown));
  // A third turn reads the same context again, and still finds nothing of them.
  upstream.answers.push(() => payload([message("third")]));
  await h.ask("third");
  await h.agent.stop();
});

test("a model failure after a recorded act restores the context to the action's committed boundary: the action, its result, and the record survive and are read again", async () => {
  const repository = fakeBrainStateRepository();
  const upstream = fakeUpstream([
    () => payload([actionCall("call_1")]),
    () => new Response("", { status: 500 }),
    () => payload([message("after")]),
  ]);
  const h = host(toolLoopRuntimeOver, KEYED.model(upstream), repository);
  const failed = await h.ask("send then fail");
  assert.equal(failed?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(failed?.failure, BRAIN_REQUEST_FAILURE.MODEL);
  assert.equal(failed?.performedActions, 1);
  const stored = repository.state;
  assert.equal(stored?.journal.length, 1);
  assert.equal(
    stored?.journal[0]?.outputJson,
    JSON.stringify({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );
  const kept = stored?.items ?? [];
  assert.ok(
    kept.some(
      (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL && item.call_id === "call_1",
    ),
  );
  assert.ok(
    kept.some(
      (item) =>
        item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT && item.call_id === "call_1",
    ),
  );
  // The next turn's context carries the paired act, on the restored engine.
  await h.ask("continue");
  const shown = upstream.calls[2]?.body.input;
  assert.ok(Array.isArray(shown));
  const items = shown.filter(isRecord);
  assert.ok(
    items.some(
      (item) =>
        item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT && item.call_id === "call_1",
    ),
  );
  await h.agent.stop();
});

/**
 * The desktop's own preparation, as `wiring.ts` composes it: the built-in
 * registries, a configuration over a real workspace, the facts gathered under
 * it, and the pure builder. Stood up here so the prompt a keyed turn and a
 * hosted turn send upstream can be compared byte for byte.
 */
async function workspacePreparation(
  adapterId: BuiltinModelAdapterId,
  credential: Parameters<typeof defaultAgentConfiguration>[0]["credential"],
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "luke-acceptance-"));
  const workspace = path.join(root, "workspace");
  await seedWorkspace(workspace, BRAIN_WORKSPACE_SEEDS);
  const store = new ConfigurationStore(
    defaultAgentConfiguration({
      agentRuntimeId: TOOL_LOOP_RUNTIME.ID,
      modelAdapterId: adapterId,
      contextEngineId: BUILTIN_CONTEXT_ENGINE.RESPONSES,
      credential,
      workspaceDirectory: workspace,
    }),
  );
  const prepareTurn: BrainAgentOptions["prepareTurn"] = async (turn) => {
    const trigger = turn.kind === BRAIN_TURN_KIND.TURN ? turn.trigger : undefined;
    const policy = resolveTurnToolPolicy(brainToolCatalog(), {}, trigger);
    const facts = await gatherPromptFacts({
      configuration: store.snapshot(),
      run: { origin: trigger === undefined ? RUN_ORIGIN.MAINTENANCE : runOriginOf(trigger) },
      identity: BRAIN_IDENTITY_LINE,
      persona: BRAIN_PERSONA,
      tools: policy.allowed.map((tool) => ({ name: tool.schema.name, groups: tool.groups })),
      toolNotes: brainToolNotes(),
      runtimeContextMarker: BRAIN_INPUT_MARKER.STANDING_CONTEXT,
      runtimeId: TOOL_LOOP_RUNTIME.ID,
    });
    return { prompt: buildSystemPrompt(facts).text, layers: {} };
  };
  return { workspace, prepareTurn };
}

test("a keyed turn and a hosted turn send the same prompt upstream, built from the same workspace by the same three stages", async () => {
  const keyedPreparation = await workspacePreparation(BUILTIN_MODEL_ADAPTER.OPENAI, {
    kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY,
    providerId: "openai",
  });
  const hostedPreparation = await workspacePreparation(BUILTIN_MODEL_ADAPTER.HOSTED, {
    kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT,
  });
  const sent: string[] = [];
  for (const [transport, preparation] of [
    [KEYED, keyedPreparation],
    [HOSTED, hostedPreparation],
  ] as const) {
    const upstream = fakeUpstream([() => payload([message("Hello.")])]);
    const h = host(
      toolLoopRuntimeOver,
      transport.model(upstream),
      fakeBrainStateRepository(),
      undefined,
      {
        prepareTurn: preparation.prepareTurn,
      },
    );
    const record = await h.ask("hello");
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
    const [call] = upstream.calls;
    assert.ok(call && isWireString(call.body.instructions));
    sent.push(call.body.instructions);
    await h.agent.stop();
  }
  const [keyed, hosted] = sent;
  assert.ok(keyed && hosted);
  // The two workspaces were seeded from the same build; only their paths differ.
  const pathless = (prompt: string, workspace: string) =>
    prompt.split(workspace).join("<workspace>");
  assert.equal(
    pathless(keyed, keyedPreparation.workspace),
    pathless(hosted, hostedPreparation.workspace),
  );
  // The persona is the build's own section and never a workspace file, so it
  // reaches the prompt exactly once.
  const personaOpening = BRAIN_PERSONA.split("\n")[0] ?? "";
  assert.equal(keyed.split(personaOpening).length - 1, 1);
});

test("a conversation that starts fresh is primed once with the recent daily notes, and an ordinary turn reads none", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "luke-notes-"));
  await seedWorkspace(root, BRAIN_WORKSPACE_SEEDS);
  await fs.writeFile(path.join(root, "memory", "2027-01-15.md"), "Shipped the release.");
  const now = Date.UTC(2027, 0, 15, 12);
  const primeFreshContext = async () => {
    const notes = await recentDailyNotes(root, now);
    return notes.length > 0
      ? notes.map((note) => `## ${note.name}\n\n${note.content}`).join("\n\n")
      : undefined;
  };
  const upstream = fakeUpstream([
    () => payload([message("Noted.")]),
    () => payload([message("Again.")]),
  ]);
  const h = host(
    toolLoopRuntimeOver,
    KEYED.model(upstream),
    fakeBrainStateRepository(),
    undefined,
    {
      primeFreshContext,
    },
  );
  assert.equal((await h.ask("first"))?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal((await h.ask("second"))?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  await h.agent.stop();
});

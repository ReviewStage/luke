import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { MEMORY_HOUSEKEEPING_OUTCOME, memoryFlushPrompt } from "@sidecar/memory";
import { RESPONSES_ITEM_FORMAT, TOOL_LOOP_RUNTIME, WORKSPACE_FILE_REFUSAL } from "@sidecar/runtime";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
} from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import { ResponsesContextEngine } from "./context-engine.js";
import { HOUSEKEEPING_REFUSAL, runMemoryHousekeeping } from "./housekeeping.js";
import { type ResponsesInputItem, responsesModelAnswer } from "./responses-api.js";
import { ToolLoopAgentRuntime } from "./runtime.js";
import { BRAIN_TOOL } from "./tools.js";

const IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };
const DAY = "2026-09-08";
const NOTE = `memory/${DAY}.md`;

function message(text: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

function call(callId: string, name: string, args: WireRecord): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}

function answered(output: readonly WireRecord[]): ModelResponse {
  const answer = responsesModelAnswer({ output, usage: { input_tokens: 10 } });
  assert.ok(answer);
  return answer;
}

class FakeModel {
  readonly inputs: ResponsesInputItem[][] = [];
  readonly options: ModelRequestOptions[] = [];
  readonly answers: ModelResponse[] = [];
  respond(input: readonly ResponsesInputItem[], options: ModelRequestOptions) {
    this.inputs.push([...input]);
    this.options.push(options);
    return Promise.resolve(this.answers.shift() ?? answered([message("NO_REPLY")]));
  }
}

function adapterOf(model: FakeModel): ModelAdapter {
  return {
    capabilities: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: "fake",
        checkpoint: {
          runtime: TOOL_LOOP_RUNTIME.ID,
          runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
          format: RESPONSES_ITEM_FORMAT.format,
          formatVersion: RESPONSES_ITEM_FORMAT.version,
        },
        countsInputTokens: false,
        compacts: false,
        maximumOutputTokens: 16_000,
      },
    }),
    respond: (input, options) => model.respond(input, options),
    countInputTokens: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: MODEL_FAILURE.UPSTREAM,
      reason: "not counted",
    }),
    compact: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: MODEL_FAILURE.UPSTREAM,
      reason: "not compacted",
    }),
    quietUntil: () => undefined,
  };
}

function runtimeOver(model: FakeModel): ToolLoopAgentRuntime {
  return new ToolLoopAgentRuntime({
    model: adapterOf(model),
    itemFormat: RESPONSES_ITEM_FORMAT,
    createContext: () => new ResponsesContextEngine(IDENTITY),
  });
}

function fakeWorkspace(files: Map<string, string>) {
  const writes: string[] = [];
  return {
    writes,
    access: {
      read: async (name: string) => {
        const content = files.get(name);
        return content === undefined
          ? { ok: false as const, reason: WORKSPACE_FILE_REFUSAL.NOT_FOUND }
          : { ok: true as const, content };
      },
      write: async (name: string, content: string) => {
        files.set(name, content);
        writes.push(name);
        return { ok: true as const, chars: content.length };
      },
    },
  };
}

const CONTEXT: WireRecord[] = [
  {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: "user",
    content: [{ type: "input_text", text: "we agreed on pnpm" }],
  },
  message("Noted: pnpm it is."),
];

test("a flush appends to today's note over a private copy of the context and reports completion; the conversation's items are untouched", async () => {
  const model = new FakeModel();
  model.answers.push(
    answered([
      call("c1", BRAIN_TOOL.WRITE_WORKSPACE_FILE, {
        name: NOTE,
        content: "- old\n- pnpm agreed\n",
      }),
    ]),
    answered([message("NO_REPLY")]),
  );
  const files = new Map([[NOTE, "- old\n"]]);
  const workspace = fakeWorkspace(files);
  const items = [...CONTEXT];
  const result = await runMemoryHousekeeping({
    runtime: runtimeOver(model),
    items,
    prompt: memoryFlushPrompt(DAY),
    dateStamp: DAY,
    workspace: workspace.access,
    signal: new AbortController().signal,
    runId: "flush-1",
  });
  assert.deepEqual(result, { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes: 1 });
  assert.equal(files.get(NOTE), "- old\n- pnpm agreed\n");
  assert.deepEqual(items, CONTEXT, "the caller's copy is not mutated");
  const first = model.inputs[0];
  assert.ok(first);
  assert.equal(first.length, CONTEXT.length + 1, "the copied context and the flush ask");
  assert.deepEqual(
    (model.options[0]?.tools ?? []).map((tool) => tool.name).sort(),
    [BRAIN_TOOL.READ_WORKSPACE_FILE, BRAIN_TOOL.WRITE_WORKSPACE_FILE].sort(),
  );
});

test("a housekeeping write is refused for any other file or for an overwrite, and a silent turn reports nothing to store", async () => {
  const model = new FakeModel();
  model.answers.push(
    answered([
      call("c1", BRAIN_TOOL.WRITE_WORKSPACE_FILE, { name: "MEMORY.md", content: "# rewritten" }),
      call("c2", BRAIN_TOOL.WRITE_WORKSPACE_FILE, { name: NOTE, content: "- replaced\n" }),
      call("c3", BRAIN_TOOL.WRITE_WORKSPACE_FILE, {
        name: "memory/2026-09-07.md",
        content: "- old\n- x\n",
      }),
    ]),
    answered([message("NO_REPLY")]),
  );
  const files = new Map([
    [NOTE, "- old\n"],
    ["MEMORY.md", "# MEMORY.md\n"],
  ]);
  const workspace = fakeWorkspace(files);
  const result = await runMemoryHousekeeping({
    runtime: runtimeOver(model),
    items: CONTEXT,
    prompt: memoryFlushPrompt(DAY),
    dateStamp: DAY,
    workspace: workspace.access,
    signal: new AbortController().signal,
    runId: "flush-2",
  });
  assert.deepEqual(result, { outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE, writes: 0 });
  assert.deepEqual(workspace.writes, []);
  assert.equal(files.get("MEMORY.md"), "# MEMORY.md\n");
  const outputs = (model.inputs[1] ?? []).filter(
    (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  );
  const reasons = outputs.map((item) => JSON.parse(String(item.output)).reason);
  assert.deepEqual(reasons, [
    HOUSEKEEPING_REFUSAL.NOT_TODAYS_NOTE,
    HOUSEKEEPING_REFUSAL.NOT_APPEND_ONLY,
    HOUSEKEEPING_REFUSAL.NOT_TODAYS_NOTE,
  ]);
});

test("an interrupted flush keeps the write it already made and is not reported complete", async () => {
  const model = new FakeModel();
  const controller = new AbortController();
  model.answers.push(
    answered([call("c1", BRAIN_TOOL.WRITE_WORKSPACE_FILE, { name: NOTE, content: "- first\n" })]),
  );
  const files = new Map<string, string>();
  const workspace = fakeWorkspace(files);
  const original = workspace.access.write;
  workspace.access.write = async (name, content) => {
    const written = await original(name, content);
    controller.abort();
    return written;
  };
  const result = await runMemoryHousekeeping({
    runtime: runtimeOver(model),
    items: CONTEXT,
    prompt: memoryFlushPrompt(DAY),
    dateStamp: DAY,
    workspace: workspace.access,
    signal: controller.signal,
    runId: "flush-3",
  });
  assert.equal(result.outcome, MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED);
  assert.equal(result.writes, 1);
  assert.equal(files.get(NOTE), "- first\n", "the committed write stands");
});

test("a model failure is a failed flush, never a completed one", async () => {
  const model = new FakeModel();
  model.answers.push({
    outcome: MODEL_RESPONSE_OUTCOME.FAILED,
    failure: MODEL_FAILURE.UPSTREAM,
    reason: "boom",
  });
  const result = await runMemoryHousekeeping({
    runtime: runtimeOver(model),
    items: CONTEXT,
    prompt: memoryFlushPrompt(DAY),
    dateStamp: DAY,
    workspace: fakeWorkspace(new Map()).access,
    signal: new AbortController().signal,
    runId: "flush-4",
  });
  assert.equal(result.outcome, MEMORY_HOUSEKEEPING_OUTCOME.FAILED);
});

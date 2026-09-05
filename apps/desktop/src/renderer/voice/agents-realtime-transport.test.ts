import assert from "node:assert/strict";
import test from "node:test";
import { ScriptedRealtimeTransport } from "@openai/agents-realtime/testing";
import {
  introductionSessionConfig,
  type RealtimeConnection,
  realtimeSessionConfig,
} from "@sidecar/realtime";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import {
  agentsRealtimeErrorMessage,
  type BuiltRealtimeSessionConfig,
  createAgentsRealtimeTransport,
} from "./agents-realtime-transport";

const CONNECTION: RealtimeConnection = {
  value: "ek_test_secret",
  expiresAt: 1_800_000_060_000,
  model: "gpt-realtime-2.1",
  callsUrl: "https://api.openai.com/v1/realtime/calls",
};

interface CircularSdkError {
  error?: { message: string; circular?: CircularSdkError };
}

function sdkHarness(config: BuiltRealtimeSessionConfig) {
  const transport = new ScriptedRealtimeTransport();
  const errors: string[] = [];
  const executed: string[] = [];
  const session = createAgentsRealtimeTransport(
    {
      sessionConfig: config,
      audioElement: undefined,
      onPeerConnection: () => undefined,
      onTransportEvent: () => undefined,
      onClientEvent: () => undefined,
      onToolOutputSent: () => undefined,
      onConnectionChange: () => undefined,
      onError: (message) => errors.push(message),
      executeTool: async (name) => {
        executed.push(name);
        return { status: ACT_RESULT_STATUS.ACCEPTED };
      },
    },
    transport,
  );
  return { errors, executed, session, transport };
}

async function connect(context: ReturnType<typeof sdkHarness>) {
  const call = context.transport.expectCall("connect");
  await context.session.connect({
    apiKey: CONNECTION.value,
    model: CONNECTION.model,
    url: CONNECTION.callsUrl,
  });
  return call;
}

test("the production SDK adapter preserves full, empty, and subset tool lists", async () => {
  const full = realtimeSessionConfig({ voice: "ash", speed: 1.25 });
  const cases: readonly {
    name: string;
    config: BuiltRealtimeSessionConfig;
    expectedTools: readonly string[];
    expectedToolChoice: "auto" | "none";
  }[] = [
    {
      name: "full",
      config: full,
      expectedTools: full.tools.map(({ name }) => name),
      expectedToolChoice: "auto",
    },
    {
      name: "empty",
      config: introductionSessionConfig(),
      expectedTools: [],
      expectedToolChoice: "none",
    },
    {
      name: "subset",
      config: { ...full, tools: full.tools.slice(0, 1) },
      expectedTools: full.tools.slice(0, 1).map(({ name }) => name),
      expectedToolChoice: "auto",
    },
  ];

  for (const fixture of cases) {
    const context = sdkHarness(fixture.config);
    const call = await connect(context);
    const tools = call.options.initialSessionConfig?.tools ?? [];
    assert.deepEqual(
      tools.map((tool) => ("name" in tool ? tool.name : undefined)),
      fixture.expectedTools,
      fixture.name,
    );
    assert.equal(call.options.initialSessionConfig?.toolChoice, fixture.expectedToolChoice);
    const close = context.transport.expectCall("close");
    context.session.close();
    await close;
  }
});

test("the production SDK adapter carries the complete session configuration", async () => {
  const context = sdkHarness(realtimeSessionConfig({ voice: "ash", speed: 1.25 }));
  const call = await connect(context);
  const config = call.options.initialSessionConfig;

  assert.ok(config && "audio" in config);
  assert.equal(config?.toolChoice, "auto");
  assert.deepEqual(config?.reasoning, { effort: "low" });
  assert.deepEqual(config?.audio, {
    input: {
      format: { type: "audio/pcm", rate: 24_000 },
      transcription: { model: "gpt-live-transcribe" },
      turnDetection: null,
    },
    output: { voice: "ash", speed: 1.25 },
  });
  assert.deepEqual(config?.providerData, {
    truncation: { type: "retention_ratio", retention_ratio: 0.8 },
  });

  const close = context.transport.expectCall("close");
  context.session.close();
  await close;
});

test("the production SDK adapter omits reasoning for an unsupported model", async () => {
  const context = sdkHarness(realtimeSessionConfig({ model: "gpt-realtime-preview" }));
  const call = await connect(context);

  assert.equal(call.options.initialSessionConfig?.reasoning, undefined);

  const close = context.transport.expectCall("close");
  context.session.close();
  await close;
});

test("the production SDK adapter executes only its configured tool", async () => {
  const full = realtimeSessionConfig();
  const [definition] = full.tools;
  assert.ok(definition);
  const context = sdkHarness({ ...full, tools: [definition] });
  await connect(context);

  const output = context.transport.expectCall("sendFunctionCallOutput");
  context.transport.emit("function_call", {
    type: "function_call",
    name: definition.name,
    callId: "call-1",
    arguments: "{}",
    responseId: "response-1",
  });
  const call = await output;

  assert.deepEqual(context.executed, [definition.name]);
  assert.equal(call.toolCall.callId, "call-1");
  assert.equal(call.startResponse, false);
  assert.deepEqual(JSON.parse(call.output), { status: ACT_RESULT_STATUS.ACCEPTED });

  const close = context.transport.expectCall("close");
  context.session.close();
  await close;
});

test("SDK errors are rendered without serializing unknown values", () => {
  const circular: CircularSdkError = {};
  circular.error = { message: "transport failed", circular };

  assert.equal(agentsRealtimeErrorMessage(circular), "transport failed");
  assert.doesNotThrow(() => agentsRealtimeErrorMessage({ value: 1n }));
  assert.equal(
    agentsRealtimeErrorMessage(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("unreadable");
          },
        },
      ),
    ),
    "The voice connection failed.",
  );
});

test("a server error is left to the session's own filter, not reported twice", async () => {
  const context = sdkHarness(realtimeSessionConfig());
  await connect(context);

  context.transport.emit("error", {
    type: "error",
    error: { type: "error", error: { message: "Audio content of 1ms is already shorter" } },
  });
  assert.deepEqual(context.errors, []);

  context.transport.emit("error", { type: "error", error: new Error("ice failed") });
  assert.deepEqual(context.errors, ["ice failed"]);
  context.transport.disconnect();
});

test("an SDK close failure is reported without escaping or running twice", async () => {
  const context = sdkHarness(realtimeSessionConfig());
  await connect(context);
  context.transport.failNextCall("close", new Error("close failed"));

  assert.doesNotThrow(() => context.session.close());
  assert.doesNotThrow(() => context.session.close());
  assert.deepEqual(context.errors, ["close failed"]);
  context.transport.disconnect();
});

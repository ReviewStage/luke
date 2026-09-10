import { randomUUID } from "node:crypto";
import { type BrainTurnTraceRecord, responsesModelAnswer } from "@sidecar/brain";
import { bareModelAdapter } from "@sidecar/brain/testing";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import type { WireRecord } from "@sidecar/wire";
import { type ModelRequestOptions, type ModelResponse, REALTIME_TOOL } from "../../server/core";
import type { HostedBrainRoute } from "../../server/hosted/brain-host/route";
import type { HostedSpend } from "../../server/hosted/quota";
import type { HostedStoreTestDatabase } from "./hosted-store-database";
import { TEST_PAYLOAD_SECRET } from "./hosted-store-database";

/**
 * The brain-host routes over a scripted model: the store is the PGlite one
 * the store tests run on, the bearer resolves to the test's user, the meter
 * counts and refuses when told, and the work a route continues after its
 * answer is collected so a test awaits it rather than a function's lifetime.
 */

export const OPENAI_TEST_KEY = "sk-test-key";

/** A model whose every answer is scripted, remembering what it was asked. */
export class ScriptedModel {
  readonly model = "scripted-model";
  readonly inputs: WireRecord[][] = [];
  readonly toolsOffered: string[][] = [];
  readonly answers: ModelResponse[] = [];
  fallback: ModelResponse = answered([message("")]);

  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse> {
    this.inputs.push([...items]);
    this.toolsOffered.push(options.tools.map((tool) => tool.name));
    return Promise.resolve(this.answers.shift() ?? this.fallback);
  }

  quietUntil(): number | undefined {
    return undefined;
  }
}

export function answered(output: readonly WireRecord[], inputTokens = 100): ModelResponse {
  const answer = responsesModelAnswer({
    output,
    usage: { input_tokens: inputTokens, output_tokens: 20 },
  });
  if (!answer) throw new Error("the scripted answer is not a Responses payload");
  return answer;
}

export function message(text: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

export function functionCall(callId: string, name: string, args: WireRecord): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}

export const REMEMBER_CALL = (callId: string, words: string) =>
  functionCall(callId, REALTIME_TOOL.REMEMBER_FACT, { words });

/** A request as a signed-in device sends it, its body the JSON record given. */
export function jsonRequest(url: string, method: string, body?: WireRecord): Request {
  return new Request(url, {
    method,
    headers: { authorization: "Bearer developer-token", "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : undefined),
  });
}

export interface BrainRouteHarness {
  readonly model: ScriptedModel;
  /** Every spend the meter took, in order. */
  readonly spends: string[];
  /** Whether the next spends are refused. */
  refuse: boolean;
  /** The work routes continued after answering; awaited by `drain`. */
  readonly continued: Promise<void>[];
  readonly traces: BrainTurnTraceRecord[];
  route(request: Request, overrides?: Partial<HostedBrainRoute>): HostedBrainRoute;
  drain(): Promise<void>;
}

export function brainRouteHarness(
  database: HostedStoreTestDatabase,
  userId: string,
  overrides: Partial<HostedBrainRoute> = {},
): BrainRouteHarness {
  const model = new ScriptedModel();
  const spends: string[] = [];
  const continued: Promise<void>[] = [];
  const traces: BrainTurnTraceRecord[] = [];
  const harness: BrainRouteHarness = {
    model,
    spends,
    refuse: false,
    continued,
    traces,
    route: (request, requestOverrides = {}) => ({
      request,
      resolveUserId: async (incoming) =>
        incoming.headers.get("authorization") === "Bearer developer-token" ? userId : undefined,
      encryptionSecret: TEST_PAYLOAD_SECRET,
      openAiKey: OPENAI_TEST_KEY,
      model: undefined,
      readVaultKeys: async () => [],
      store: () => database.store,
      spend: async (spentBy): Promise<HostedSpend> => {
        spends.push(spentBy);
        return {
          allowed: !harness.refuse,
          quota: { used: spends.length, limit: 5, resetsAt: Date.now() + 60_000 },
        };
      },
      workspaceDefaults: async () => ({}),
      continueAfterResponse: (work) => {
        continued.push(work);
      },
      modelAdapter: () => bareModelAdapter(model),
      createId: () => randomUUID(),
      report: () => {},
      sleep: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms).unref();
        }),
      leaseWaitMs: 200,
      drainMs: 10_000,
      ...overrides,
      ...requestOverrides,
    }),
    drain: async () => {
      while (continued.length > 0) await continued.shift();
    },
  };
  return harness;
}

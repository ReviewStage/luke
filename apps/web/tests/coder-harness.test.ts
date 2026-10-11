import assert from "node:assert/strict";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { it } from "@effect/vitest";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { isReasoningUIPart, isTextUIPart, isToolUIPart, jsonSchema, tool } from "ai";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Result } from "effect";
import { MESSAGE_ROLE } from "../server/core";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { recordedRuntimeSession } from "../server/hosted/brain-host/recorded-session";
import {
  type HarnessConversation,
  type HarnessServices,
  type HarnessSessionsSeams,
  harnessSessionId,
  harnessSessions,
} from "../server/hosted/coder-host/harness/harness-sessions";
import { CODER_RUNTIME } from "../server/hosted/coder-host/harness/runtime-flag";
import { HARNESS_TOOL_SET } from "../server/hosted/coder-host/harness/tool-vocabulary";
import { CURSOR_START, transcriptPast } from "../server/hosted/coder-host/transcript";
import {
  createCodingAgent,
  latestTurnsOf,
  readCodingAgent,
} from "../server/hosted/coding-agent-store";
import { modelCatalogOf, type OfferedModel } from "../server/hosted/model-catalog";
import { createPlan } from "../server/hosted/plan-store";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";
import { sandboxDouble } from "./support/repository-sandbox";
import {
  harnessUsage,
  type ScriptContext,
  type ScriptStep,
  scriptedHarness,
  WAIT_FOR_ABORT,
} from "./support/scripted-harness";
import { testSqlClient } from "./support/sql-client";

/**
 * SPIKE (do not merge): a coding agent's Start, message, and Stop on an
 * official harness, through the real `HarnessAgent` over a scripted
 * adapter (`support/scripted-harness.ts`), the harness path's `EveSessions`
 * (`harness-sessions.ts`), and the shared relay into the real migrations
 * on PGlite: what the agent's tab then reads is the transcript, its
 * status, and its usage. The scripts are Claude Code's and Codex's parts
 * as their adapters emit them; no model, sandbox, or network is reached.
 */

const NOW = 1_800_000_000_000;

const PLAN_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

const CATALOG: readonly OfferedModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
    contextWindow: 1_000_000,
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

const BRANCH = "luke/teammate-invitations";

const STOP = { unified: "stop", raw: "end_turn" } as const;
const TOOL_CALLS = { unified: "tool-calls", raw: "tool_use" } as const;

/** A Claude Code turn as its adapter emits it: thinking, Bash, Read, Edit, a todo list, the plan notes host tool, and the answer. */
const claudeCodeTurn = (): readonly ScriptStep[] => [
  { type: "stream-start", modelId: "claude-opus-5-5" },
  { type: "reasoning-start", id: "r1" },
  { type: "reasoning-delta", id: "r1", delta: "Read the guide, then the invite route." },
  { type: "reasoning-end", id: "r1" },
  {
    type: "tool-call",
    toolCallId: "toolu_1",
    toolName: "bash",
    nativeName: "Bash",
    providerExecuted: true,
    input: JSON.stringify({ command: "cat AGENTS.md", description: "Read the guide" }),
  },
  {
    type: "tool-result",
    toolCallId: "toolu_1",
    toolName: "bash",
    result: { stdout: "# Agent guide\n", stderr: "", interrupted: false, isImage: false },
  },
  {
    type: "tool-call",
    toolCallId: "toolu_2",
    toolName: "read",
    nativeName: "Read",
    providerExecuted: true,
    input: JSON.stringify({ file_path: "src/invite.ts" }),
  },
  {
    type: "tool-result",
    toolCallId: "toolu_2",
    toolName: "read",
    result: {
      type: "text",
      file: { filePath: "src/invite.ts", content: "export {};\n", numLines: 1 },
    },
  },
  { type: "finish-step", finishReason: TOOL_CALLS, usage: harnessUsage(1_000, 40) },
  {
    type: "tool-call",
    toolCallId: "toolu_3",
    toolName: "edit",
    nativeName: "Edit",
    providerExecuted: true,
    input: JSON.stringify({
      file_path: "src/invite.ts",
      old_string: "export {};",
      new_string: "export const invite = (email: string) => email;",
    }),
  },
  {
    type: "tool-result",
    toolCallId: "toolu_3",
    toolName: "edit",
    result: { filePath: "src/invite.ts", oldString: "export {};", newString: "…" },
  },
  {
    type: "tool-call",
    toolCallId: "toolu_4",
    toolName: "TodoWrite",
    providerExecuted: true,
    input: JSON.stringify({ todos: [{ content: "Add the route", status: "completed" }] }),
  },
  { type: "tool-result", toolCallId: "toolu_4", toolName: "TodoWrite", result: { oldTodos: [] } },
  {
    type: "tool-call",
    toolCallId: "toolu_5",
    toolName: "edit_plan",
    input: JSON.stringify({ notes: [{ kind: "add", text: "Invites expire after a week." }] }),
  },
  { type: "finish-step", finishReason: TOOL_CALLS, usage: harnessUsage(1_200, 60) },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "The invite route is in. " },
  { type: "text-delta", id: "t1", delta: "Pushed the branch." },
  { type: "text-end", id: "t1" },
  { type: "finish-step", finishReason: STOP, usage: harnessUsage(1_300, 20) },
  {
    type: "finish",
    finishReason: STOP,
    totalUsage: harnessUsage(3_500, 120),
    harnessMetadata: { "claude-code": { sessionId: "claude-1", costUsd: 0.05 } },
  },
];

/** A Codex turn as its adapter emits it: a command, a patch as its call's whole input, the path-only file change, and usage on `finish` alone. */
const codexTurn = (): readonly ScriptStep[] => [
  { type: "stream-start" },
  {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "bash",
    nativeName: "shell",
    providerExecuted: true,
    input: JSON.stringify({ command: "pnpm test" }),
  },
  {
    type: "tool-result",
    toolCallId: "call_1",
    toolName: "bash",
    result: { exitCode: 1, output: "1 failing\n", status: "failed" },
  },
  { type: "finish-step", finishReason: TOOL_CALLS, usage: harnessUsage(0, 0) },
  {
    type: "tool-call",
    toolCallId: "call_2",
    toolName: "apply_patch",
    providerExecuted: true,
    input: JSON.stringify(
      "*** Begin Patch\n*** Update File: src/invite.ts\n@@\n-a\n+b\n*** End Patch",
    ),
  },
  {
    type: "tool-result",
    toolCallId: "call_2",
    toolName: "apply_patch",
    result: { status: "completed" },
  },
  { type: "file-change", event: "modify", path: "src/invite.ts" },
  { type: "finish-step", finishReason: TOOL_CALLS, usage: harnessUsage(0, 0) },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Fixed the failing test." },
  { type: "text-end", id: "t1" },
  { type: "finish-step", finishReason: STOP, usage: harnessUsage(0, 0) },
  { type: "finish", finishReason: STOP, totalUsage: harnessUsage(9_000, 300) },
];

/** A follow-up turn that says whether its session was resumed from the one the last turn parked. */
const followUpTurn = ({ resumed }: ScriptContext): readonly ScriptStep[] => [
  { type: "stream-start" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: resumed ? "Resumed: done." : "A fresh session." },
  { type: "text-end", id: "t1" },
  { type: "finish-step", finishReason: STOP, usage: harnessUsage(10, 5) },
  { type: "finish", finishReason: STOP, totalUsage: harnessUsage(10, 5) },
];

/** A turn that runs until it is stopped. */
const longTurn = (): readonly ScriptStep[] => [
  { type: "stream-start" },
  {
    type: "tool-call",
    toolCallId: "toolu_9",
    toolName: "bash",
    providerExecuted: true,
    input: JSON.stringify({ command: "pnpm test --watch" }),
  },
  WAIT_FOR_ABORT,
];

/** The plan-notes host tool as the production path offers it, answering as the store would. */
const EDIT_PLAN = tool({
  description: "Take notes on the plan this agent was handed.",
  inputSchema: jsonSchema<{ notes: unknown[] }>({ type: "object" }),
  execute: async () => ({ status: "taken", taken: 1 }),
});

/** The harness path over the store, its sessions opened on the scripted turns given, each turn a fiber the test joins. */
function harnessOver(
  turns: readonly ((context: ScriptContext) => readonly ScriptStep[])[],
  parked?: Deferred.Deferred<void>,
) {
  const agent = new HarnessAgent({
    harness: scriptedHarness(turns, () => {
      if (parked !== undefined) Deferred.doneUnsafe(parked, Exit.void);
    }),
    id: "luke-coder",
    permissionMode: "allow-all",
    tools: { edit_plan: EDIT_PLAN },
  });
  const turnsForked: Fiber.Fiber<void>[] = [];
  const sandbox = sandboxDouble((command) =>
    command === "git branch --show-current"
      ? { exitCode: 0, stdout: `${BRANCH}\n`, stderr: "" }
      : undefined,
  );
  // The checkout the first turn's open would have cloned.
  sandbox.checkedOut = "acme/relay";
  const seams: HarnessSessionsSeams = {
    runtime: CODER_RUNTIME.CLAUDE_CODE,
    openConversation: (target, _agent, parkedState) =>
      Effect.promise(async (): Promise<HarnessConversation> => {
        const session = await agent.createSession({
          sessionId: target.conversationId,
          sandboxSession: {
            defaultWorkingDirectory: "/vercel/sandbox",
            run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          } as never,
          ...(parkedState === undefined ? undefined : { resumeFrom: parkedState as never }),
        });
        return {
          modelId: "claude-opus-5-5",
          sandbox,
          turn: async (prompt, abortSignal) =>
            (await agent.stream({ session, prompt, abortSignal })).fullStream,
          park: () => session.stop(),
        };
      }),
    parked: new Map(),
    running: new Map(),
    writer: () => storeWriter({ tools: HARNESS_TOOL_SET }),
    now: () => NOW,
    fork: (turn: Effect.Effect<void, never, HarnessServices>) =>
      Effect.map(Effect.forkDetach(turn), (fiber) => {
        turnsForked.push(fiber);
      }),
  };
  const settled = Effect.suspend(() => Fiber.joinAll(turnsForked.splice(0)));
  return { seams, settled, running: seams.running };
}

/** An account with one agent started on a plan, on the model given. */
const openAgent = (model = "anthropic/claude-opus-5.5") =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* createPlan(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
    const started = yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: `start-${model}-${userId}`,
      model,
      effort: "high",
      planSnapshot: PLAN_TEXT,
      task: null,
      repository: "acme/relay",
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    const target: ConversationTarget = { userId, conversationId: agent.conversationId };
    return { userId, agent, target };
  });

/** The transcript as the agent's tab reads it, from the start. */
const transcriptOf = (target: ConversationTarget, createdAt: Date) =>
  transcriptPast(target, HARNESS_TOOL_SET, CURSOR_START, { createdAt }).pipe(
    Effect.provide(modelCatalogOf(CATALOG)),
  );

/** Each tool part of the assistant's answers as the tab draws it: its name and input. */
const callsOf = (page: Effect.Success<ReturnType<typeof transcriptOf>>) =>
  page.messages
    .filter((message) => message.role === MESSAGE_ROLE.ASSISTANT)
    .flatMap((message) => message.parts.filter(isToolUIPart))
    .map((part) => ({
      name: part.type.replace(/^tool-/u, ""),
      input: part.input,
      output: part.output,
    }));

it.layer(Layer.mergeAll(testSqlClient, noNetwork))(
  "SPIKE: a coding agent on an official harness",
  (it) => {
    it.effect(
      "a Start on Claude Code writes the turn as the tab reads an eve turn: thinking, calls in the agent's own vocabulary, the host tool's notes, the answer, and the usage",
      () =>
        Effect.gen(function* () {
          const { userId, agent, target } = yield* openAgent();
          const harness = harnessOver([claudeCodeTurn]);
          const sessions = yield* harnessSessions(harness.seams, userId);
          const opened = yield* sessions.open({
            conversationId: agent.conversationId,
            turn: BRAIN_HOST_TURN.TYPED,
            message: PLAN_TEXT,
          });
          assert.deepEqual(opened, {
            outcome: "accepted",
            sessionId: harnessSessionId(agent.conversationId),
          });
          yield* harness.settled;

          assert.equal(
            yield* recordedRuntimeSession(target),
            harnessSessionId(agent.conversationId),
          );
          const page = yield* transcriptOf(target, agent.createdAt);
          assert.equal(page.status, CODING_AGENT_STATUS.COMPLETED);
          const [plan, answer] = page.messages;
          assert.equal(plan?.role, MESSAGE_ROLE.USER);
          assert.equal(plan?.parts.find(isTextUIPart)?.text, PLAN_TEXT);
          assert.equal(
            answer?.parts.find(isReasoningUIPart)?.text,
            "Read the guide, then the invite route.",
          );
          assert.deepEqual(
            callsOf(page).map(({ name, input }) => ({ name, input })),
            [
              { name: "bash", input: { command: "cat AGENTS.md" } },
              { name: "read_file", input: { filePath: "src/invite.ts" } },
              {
                name: "apply_patch",
                input: {
                  patchText:
                    "*** Begin Patch\n*** Update File: src/invite.ts\n@@\n-export {};\n+export const invite = (email: string) => email;\n*** End Patch",
                },
              },
              {
                name: "todo_list",
                input: { todos: [{ content: "Add the route", status: "completed" }] },
              },
              {
                name: "edit_plan",
                input: { notes: [{ kind: "add", text: "Invites expire after a week." }] },
              },
            ],
          );
          assert.deepEqual(callsOf(page)[0]?.output, {
            status: "completed",
            exitCode: 0,
            stdout: "# Agent guide\n",
            stderr: "",
          });
          assert.deepEqual(callsOf(page)[1]?.output, { content: "export {};\n" });
          assert.deepEqual(callsOf(page)[4]?.output, { status: "taken", taken: 1 });
          assert.equal(
            answer?.parts.filter(isTextUIPart).at(-1)?.text,
            "The invite route is in. Pushed the branch.",
          );
          assert.deepEqual(page.turnUsage?.inputTokens, 3_500);
          assert.deepEqual(page.turnUsage?.outputTokens, 120);
          const row = yield* readCodingAgent(userId, agent.id);
          assert.equal(Option.getOrUndefined(row)?.branch, BRANCH);
        }),
    );

    it.effect(
      "a Codex turn's patch is the agent's own patch, its path-only change is kept apart, and usage told on its end alone is the turn's",
      () =>
        Effect.gen(function* () {
          const { userId, agent, target } = yield* openAgent("openai/gpt-6.1-sol");
          const harness = harnessOver([codexTurn]);
          const sessions = yield* harnessSessions(harness.seams, userId);
          yield* sessions.open({
            conversationId: agent.conversationId,
            turn: BRAIN_HOST_TURN.TYPED,
            message: "Fix the failing test.",
          });
          yield* harness.settled;

          const page = yield* transcriptOf(target, agent.createdAt);
          const calls = callsOf(page);
          assert.deepEqual(
            calls.map(({ name }) => name),
            ["bash", "apply_patch", "file_change"],
          );
          assert.deepEqual(calls[0]?.output, {
            status: "completed",
            exitCode: 1,
            stdout: "1 failing\n",
            stderr: "",
          });
          assert.deepEqual(calls[1]?.input, {
            patchText: "*** Begin Patch\n*** Update File: src/invite.ts\n@@\n-a\n+b\n*** End Patch",
          });
          assert.deepEqual(calls[2]?.input, { event: "modify", path: "src/invite.ts" });
          assert.equal(page.turnUsage?.inputTokens, 9_000);
          assert.equal(page.turnUsage?.outputTokens, 300);
        }),
    );

    it.effect(
      "a message after the turn ends opens the next turn on the session the last one parked, and takes the line the developer sent",
      () =>
        Effect.gen(function* () {
          const { userId, agent, target } = yield* openAgent();
          const harness = harnessOver([claudeCodeTurn, followUpTurn]);
          const sessions = yield* harnessSessions(harness.seams, userId);
          yield* sessions.open({
            conversationId: agent.conversationId,
            turn: BRAIN_HOST_TURN.TYPED,
            message: PLAN_TEXT,
          });
          yield* harness.settled;
          const writer = yield* storeWriter({ tools: HARNESS_TOOL_SET });
          const line = { text: "Also add a resend button.", clientKey: "line-1" };
          const written = yield* writer.writeAwaitingLine(target, line, Effect.succeed(true));
          assert.ok(Result.isSuccess(written));

          const sent = yield* sessions.send(harnessSessionId(agent.conversationId), {
            conversationId: agent.conversationId,
            turn: BRAIN_HOST_TURN.TYPED,
            message: line.text,
          });
          assert.equal(sent.outcome, "accepted");
          yield* harness.settled;

          const page = yield* transcriptOf(target, agent.createdAt);
          const texts = page.messages.map((message) => ({
            role: message.role,
            text: message.parts.filter(isTextUIPart).at(-1)?.text,
          }));
          assert.deepEqual(texts.slice(-2), [
            { role: MESSAGE_ROLE.USER, text: "Also add a resend button." },
            { role: MESSAGE_ROLE.ASSISTANT, text: "Resumed: done." },
          ]);
          assert.equal(page.status, CODING_AGENT_STATUS.COMPLETED);
        }),
    );

    it.effect("a Stop aborts the turn under way, which the store records as cancelled", () =>
      Effect.gen(function* () {
        const { userId, agent, target } = yield* openAgent();
        const parked = yield* Deferred.make<void>();
        const harness = harnessOver([longTurn], parked);
        const sessions = yield* harnessSessions(harness.seams, userId);
        yield* sessions.open({
          conversationId: agent.conversationId,
          turn: BRAIN_HOST_TURN.TYPED,
          message: PLAN_TEXT,
        });
        // The turn stands once the harness is working in it, which is when a Stop has something to stop.
        yield* Deferred.await(parked);
        const running = harness.running.get(agent.conversationId);
        assert.ok(running !== undefined);
        const busy = yield* sessions.send(harnessSessionId(agent.conversationId), {
          conversationId: agent.conversationId,
          turn: BRAIN_HOST_TURN.TYPED,
          message: "And this?",
        });
        assert.equal(busy.outcome, "not_ready");

        const cancelled = yield* sessions.cancel(
          harnessSessionId(agent.conversationId),
          running.eveTurnId,
        );
        assert.deepEqual(cancelled, { outcome: "accepted" });
        yield* harness.settled;

        const turns = yield* latestTurnsOf(userId, [agent.conversationId]);
        assert.equal(turns.get(agent.conversationId)?.status, "cancelled");
        const page = yield* transcriptOf(target, agent.createdAt);
        assert.equal(page.status, CODING_AGENT_STATUS.CANCELLED);
        assert.deepEqual(
          yield* sessions.cancel(harnessSessionId(agent.conversationId), running.eveTurnId),
          { outcome: "no_active_turn" },
        );
      }),
    );
  },
);

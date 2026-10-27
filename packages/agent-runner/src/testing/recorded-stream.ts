/**
 * recorded-stream.ts -- P00's recorded stream, as the runner's tests replay it: the SDK messages of the probe's workflow turn and its stopped turn, cut into the steps the CLI took between Luke's lines.
 *
 * P00 merged with a placeholder live recording, so this is its hermetic
 * stream (`tools/claude-code-probe/tests/verdict.test.ts`'s `firstLaunch`),
 * in the pinned SDK's (0.3.304) message shapes. What that stream does not
 * show is built from the SDK's own types and marked as such: the partial
 * messages `includePartialMessages` adds (`SDKPartialAssistantMessage`), and
 * the Stop hook's input before each `result` (`StopHookInput`'s
 * `background_tasks` and `session_crons`).
 */

import type { BackgroundTaskSummary, SessionCronSummary } from "@anthropic-ai/claude-agent-sdk";

/** One JSON value, as a message crosses the CLI's stdout. */
type Recorded =
  | string
  | number
  | boolean
  | null
  | readonly Recorded[]
  | { readonly [key: string]: Recorded };

const SESSION = "00000000-0000-4000-8000-000000000001";
const NONCE = "a1b2c3d4e5f6";

/** The words the probe's turns end on (`tools/claude-code-probe/src/verdict.ts`'s `TURN_DONE`). */
export const TURN_DONE = { FIRST: "LUKE-PROBE-TURN-1-DONE" } as const;

/** The marker of the probe's stopped command (`tools/claude-code-probe/src/turns.ts`'s `STOPPED_COMMAND`). */
export const STOPPED_COMMAND = "sleep 600";

let uuid = 0;
function nextUuid(): string {
  uuid += 1;
  return `00000000-0000-4000-8000-${String(uuid).padStart(12, "0")}`;
}

const INIT: Recorded = {
  type: "system",
  subtype: "init",
  session_id: SESSION,
  apiKeySource: "none",
  claude_code_version: "2.1.304",
  cwd: "/workspace/repository",
  tools: ["Bash", "Edit", "Write", "ScheduleWakeup", "mcp__luke__read_inbox"],
  mcp_servers: [{ name: "luke", status: "connected" }],
  model: "claude-sonnet",
  permissionMode: "bypassPermissions",
  uuid: nextUuid(),
};

function toolUse(name: string, input: Recorded): Recorded {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: `toolu_${name}`, name, input }] },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

function toolResult(id: string, text: string): Recorded {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }],
    },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

function said(text: string): Recorded {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

/** A token of what `said` then delivers whole. Built from the SDK's `SDKPartialAssistantMessage`. */
function partial(text: string): Recorded {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

function result(subtype: string): Recorded {
  return {
    type: "result",
    subtype,
    is_error: subtype !== "success",
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

/** What a Stop hook reports in flight. Built from the SDK's `StopHookInput`. */
export interface StopReport {
  readonly background_tasks: BackgroundTaskSummary[];
  readonly session_crons: SessionCronSummary[];
}

const NOTHING_IN_FLIGHT: StopReport = { background_tasks: [], session_crons: [] };

const BACKGROUND_SLEEP: BackgroundTaskSummary = {
  id: "bash_1",
  type: "shell",
  status: "running",
  description: "sleep 45",
  command: `sleep 45 && echo luke-probe-background-${NONCE}`,
};
export const WAKEUP: SessionCronSummary = {
  id: "cron_1",
  schedule: "17 12 21 10 *",
  recurring: false,
  prompt: "Continue Luke's probe from step 4.",
};

/**
 * What the fake CLI does next: emit a message, run the Stop hook, take Luke's
 * next message into the turn, or hold until it is interrupted or the test
 * releases it.
 */
export type Step =
  | { readonly emit: Recorded }
  | { readonly stopHook: StopReport }
  | { readonly awaitPrompt: true }
  | { readonly untilInterrupted: true }
  | { readonly untilReleased: true };

/**
 * P00's workflow turn, from its prompt: an edit, the leak check, a background
 * command, and a `ScheduleWakeup`, after which the model turn ends while both
 * are pending; then the wakeup's own model turn, which finishes the work and
 * ends with nothing pending.
 */
export const WORKFLOW_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Write", { file_path: `luke-probe/${NONCE}.txt`, content: NONCE }) },
  { emit: toolResult("toolu_Write", "File created") },
  { emit: toolUse("Bash", { command: "bash /opt/luke-probe/leak-check.sh" }) },
  { emit: toolResult("toolu_Bash", 'LUKE_PROBE_LEAK_CHECK {"user":"agent","sudo":false}\n') },
  {
    emit: toolUse("Bash", {
      command: `sleep 45 && echo luke-probe-background-${NONCE}`,
      run_in_background: true,
    }),
  },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 60,
      reason: "wait",
      prompt: "Continue Luke's probe from step 4.",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [BACKGROUND_SLEEP], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { emit: partial("LUKE-PROBE-") },
  { emit: partial("TURN-1-DONE") },
  { emit: said(TURN_DONE.FIRST) },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** P00's stopped turn: a long foreground command, held until Luke's stop interrupts it. */
export const STOPPED_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", { command: STOPPED_COMMAND }) },
  { untilInterrupted: true },
  { emit: result("error_during_execution") },
];

/**
 * A turn held at work until the test releases it, so Luke's second message
 * arrives while it runs and is left for the next turn, which the CLI starts
 * on that message as soon as the first ends.
 */
export const FOLLOW_UP_TURNS: readonly Step[] = [
  { emit: INIT },
  { emit: said("Working on the first message.") },
  { untilReleased: true },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
  { awaitPrompt: true },
  { emit: said("Done with the second.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/**
 * P00's workflow turn up to its wakeup, then a wakeup's turn that starts a
 * long foreground command, held until Luke's stop interrupts it.
 */
export const WAKEUP_STOPPED_TURN: readonly Step[] = [
  { emit: INIT },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 60,
      reason: "wait",
      prompt: "go",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { emit: toolUse("Bash", { command: STOPPED_COMMAND }) },
  { untilInterrupted: true },
  { emit: result("error_during_execution") },
];

/** A turn that ends at its first `result`, with nothing pending. */
export const SHORT_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: said("Done.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** Two turns that each end at their `result` with nothing pending, the second on Luke's next message, as a warm launch takes it. */
export const WARM_TURNS: readonly Step[] = [
  ...SHORT_TURN,
  { awaitPrompt: true },
  { emit: said("Done with the second.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

/** A turn that schedules a wakeup and ends its model turn waiting on it alone, the CLI then held up until the launch ends. */
export const WAKEUP_WAIT: readonly Step[] = [
  { emit: INIT },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 600,
      reason: "wait",
      prompt: "go",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { untilReleased: true },
];

/** A recurring task's wait, the CLI then held up until the launch ends. */
export const RECURRING_WAIT: readonly Step[] = [
  { emit: INIT },
  { emit: said("Checking the deploy every two hours.") },
  {
    stopHook: {
      background_tasks: [],
      session_crons: [{ ...WAKEUP, id: "cron_2", schedule: "3 */2 * * *", recurring: true }],
    },
  },
  { emit: result("success") },
  { untilReleased: true },
];

/** A wait on a background command, the CLI then held up until Luke's stop. */
export const BACKGROUND_WAIT: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", { command: "sleep 45", run_in_background: true }) },
  { stopHook: { background_tasks: [BACKGROUND_SLEEP], session_crons: [] } },
  { emit: result("success") },
  { untilReleased: true },
];

/** A wakeup's wait that a message from Luke interrupts: the message's turn runs, held until the test releases it, and ends with nothing pending. */
export const WAKEUP_WAIT_THEN_MESSAGE: readonly Step[] = [
  { emit: INIT },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 600,
      reason: "wait",
      prompt: "go",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { awaitPrompt: true },
  { emit: said("Taking the message.") },
  { untilReleased: true },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

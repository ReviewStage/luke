import type { BackgroundTaskSummary, SessionCronSummary } from "@anthropic-ai/claude-agent-sdk";

type Recorded =
  | string
  | number
  | boolean
  | null
  | readonly Recorded[]
  | { readonly [key: string]: Recorded };

const SESSION = "00000000-0000-4000-8000-000000000001";
const NONCE = "a1b2c3d4e5f6";

export const TURN_DONE = { FIRST: "AGENT-PROBE-TURN-1-DONE" } as const;

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
  tools: ["Bash", "Edit", "Write", "ScheduleWakeup", "mcp__workspace__read_inbox"],
  mcp_servers: [{ name: "workspace", status: "connected" }],
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

function partial(text: string): Recorded {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
    session_id: SESSION,
    uuid: nextUuid(),
  };
}

function result(subtype: string) {
  return {
    type: "result",
    subtype,
    is_error: subtype !== "success",
    session_id: SESSION,
    uuid: nextUuid(),
  } satisfies Recorded;
}

export const STRAY_RESULT = result("success");

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
  command: `sleep 45 && echo agent-probe-background-${NONCE}`,
};
export const WAKEUP: SessionCronSummary = {
  id: "cron_1",
  schedule: "17 12 21 10 *",
  recurring: false,
  prompt: "Continue Vespin's probe from step 4.",
};

export type Step =
  | { readonly emit: Recorded; readonly namesNoPrompt?: true }
  | { readonly stopHook: StopReport }
  | { readonly awaitPrompt: true }
  | { readonly untilInterrupted: true }
  | { readonly untilReleased: true };

export const WORKFLOW_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Write", { file_path: `agent-probe/${NONCE}.txt`, content: NONCE }) },
  { emit: toolResult("toolu_Write", "File created") },
  { emit: toolUse("Bash", { command: "bash /opt/agent-probe/leak-check.sh" }) },
  { emit: toolResult("toolu_Bash", 'APP_PROBE_LEAK_CHECK {"user":"agent","sudo":false}\n') },
  {
    emit: toolUse("Bash", {
      command: `sleep 45 && echo agent-probe-background-${NONCE}`,
      run_in_background: true,
    }),
  },
  {
    emit: toolUse("ScheduleWakeup", {
      delaySeconds: 60,
      reason: "wait",
      prompt: "Continue Vespin's probe from step 4.",
      noop: false,
    }),
  },
  { stopHook: { background_tasks: [BACKGROUND_SLEEP], session_crons: [WAKEUP] } },
  { emit: result("success") },
  { emit: partial("AGENT-PROBE-") },
  { emit: partial("TURN-1-DONE") },
  { emit: said(TURN_DONE.FIRST) },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

export const STOPPED_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", { command: STOPPED_COMMAND }) },
  { untilInterrupted: true },
  { emit: result("error_during_execution") },
];

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

export const SHORT_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: said("Done.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

export const STRAY_RESULT_THEN_TURN: readonly Step[] = [
  { emit: INIT },
  { emit: STRAY_RESULT, namesNoPrompt: true },
  { emit: said("Done.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

export const STRAY_RESULT_THEN_SILENCE: readonly Step[] = [
  { emit: INIT },
  { emit: STRAY_RESULT, namesNoPrompt: true },
  { untilReleased: true },
];

export const WARM_TURNS: readonly Step[] = [
  ...SHORT_TURN,
  { awaitPrompt: true },
  { emit: said("Done with the second.") },
  { stopHook: NOTHING_IN_FLIGHT },
  { emit: result("success") },
];

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

export const BACKGROUND_WAIT: readonly Step[] = [
  { emit: INIT },
  { emit: toolUse("Bash", { command: "sleep 45", run_in_background: true }) },
  { stopHook: { background_tasks: [BACKGROUND_SLEEP], session_crons: [] } },
  { emit: result("success") },
  { untilReleased: true },
];

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

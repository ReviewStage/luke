import type { WireValue } from "@repo/wire";
import { PROBE_SANDBOX } from "./pins.js";
import {
  accountReading,
  assistantText,
  type LeakReport,
  leakReportIn,
  sessionInit,
  toolCalls,
  toolResultTexts,
  turnResults,
} from "./stream.js";

export const CHECK = {
  PLAN: "the plan works from inside the sandbox",
  TOKEN: "the token stays at the firewall",
} as const;
type Check = (typeof CHECK)[keyof typeof CHECK];

export const TURN_DONE = {
  FIRST: "AGENT-PROBE-TURN-1-DONE",
  RESUMED: "AGENT-PROBE-TURN-3-DONE",
} as const;

export interface ProbeObservations {
  readonly nonce: string;
  readonly sudoApiUser: string | undefined;
  readonly launchUser: string | undefined;
  readonly launchCapEff: string | undefined;
  readonly firstLaunch: readonly WireValue[];
  readonly stoppedTurnEnded: boolean;
  readonly branchPushed: boolean;
  readonly sessionFilesBeforeStop: readonly string[];
  readonly sessionFilesAfterResume: readonly string[];
  readonly resumedLaunch: readonly WireValue[];
  readonly terminalAsToday: LeakReport | undefined;
  readonly terminalCapsDropped: LeakReport | undefined;
  readonly placeholderOutside: string | undefined;
  readonly rootFilesWithTokenShape: number | undefined;
}

export interface Condition {
  readonly check: Check;
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
  readonly gating: boolean;
}

const NO_CAPABILITIES = "0000000000000000";

const UNAUTHENTICATED = /^(401|403)$/;

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function condition(check: Check, name: string, pass: boolean, detail: string): Condition {
  return { check, name, pass, detail, gating: true };
}

function finding(check: Check, name: string, pass: boolean, detail: string): Condition {
  return { check, name, pass, detail, gating: false };
}

function shellIsPrivate(report: LeakReport | undefined): boolean {
  return (
    report !== undefined &&
    !report.sudo &&
    !report.env_token &&
    report.proc_environ_with_token === 0 &&
    report.files_with_token_shape === 0 &&
    !report.agent_home_listable &&
    !report.shadow_readable
  );
}

function describe(report: LeakReport | undefined): string {
  return report === undefined ? "no report" : JSON.stringify(report);
}

function agentLeakReport(messages: readonly WireValue[]): LeakReport | undefined {
  for (const text of toolResultTexts(messages)) {
    const report = leakReportIn(text);
    if (report !== undefined) return report;
  }
  return undefined;
}

function endedWell(messages: readonly WireValue[], words: string): boolean {
  const said = messages.findIndex((message) => assistantText([message]).includes(words));
  if (said === -1) return false;
  const after = turnResults(messages.slice(said + 1))[0];
  return after !== undefined && !after.is_error;
}

function sandboxRunConditions(seen: ProbeObservations): readonly Condition[] {
  const init = sessionInit(seen.firstLaunch);
  const account = accountReading(seen.firstLaunch);
  const calls = toolCalls(seen.firstLaunch);
  const resumedInit = sessionInit(seen.resumedLaunch);
  const fileName = `agent-probe/${seen.nonce}.txt`;
  const billedToPlan =
    init?.apiKeySource === "none" &&
    (account?.subscriptionType ?? "") !== "" &&
    (account?.apiProvider ?? "firstParty") === "firstParty";
  return [
    condition(
      CHECK.PLAN,
      "Claude Code runs as the agent user with no capabilities",
      seen.launchUser === PROBE_SANDBOX.AGENT_USER && seen.launchCapEff === NO_CAPABILITIES,
      `the launch answered as ${seen.launchUser ?? "nobody"}, CapEff ${seen.launchCapEff ?? "unknown"}`,
    ),
    condition(
      CHECK.PLAN,
      "the session started",
      init !== undefined,
      init === undefined
        ? "no init message: the CLI did not start"
        : `claude ${init.claude_code_version}, session started`,
    ),
    condition(
      CHECK.PLAN,
      "Anthropic bills the plan",
      billedToPlan,
      `apiKeySource ${init?.apiKeySource ?? "unknown"}, subscription ${account?.subscriptionType ?? "unknown"}, provider ${account?.apiProvider ?? "unknown"}`,
    ),
    condition(
      CHECK.PLAN,
      "the turn edited a file",
      calls.some((call) => EDIT_TOOLS.has(call.name)),
      calls.map((call) => call.name).join(", ") || "no tool calls",
    ),
    condition(
      CHECK.PLAN,
      "the turn ran a background command",
      calls.some((call) => call.name === "Bash" && call.background),
      "Bash with run_in_background",
    ),
    condition(
      CHECK.PLAN,
      "the turn waited with ScheduleWakeup",
      calls.some((call) => call.name === "ScheduleWakeup"),
      init?.tools.includes("ScheduleWakeup") === false
        ? "ScheduleWakeup is not among the session's tools"
        : "ScheduleWakeup",
    ),
    condition(
      CHECK.PLAN,
      "the turn pushed its branch",
      seen.branchPushed && endedWell(seen.firstLaunch, TURN_DONE.FIRST),
      `branch agent-probe/${seen.nonce} ${seen.branchPushed ? "is" : "is not"} on GitHub`,
    ),
    condition(
      CHECK.PLAN,
      "a stop ended the running turn",
      seen.stoppedTurnEnded,
      "interrupt() during a foreground sleep",
    ),
    condition(
      CHECK.PLAN,
      "the session's files survived a sandbox stop and resume",
      seen.sessionFilesBeforeStop.length > 0 &&
        seen.sessionFilesAfterResume.some((path) => seen.sessionFilesBeforeStop.includes(path)),
      seen.sessionFilesAfterResume.join(", ") || "none found after the resume",
    ),
    condition(
      CHECK.PLAN,
      "a relaunch with resume continued the session",
      resumedInit !== undefined &&
        resumedInit.session_id === init?.session_id &&
        assistantText(seen.resumedLaunch).includes(fileName) &&
        endedWell(seen.resumedLaunch, TURN_DONE.RESUMED),
      resumedInit === undefined
        ? "the relaunch did not start"
        : `resumed ${resumedInit.session_id === init?.session_id ? "the same" : "another"} session`,
    ),
  ];
}

function tokenConditions(seen: ProbeObservations): readonly Condition[] {
  const terminal = seen.terminalCapsDropped;
  const agent = agentLeakReport(seen.firstLaunch);
  return [
    condition(
      CHECK.TOKEN,
      "a Terminal's shell, capabilities dropped, has no sudo and no capabilities",
      terminal !== undefined && !terminal.sudo && terminal.cap_eff === NO_CAPABILITIES,
      describe(terminal),
    ),
    condition(
      CHECK.TOKEN,
      "a Terminal's shell, capabilities dropped, cannot read the token, the CLI's environment, the session, or /etc/shadow",
      shellIsPrivate(terminal),
      describe(terminal),
    ),
    condition(
      CHECK.TOKEN,
      "a Terminal's shell reaches Anthropic with no credential",
      terminal !== undefined && UNAUTHENTICATED.test(terminal.anthropic_http),
      `Anthropic answered ${terminal?.anthropic_http ?? "nothing"}`,
    ),
    condition(
      CHECK.TOKEN,
      "Claude Code runs on a placeholder, not the token",
      agent?.env_token === true && !agent.env_token_shaped,
      describe(agent),
    ),
    condition(
      CHECK.TOKEN,
      "a command the agent runs finds no token",
      agent !== undefined &&
        !agent.sudo &&
        !agent.env_token_shaped &&
        agent.proc_environ_token_shaped === 0 &&
        agent.files_with_token_shape === 0,
      describe(agent),
    ),
    condition(
      CHECK.TOKEN,
      "Anthropic refuses the placeholder outside the sandbox",
      seen.placeholderOutside !== undefined && UNAUTHENTICATED.test(seen.placeholderOutside),
      `Anthropic answered ${seen.placeholderOutside ?? "nothing"}`,
    ),
    condition(
      CHECK.TOKEN,
      "no file on the disk holds the token",
      seen.rootFilesWithTokenShape === 0,
      `${seen.rootFilesWithTokenShape ?? "unknown"} token-shaped files, as root`,
    ),
    condition(
      CHECK.TOKEN,
      "the Sandbox API's sudo reaches root",
      seen.sudoApiUser === "root",
      `a sudo command answered as ${seen.sudoApiUser ?? "nobody"}`,
    ),
    finding(
      CHECK.TOKEN,
      "a Terminal's shell as it is today, capabilities kept, cannot read the token or the CLI's environment",
      shellIsPrivate(seen.terminalAsToday),
      describe(seen.terminalAsToday),
    ),
  ];
}

export function verdict(seen: ProbeObservations): readonly Condition[] {
  return [...sandboxRunConditions(seen), ...tokenConditions(seen)];
}

export function passed(conditions: readonly Condition[]): boolean {
  return conditions.every((each) => each.pass || !each.gating);
}

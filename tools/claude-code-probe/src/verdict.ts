/**
 * verdict.ts -- the plan's two checks, each a list of conditions read off what the probe observed, and whether each held.
 *
 * Check one is that the plan works from inside the sandbox: a turn that
 * edits, runs a background command, waits with `ScheduleWakeup`, pushes, is
 * stopped, and resumes in a relaunched CLI after the sandbox stopped and
 * resumed, billed to the plan. Check two is that the token stays at the
 * sandbox's firewall: Claude Code runs on a placeholder the firewall swaps
 * for it, which is refused anywhere else, no command the agent runs and no
 * file holds the token, a Terminal's shell reads neither it nor the
 * placeholder, and Vespin can still launch as root through the Sandbox
 * API's sudo. Claude Code runs no command sandbox, so a command the agent
 * runs reads the placeholder, which is what the design accepts.
 *
 * The sandbox's default user holds the full capability set without sudo
 * (P16's finding), so a Terminal's shell as it is today reads another
 * user's environment whatever sudoers says. The gating Terminal conditions
 * are therefore read from a shell with every capability dropped, the remedy
 * P03 would carry; the shell as it is today is reported beside them as a
 * finding that gates nothing.
 */

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

/** The words each turn ends on, which the probe's prompts ask for. */
export const TURN_DONE = {
  FIRST: "AGENT-PROBE-TURN-1-DONE",
  RESUMED: "AGENT-PROBE-TURN-3-DONE",
} as const;

/** What the probe saw, gathered by the run; every field is what a step observed, or none where the step never got there. */
export interface ProbeObservations {
  /** The run's own nonce, which names the file and branch the first turn makes. */
  readonly nonce: string;
  /** The user a Sandbox API command with `sudo` reached. */
  readonly sudoApiUser: string | undefined;
  /** The user and effective capabilities the launch's drop answered with (`AS_AGENT`). */
  readonly launchUser: string | undefined;
  readonly launchCapEff: string | undefined;
  /** The first launch's messages, through the first turn and the stopped one. */
  readonly firstLaunch: readonly WireValue[];
  /** Whether the turn the probe stopped ended with a result. */
  readonly stoppedTurnEnded: boolean;
  /** Whether the branch the first turn pushed is on GitHub. */
  readonly branchPushed: boolean;
  /** The session's files on the sandbox disk before the sandbox stopped, and after it resumed. */
  readonly sessionFilesBeforeStop: readonly string[];
  readonly sessionFilesAfterResume: readonly string[];
  /** The launch after the resume, with `resume` set to the first launch's session. */
  readonly resumedLaunch: readonly WireValue[];
  /** The leak check from a Terminal's shell as it is today: the default user, no sudo, capabilities kept, while the CLI ran. */
  readonly terminalAsToday: LeakReport | undefined;
  /** The same shell with every capability dropped (`DROP_CAPABILITIES`). */
  readonly terminalCapsDropped: LeakReport | undefined;
  /** What Anthropic answered the placeholder with from outside the sandbox, the probe's own machine. */
  readonly placeholderOutside: string | undefined;
  /** How many files outside `/proc` hold a token-shaped string, as root sees the disk. */
  readonly rootFilesWithTokenShape: number | undefined;
}

export interface Condition {
  readonly check: Check;
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
  /** Whether the check's verdict rests on it; a finding that gates nothing is reported alone. */
  readonly gating: boolean;
}

/** The effective capability set of a process that holds none. */
const NO_CAPABILITIES = "0000000000000000";

/** A status that says Anthropic answered and refused for want of a credential. */
const UNAUTHENTICATED = /^(401|403)$/;

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function condition(check: Check, name: string, pass: boolean, detail: string): Condition {
  return { check, name, pass, detail, gating: true };
}

function finding(check: Check, name: string, pass: boolean, detail: string): Condition {
  return { check, name, pass, detail, gating: false };
}

/** Whether a shell's report shows it can reach neither the token, the CLI's environment and the placeholder in it, the session, nor root's secrets. */
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

/** The leak check the agent ran through its Bash tool, read back from the tool's result. */
function agentLeakReport(messages: readonly WireValue[]): LeakReport | undefined {
  for (const text of toolResultTexts(messages)) {
    const report = leakReportIn(text);
    if (report !== undefined) return report;
  }
  return undefined;
}

/**
 * Whether the turn that said its closing words ended well: some message
 * says them, and a result after it reports no error. Note that the words
 * alone are not enough, because a turn can say them and still fail.
 */
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

/** Whether every condition the verdict rests on held; findings that gate nothing are left out. */
export function passed(conditions: readonly Condition[]): boolean {
  return conditions.every((each) => each.pass || !each.gating);
}

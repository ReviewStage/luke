/**
 * verdict.ts -- the plan's two checks, each a list of conditions read off what the probe observed, and whether each held.
 *
 * Check one is that the plan works from inside the sandbox: a turn that
 * edits, runs a background command, waits with `ScheduleWakeup`, pushes, is
 * stopped, and resumes in a relaunched CLI after the sandbox stopped and
 * resumed, billed to the plan. Check two is that the token stays with the
 * CLI: neither a Terminal's shell nor a command the agent runs can read it
 * or call Anthropic with it, no file holds it, and Luke can still launch as
 * root through the Sandbox API's sudo.
 *
 * The sandbox's default user holds the full capability set without sudo
 * (P16's finding), so a Terminal's shell as it is today reads another
 * user's environment whatever sudoers says. The gating Terminal conditions
 * are therefore read from a shell with every capability dropped, the remedy
 * P03 would carry; the shell as it is today, the agent's own uid outside
 * the command sandbox, and bubblewrap's start with and without
 * capabilities are reported beside them as findings that gate nothing.
 */

import type { WireValue } from "@luke/wire";
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
  TOKEN: "the token stays with the CLI",
} as const;
type Check = (typeof CHECK)[keyof typeof CHECK];

/** The words each turn ends on, which the probe's prompts ask for. */
export const TURN_DONE = {
  FIRST: "LUKE-PROBE-TURN-1-DONE",
  RESUMED: "LUKE-PROBE-TURN-3-DONE",
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
  /** The agent's own uid outside the command sandbox, capabilities dropped, while the CLI ran. */
  readonly agentUid: LeakReport | undefined;
  /** Whether bubblewrap started in a Terminal's shell as it is today (capabilities kept), and as the agent user with every capability dropped (`started` or `refused`). */
  readonly bubblewrapCapsKept: string | undefined;
  readonly bubblewrapCapsDropped: string | undefined;
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

/** An HTTP status that is not a success, including none at all (`000`), which is a call refused before it left. */
const NOT_CALLABLE = /^(000|4\d\d)$/;

/** A status that says Anthropic answered and refused for want of a credential. */
const UNAUTHENTICATED = /^(401|403)$/;

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function condition(check: Check, name: string, pass: boolean, detail: string): Condition {
  return { check, name, pass, detail, gating: true };
}

function finding(check: Check, name: string, pass: boolean, detail: string): Condition {
  return { check, name, pass, detail, gating: false };
}

/** Whether a shell's report shows it can reach neither the token, the session, nor root's secrets. */
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
  const fileName = `luke-probe/${seen.nonce}.txt`;
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
      "the session started with its command sandbox on",
      init !== undefined,
      init === undefined
        ? "no init message: the CLI did not start (failIfUnavailable refuses a missing sandbox)"
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
      `branch luke-probe/${seen.nonce} ${seen.branchPushed ? "is" : "is not"} on GitHub`,
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
      "a Terminal's shell, capabilities dropped, cannot read the token, the session, or /etc/shadow",
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
      "a command the agent runs cannot read the token",
      agent !== undefined &&
        !agent.sudo &&
        !agent.env_token &&
        agent.proc_environ_with_token === 0 &&
        agent.files_with_token_shape === 0,
      describe(agent),
    ),
    condition(
      CHECK.TOKEN,
      "a command the agent runs cannot call Anthropic",
      agent !== undefined && NOT_CALLABLE.test(agent.anthropic_http),
      `Anthropic answered ${agent?.anthropic_http ?? "nothing"}`,
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
      "a Terminal's shell as it is today, capabilities kept, cannot read the token",
      shellIsPrivate(seen.terminalAsToday),
      describe(seen.terminalAsToday),
    ),
    finding(
      CHECK.TOKEN,
      "the agent's own uid, outside the command sandbox, cannot read the CLI's environment",
      seen.agentUid !== undefined && seen.agentUid.proc_environ_with_token === 0,
      describe(seen.agentUid),
    ),
    finding(
      CHECK.TOKEN,
      "bubblewrap starts in a Terminal's shell as it is today, capabilities kept",
      seen.bubblewrapCapsKept === "started",
      seen.bubblewrapCapsKept ?? "not tried",
    ),
    finding(
      CHECK.TOKEN,
      "bubblewrap starts as the agent user with every capability dropped",
      seen.bubblewrapCapsDropped === "started",
      seen.bubblewrapCapsDropped ?? "not tried",
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

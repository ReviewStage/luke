/**
 * checks.ts -- what the probe observed, judged: each of P16's conditions as one named check that passed, failed, needs a person's eyes, or could not run, read from the recorded app-server messages and the scanner's reports.
 *
 * The judging is kept apart from the sandbox so it is a pure function a test
 * drives with a recording: the live run gathers `Observations`, and
 * `judge` says what they prove. A check reads only what Codex or the
 * sandbox reported, never what the model claimed about itself, except where
 * the claim is the point (that Codex quoted a marker only the end of a long
 * command prints).
 */

import { createHash } from "node:crypto";
import {
  isRecord,
  isWireNumber,
  isWireString,
  valueFromJsonText,
  type WireRecord,
  type WireValue,
} from "@luke/wire";
import { METHOD, PROBE_MCP } from "./app-server.js";
import { SCAN_MARKER } from "./sandbox-scripts.js";

/** How a check came out. */
export const VERDICT = {
  PASS: "pass",
  FAIL: "fail",
  MANUAL: "manual",
  SKIPPED: "skipped",
} as const;

export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

/** P16's conditions, under the plan's two checks. */
export const CHECK = {
  SIGN_IN: "plan.sign-in",
  TURN: "plan.turn-completes",
  EDIT: "plan.edits",
  COMMAND: "plan.runs-a-command",
  MCP: "plan.calls-an-mcp-tool",
  STEER: "plan.is-steered",
  INTERRUPT: "plan.is-interrupted",
  REFRESH: "plan.token-refreshes",
  RESUME: "plan.resumes-after-restart",
  CHATGPT_USAGE: "plan.usage-on-chatgpt-plan",
  CI_WAIT: "plan.waits-on-ci",
  CODEX_COMMAND: "token.not-in-codex-commands",
  MCP_SERVER: "token.not-in-mcp-server",
  BWRAP: "token.codex-command-sandbox-runs",
  TERMINAL: "token.not-from-terminal",
  TERMINAL_NO_CAPS: "token.not-from-terminal-without-capabilities",
  SUDO_DROPPED: "token.terminal-sudo-dropped",
  LAUNCH_WITHOUT_SUDOERS: "token.launch-after-sudoers-dropped",
  DISK: "token.not-on-disk",
  LAUNCH_PATHS: "token.launch-paths-not-writable",
} as const;

export type CheckId = (typeof CHECK)[keyof typeof CHECK];

/** One check's outcome, its detail safe to print. */
export interface CheckResult {
  readonly id: CheckId;
  readonly verdict: Verdict;
  readonly detail: string;
}

/** One message as the probe recorded it, in the order it crossed. */
export interface RecordedMessage {
  /** Which app-server process: `first` before the restart, `resumed` after. */
  readonly phase: string;
  readonly direction: "client" | "server";
  readonly message: WireValue;
}

/** What the scanner reported from one seat. */
export interface ScanReport {
  readonly uid: number;
  readonly user: string;
  readonly capEff: string | null;
  readonly ownEnvHasAccessToken: boolean;
  readonly environsReadable: number;
  readonly environsDenied: number;
  readonly processesWithAccessToken: readonly string[];
  readonly jwtSha256: readonly { readonly sha256: string; readonly where: string }[];
}

/** Everything the live run gathered, for `judge` to read. */
export interface Observations {
  readonly signedIn: boolean;
  readonly nonce: string;
  readonly steerMarker: string;
  readonly ciMarker: string;
  readonly ciSeconds: number;
  /** SHA-256 of every access token the run used, the first and the refreshed. */
  readonly tokenSha256: readonly string[];
  readonly messages: readonly RecordedMessage[];
  readonly steerTurnId: string | undefined;
  readonly probeFile: string | undefined;
  readonly refreshed: boolean | undefined;
  readonly resumedTurnCount: number | undefined;
  readonly scans: {
    readonly terminal?: ScanReport | undefined;
    readonly terminalNoCaps?: ScanReport | undefined;
    readonly disk?: ScanReport | undefined;
  };
  readonly defaultUserSudoAfterDrop: boolean | undefined;
  readonly apiSudoAfterDrop: boolean | undefined;
  readonly writablePaths: readonly string[] | undefined;
}

/** SHA-256 of a string, hex, as the scanner writes it. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A scanner report line read back, from anywhere in a command's output. */
export function readScan(output: string): ScanReport | undefined {
  const line = output.split("\n").find((one) => one.startsWith(SCAN_MARKER));
  if (line === undefined) return undefined;
  const value = valueFromJsonText(line.slice(SCAN_MARKER.length));
  if (!isRecord(value)) return undefined;
  const number = (key: string): number => {
    const one = value[key];
    return isWireNumber(one) ? one : 0;
  };
  const processes = Array.isArray(value.processesWithAccessToken)
    ? value.processesWithAccessToken.filter(isRecord)
    : [];
  const hashes = Array.isArray(value.jwtSha256) ? value.jwtSha256.filter(isRecord) : [];
  return {
    uid: number("uid"),
    user: isWireString(value.user) ? value.user : "?",
    capEff: isWireString(value.capEff) ? value.capEff : null,
    ownEnvHasAccessToken: value.ownEnvHasAccessToken === true,
    environsReadable: number("environsReadable"),
    environsDenied: number("environsDenied"),
    processesWithAccessToken: processes.map(
      (one) =>
        `${isWireNumber(one.pid) ? one.pid : "?"}:${isWireString(one.comm) ? one.comm : "?"}`,
    ),
    jwtSha256: hashes.flatMap((one) =>
      isWireString(one.sha256) && isWireString(one.where)
        ? [{ sha256: one.sha256, where: one.where }]
        : [],
    ),
  };
}

/** The server's notifications of one method, their params, in order. */
function notifications(
  messages: readonly RecordedMessage[],
  method: string,
): readonly WireRecord[] {
  return messages.flatMap((one) => {
    const message = one.message;
    if (one.direction !== "server" || !isRecord(message) || message.method !== method) return [];
    return isRecord(message.params) ? [message.params] : [];
  });
}

/** Every item Codex completed, in order. */
function completedItems(messages: readonly RecordedMessage[]): readonly WireRecord[] {
  return notifications(messages, METHOD.ITEM_COMPLETED).flatMap((params) =>
    isRecord(params.item) ? [params.item] : [],
  );
}

/** Every turn Codex completed, in order, with the phase it completed in. */
function completedTurns(
  messages: readonly RecordedMessage[],
): readonly { phase: string; turn: WireRecord }[] {
  return messages.flatMap((one) => {
    const message = one.message;
    if (
      one.direction !== "server" ||
      !isRecord(message) ||
      message.method !== METHOD.TURN_COMPLETED
    )
      return [];
    const params = message.params;
    return isRecord(params) && isRecord(params.turn)
      ? [{ phase: one.phase, turn: params.turn }]
      : [];
  });
}

/** An item's field as text, empty where absent. */
function textOf(item: WireRecord, key: string): string {
  const value = item[key];
  return isWireString(value) ? value : "";
}

/** An MCP tool call's result text, joined. */
function mcpResultText(item: WireRecord): string {
  const result = item.result;
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content.map((part) => (isRecord(part) ? textOf(part, "text") : "")).join("\n");
}

/** A check from a condition, with the detail either way. */
function check(id: CheckId, passed: boolean, detail: string): CheckResult {
  return { id, verdict: passed ? VERDICT.PASS : VERDICT.FAIL, detail };
}

/** A check that could not run because what it reads was never observed. */
function skipped(id: CheckId, detail: string): CheckResult {
  return { id, verdict: VERDICT.SKIPPED, detail };
}

/** Whether a scan saw the token: a process holding `ACCESS_TOKEN`, its own environment, or a hash of it. */
function scanSawToken(scan: ScanReport, tokenSha256: readonly string[]): string | undefined {
  if (scan.ownEnvHasAccessToken) return "ACCESS_TOKEN is in its own environment";
  if (scan.processesWithAccessToken.length > 0) {
    return `read ACCESS_TOKEN from ${scan.processesWithAccessToken.join(", ")}`;
  }
  const hit = scan.jwtSha256.find((one) => tokenSha256.includes(one.sha256));
  return hit === undefined ? undefined : `found the token at ${hit.where}`;
}

/** A scan judged: passes where the seat could not see the token. */
function scanCheck(
  id: CheckId,
  scan: ScanReport | undefined,
  tokenSha256: readonly string[],
): CheckResult {
  if (scan === undefined) return skipped(id, "no scan report from this seat");
  const saw = scanSawToken(scan, tokenSha256);
  const seat = `uid ${scan.uid} (${scan.user}), CapEff ${scan.capEff ?? "?"}, ${scan.environsReadable} environments readable, ${scan.environsDenied} denied`;
  return check(id, saw === undefined, saw === undefined ? seat : `${saw}; ${seat}`);
}

/** The plan checks: the first turn, its tools, steer, interrupt, the restart, usage and waiting. */
function workChecks(seen: Observations): readonly CheckResult[] {
  const items = completedItems(seen.messages);
  const turns = completedTurns(seen.messages);
  const commands = items.filter((item) => item.type === "commandExecution");
  const mcpCalls = items.filter(
    (item) => item.type === "mcpToolCall" && item.server === PROBE_MCP.SERVER,
  );
  const echoed = mcpCalls.find((item) =>
    mcpResultText(item).includes(`luke-probe-echo:${seen.nonce}`),
  );
  const firstTurn = turns.find((one) => one.phase === "first");
  const interrupted = turns.find((one) => one.turn.status === "interrupted");
  const resumed = turns.find((one) => one.phase === "resumed" && one.turn.status === "completed");
  const resumedAnswer = items.some(
    (item) => item.type === "agentMessage" && textOf(item, "text").includes(seen.nonce),
  );
  const ciLine = `all checks passed: ${seen.ciMarker}`;
  const ciCommand = commands.find((item) => textOf(item, "aggregatedOutput").includes(ciLine));
  const ciQuoted = items.some(
    (item) => item.type === "agentMessage" && textOf(item, "text").includes(ciLine),
  );
  const tiers = notifications(seen.messages, METHOD.RATE_LIMITS).flatMap((params) =>
    isRecord(params.rateLimits) && isWireString(params.rateLimits.planType)
      ? [params.rateLimits.planType]
      : [],
  );
  const usage = notifications(seen.messages, METHOD.TOKEN_USAGE).length;
  return [
    check(
      CHECK.SIGN_IN,
      seen.signedIn,
      "dynamic_agent_client registration, issued client, plan scope granted, ID token verified",
    ),
    firstTurn === undefined
      ? skipped(CHECK.TURN, "the first turn never completed")
      : check(
          CHECK.TURN,
          firstTurn.turn.status === "completed",
          `first turn ended ${String(firstTurn.turn.status)}`,
        ),
    check(
      CHECK.EDIT,
      seen.probeFile?.includes(seen.nonce) === true,
      `PROBE.md ${seen.probeFile === undefined ? "missing" : "read back"}; fileChange items: ${items.filter((item) => item.type === "fileChange").length}`,
    ),
    check(
      CHECK.COMMAND,
      commands.some((item) => item.status === "completed" && item.exitCode === 0),
      `${commands.length} commandExecution items`,
    ),
    check(CHECK.MCP, echoed !== undefined, `${mcpCalls.length} ${PROBE_MCP.SERVER} calls`),
    check(
      CHECK.STEER,
      seen.steerTurnId !== undefined && seen.probeFile?.includes(seen.steerMarker) === true,
      `turn/steer ${seen.steerTurnId === undefined ? "refused" : "accepted"}; steer marker ${seen.probeFile?.includes(seen.steerMarker) === true ? "written" : "not written"}`,
    ),
    interrupted === undefined
      ? check(CHECK.INTERRUPT, false, "no turn ended interrupted")
      : check(CHECK.INTERRUPT, true, "turn/interrupt ended the turn as interrupted"),
    seen.refreshed === undefined
      ? skipped(CHECK.REFRESH, "the refresh never ran")
      : check(CHECK.REFRESH, seen.refreshed, "refresh_token grant under the issued client"),
    resumed === undefined
      ? skipped(CHECK.RESUME, "no turn completed after the restart")
      : check(
          CHECK.RESUME,
          (seen.resumedTurnCount ?? 0) > 0 && resumedAnswer,
          `thread/resume loaded ${seen.resumedTurnCount ?? 0} turns; the answer ${resumedAnswer ? "quotes" : "does not quote"} the first turn's nonce`,
        ),
    tiers.length > 0
      ? {
          id: CHECK.CHATGPT_USAGE,
          verdict: VERDICT.MANUAL,
          detail: `rate limits report plan ${tiers.at(-1)}, ${usage} token-usage updates; confirm the turns on chatgpt.com/settings/usage`,
        }
      : {
          id: CHECK.CHATGPT_USAGE,
          verdict: VERDICT.MANUAL,
          detail: `${usage} token-usage updates, no plan type reported; confirm on chatgpt.com/settings/usage`,
        },
    check(
      CHECK.CI_WAIT,
      ciCommand !== undefined || ciQuoted,
      ciCommand === undefined
        ? `Codex never saw the end of a ${seen.ciSeconds}s watch`
        : `the ${seen.ciSeconds}s watch ran to its end in ${isWireNumber(ciCommand.durationMs) ? Math.round(ciCommand.durationMs / 1000) : "?"}s (source ${textOf(ciCommand, "source")})`,
    ),
  ];
}

/** The token checks: each seat's scan, the MCP server, bwrap, sudo, the disk and the launch paths. */
function tokenChecks(seen: Observations): readonly CheckResult[] {
  const items = completedItems(seen.messages);
  const commandScans = items
    .filter((item) => item.type === "commandExecution")
    .flatMap((item) => {
      const scan = readScan(textOf(item, "aggregatedOutput"));
      return scan === undefined ? [] : [scan];
    });
  const bwrapFailures = items.filter(
    (item) =>
      item.type === "commandExecution" && textOf(item, "aggregatedOutput").startsWith("bwrap:"),
  );
  const mcpAnswers = items
    .filter((item) => item.type === "mcpToolCall")
    .map(mcpResultText)
    .filter((text) => text.includes("access_token_in_env="));
  const writable = seen.writablePaths;
  return [
    scanCheck(CHECK.CODEX_COMMAND, commandScans[0], seen.tokenSha256),
    mcpAnswers.length === 0
      ? skipped(CHECK.MCP_SERVER, "the MCP server never answered")
      : check(
          CHECK.MCP_SERVER,
          mcpAnswers.every((text) => text.includes("access_token_in_env=false")),
          mcpAnswers[0] ?? "",
        ),
    check(
      CHECK.BWRAP,
      bwrapFailures.length === 0 && commandScans.length > 0,
      bwrapFailures.length === 0
        ? "commands ran under workspace-write"
        : textOf(bwrapFailures[0] ?? {}, "aggregatedOutput").trim(),
    ),
    scanCheck(CHECK.TERMINAL, seen.scans.terminal, seen.tokenSha256),
    scanCheck(CHECK.TERMINAL_NO_CAPS, seen.scans.terminalNoCaps, seen.tokenSha256),
    seen.defaultUserSudoAfterDrop === undefined
      ? skipped(CHECK.SUDO_DROPPED, "sudo was never dropped")
      : check(
          CHECK.SUDO_DROPPED,
          !seen.defaultUserSudoAfterDrop,
          `sudo -n true ${seen.defaultUserSudoAfterDrop ? "still works" : "fails"} for the default user`,
        ),
    seen.apiSudoAfterDrop === undefined
      ? skipped(CHECK.LAUNCH_WITHOUT_SUDOERS, "sudo was never dropped")
      : check(
          CHECK.LAUNCH_WITHOUT_SUDOERS,
          seen.apiSudoAfterDrop,
          `the Sandbox API's sudo ${seen.apiSudoAfterDrop ? "still runs as root" : "no longer runs as root"}`,
        ),
    scanCheck(CHECK.DISK, seen.scans.disk, seen.tokenSha256),
    writable === undefined
      ? skipped(CHECK.LAUNCH_PATHS, "not checked")
      : check(
          CHECK.LAUNCH_PATHS,
          writable.length === 0,
          writable.length === 0 ? "none writable by the default user" : writable.join(", "),
        ),
  ];
}

/** Every check, the plan's first and the token's second, in the order the report prints them. */
export function judge(seen: Observations): readonly CheckResult[] {
  return [...workChecks(seen), ...tokenChecks(seen)];
}

/** Whether a probe that observed this passed Gate A2's evidence bar: no check failed or was skipped. */
export function passed(results: readonly CheckResult[]): boolean {
  return results.every((one) => one.verdict === VERDICT.PASS || one.verdict === VERDICT.MANUAL);
}

/** The report as the terminal prints it: one line per check. */
export function formatReport(results: readonly CheckResult[]): string {
  const width = Math.max(...results.map((one) => one.id.length));
  return results
    .map((one) => `${one.verdict.toUpperCase().padEnd(7)} ${one.id.padEnd(width)}  ${one.detail}`)
    .join("\n");
}

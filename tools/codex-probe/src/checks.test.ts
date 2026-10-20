import { readFileSync } from "node:fs";
import path from "node:path";
import { isRecord, isWireString, valueFromJsonText, type WireValue } from "@luke/wire";
import { describe, expect, it } from "vitest";
import {
  CHECK,
  type CheckId,
  judge,
  type Observations,
  passed,
  type RecordedMessage,
  readScan,
  type ScanReport,
  sha256Hex,
  VERDICT,
  type Verdict,
} from "./checks.js";
import { findLeaks } from "./sanitize.js";

// The hermetic recording: codex 0.163.0's app-server driven through the probe's own turns
// (edit, scanner, MCP echo, a CI watch waited out under a steer, an interrupted turn, then a
// restart and thread/resume), with the model scripted by a local Responses server instead of
// the ChatGPT plan, and paths moved to where the live probe puts them. See the PR description.
const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");
const NONCE = "luke-probe-hermetic";

/** A fixture file's lines read back as recorded messages. */
function recording(file: string): readonly RecordedMessage[] {
  return readFileSync(path.join(FIXTURES, file), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const value = valueFromJsonText(line);
      if (!isRecord(value) || (value.direction !== "client" && value.direction !== "server"))
        throw new Error(line);
      return {
        phase: String(value.phase),
        direction: value.direction,
        message: value.message ?? null,
      };
    });
}

/** The result of a server response whose request was of this method, found by id within its phase. */
function resultOf(messages: readonly RecordedMessage[], method: string): WireValue | undefined {
  const request = messages.find((one) => isRecord(one.message) && one.message.method === method);
  if (request === undefined || !isRecord(request.message)) return undefined;
  const id = request.message.id;
  const response = messages.find(
    (one) =>
      one.phase === request.phase &&
      one.direction === "server" &&
      isRecord(one.message) &&
      one.message.id === id &&
      one.message.method === undefined,
  );
  return response !== undefined && isRecord(response.message) ? response.message.result : undefined;
}

/** A scan from a seat that saw nothing. */
const CLEAN_SCAN: ScanReport = {
  uid: 1001,
  user: "vercel-sandbox",
  capEff: "0000000000000000",
  ownEnvHasAccessToken: false,
  environsReadable: 3,
  environsDenied: 20,
  processesWithAccessToken: [],
  jwtSha256: [],
};

/** Observations as the live run would gather them over the hermetic recording. */
function observed(overrides: Partial<Observations> = {}): Observations {
  const messages = recording("hermetic/app-server.jsonl");
  const steer = resultOf(messages, "turn/steer");
  const resumed = resultOf(messages, "thread/resume");
  const thread = isRecord(resumed) ? resumed.thread : undefined;
  return {
    signedIn: true,
    nonce: NONCE,
    steerMarker: `${NONCE}-steered`,
    ciMarker: `${NONCE}-ci`,
    ciSeconds: 15,
    tokenSha256: [sha256Hex("the-access-token")],
    messages,
    steerTurnId: isRecord(steer) && isWireString(steer.turnId) ? steer.turnId : undefined,
    probeFile: `${NONCE}\n${NONCE}-steered\n`,
    refreshed: true,
    resumedTurnCount: isRecord(thread) && Array.isArray(thread.turns) ? thread.turns.length : 0,
    scans: { terminal: CLEAN_SCAN, terminalNoCaps: CLEAN_SCAN, disk: CLEAN_SCAN },
    defaultUserSudoAfterDrop: false,
    apiSudoAfterDrop: true,
    writablePaths: [],
    ...overrides,
  };
}

/** Each check's verdict by id. */
function verdicts(seen: Observations): Map<CheckId, Verdict> {
  return new Map(judge(seen).map((one) => [one.id, one.verdict]));
}

describe("judge over the hermetic recording", () => {
  it("passes every condition the recorded app-server conversation proves", () => {
    const results = verdicts(observed());
    for (const id of [
      CHECK.TURN,
      CHECK.EDIT,
      CHECK.COMMAND,
      CHECK.MCP,
      CHECK.STEER,
      CHECK.INTERRUPT,
      CHECK.RESUME,
      CHECK.CI_WAIT,
      CHECK.CODEX_COMMAND,
      CHECK.MCP_SERVER,
      CHECK.BWRAP,
    ]) {
      expect([id, results.get(id)]).toEqual([id, VERDICT.PASS]);
    }
    expect(results.get(CHECK.CHATGPT_USAGE)).toBe(VERDICT.MANUAL);
    expect(passed(judge(observed()))).toBe(true);
  });

  it("fails the steer when the steered instruction never reached the file", () => {
    expect(verdicts(observed({ probeFile: `${NONCE}\n` })).get(CHECK.STEER)).toBe(VERDICT.FAIL);
  });

  it("fails the CI wait when nothing saw the watch's last line", () => {
    expect(verdicts(observed({ ciMarker: "another-marker" })).get(CHECK.CI_WAIT)).toBe(
      VERDICT.FAIL,
    );
  });
});

describe("judge over a restart or a wait it cannot prove", () => {
  it("fails the resume when only the first turn mentioned the nonce, not the resumed one", () => {
    const messages = observed().messages.map((one) =>
      one.phase === "resumed"
        ? {
            ...one,
            message: JSON.parse(JSON.stringify(one.message).replaceAll(NONCE, "I do not know")),
          }
        : one,
    );
    expect(verdicts(observed({ messages })).get(CHECK.RESUME)).toBe(VERDICT.FAIL);
  });

  it("fails the CI wait when Codex quotes the line but no watch ran to its end", () => {
    const ciLine = `all checks passed: ${NONCE}-ci`;
    const messages = observed().messages.filter(
      (one) =>
        !(
          one.direction === "server" &&
          JSON.stringify(one.message).includes("commandExecution") &&
          JSON.stringify(one.message).includes(ciLine)
        ),
    );
    expect(verdicts(observed({ messages })).get(CHECK.CI_WAIT)).toBe(VERDICT.FAIL);
  });
});

describe("judge over the token's seats", () => {
  it("fails a seat that read ACCESS_TOKEN from another process, as today's default shell can", () => {
    const terminal = {
      ...CLEAN_SCAN,
      capEff: "000001ffffffffff",
      processesWithAccessToken: ["412:codex"],
    };
    const results = judge(observed({ scans: { ...observed().scans, terminal } }));
    expect(results.find((one) => one.id === CHECK.TERMINAL)).toMatchObject({
      verdict: VERDICT.FAIL,
      detail: expect.stringContaining("read ACCESS_TOKEN from 412:codex"),
    });
    expect(passed(results)).toBe(false);
  });

  it("fails the disk when a file holds the token's hash, and passes on another JWT's", () => {
    const hit = {
      ...CLEAN_SCAN,
      jwtSha256: [{ sha256: sha256Hex("the-access-token"), where: "/home/agent/.codex/x" }],
    };
    const miss = {
      ...CLEAN_SCAN,
      jwtSha256: [{ sha256: sha256Hex("someone-else"), where: "/etc/x" }],
    };
    expect(verdicts(observed({ scans: { disk: hit } })).get(CHECK.DISK)).toBe(VERDICT.FAIL);
    expect(verdicts(observed({ scans: { disk: miss } })).get(CHECK.DISK)).toBe(VERDICT.PASS);
  });

  it("skips what was never observed, which keeps the probe from passing", () => {
    const results = judge(
      observed({ scans: {}, defaultUserSudoAfterDrop: undefined, writablePaths: undefined }),
    );
    expect(results.find((one) => one.id === CHECK.TERMINAL_NO_CAPS)?.verdict).toBe(VERDICT.SKIPPED);
    expect(passed(results)).toBe(false);
  });

  it("fails a launch path the default user could rewrite", () => {
    expect(verdicts(observed({ writablePaths: ["/usr/local/bin"] })).get(CHECK.LAUNCH_PATHS)).toBe(
      VERDICT.FAIL,
    );
  });
});

describe("readScan", () => {
  it("reads the scanner's line out of a command's surrounding output", () => {
    const line = `LUKE_PROBE_SCAN ${JSON.stringify({ ...CLEAN_SCAN, processesWithAccessToken: [{ pid: 7, comm: "codex" }] })}`;
    expect(readScan(`noise\n${line}\nmore`)).toEqual({
      ...CLEAN_SCAN,
      processesWithAccessToken: ["7:codex"],
    });
    expect(readScan("no report here")).toBeUndefined();
  });
});

describe("the committed fixtures", () => {
  it("hold nothing secret-shaped", () => {
    for (const file of ["hermetic/app-server.jsonl", "live/report.json"]) {
      expect([file, findLeaks(readFileSync(path.join(FIXTURES, file), "utf8"), [])]).toEqual([
        file,
        [],
      ]);
    }
  });
});

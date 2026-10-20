/**
 * driver.test.ts -- the in-sandbox driver as a child process: a stop reaches the session while a turn runs a foreground command, and the end of input ends it.
 *
 * The SDK is replaced at its package boundary by a fake that behaves as
 * the SDK does where it matters here: once a turn starts it reads no
 * further prompt until the turn ends, and the turn (a foreground command)
 * runs until `interrupt()` is called. A driver that reads its stop only
 * inside the prompt stream never sees it, and this test times out.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { recordFromJsonLine, type WireRecord } from "@luke/wire";
import { temporaryDirectory } from "@luke/wire/testing";
import { afterEach, describe, expect, it } from "vitest";

const DRIVER = new URL("../src/sandbox/driver.mjs", import.meta.url);

/** The fake SDK, written into the child's own node_modules. */
const FAKE_SDK = `
export function query({ prompt }) {
  let release;
  const interrupted = new Promise((resolve) => { release = resolve; });
  const prompts = prompt[Symbol.asyncIterator]();
  async function* run() {
    yield { type: "system", subtype: "init", session_id: "s" };
    await prompts.next();
    yield { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "sleep 600" } }] } };
    await interrupted;
    yield { type: "result", subtype: "error_during_execution", is_error: true, session_id: "s" };
    while (!(await prompts.next()).done) {}
  }
  const session = run();
  session.interrupt = async () => release();
  session.accountInfo = async () => ({ subscriptionType: "max" });
  return session;
}
`;

const children: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

async function driverIn(directory: string): Promise<string> {
  const sdk = path.join(directory, "node_modules", "@anthropic-ai", "claude-agent-sdk");
  await mkdir(sdk, { recursive: true });
  await writeFile(
    path.join(sdk, "package.json"),
    JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", type: "module", main: "index.mjs" }),
  );
  await writeFile(path.join(sdk, "index.mjs"), FAKE_SDK);
  const driver = path.join(directory, "driver.mjs");
  await copyFile(DRIVER, driver);
  return driver;
}

function send(child: ChildProcessWithoutNullStreams, line: WireRecord): void {
  child.stdin.write(`${JSON.stringify(line)}\n`);
}

describe("the driver", () => {
  it("interrupts a turn running a foreground command, then exits at the end of input", async (t) => {
    const driver = await driverIn(await temporaryDirectory(t));
    const child = spawn(process.execPath, [driver]);
    children.push(child);
    send(child, { token: "not-a-token", tokenVariable: "LUKE_TEST_TOKEN", cwd: ".", options: {} });
    send(child, { type: "message", text: "run sleep 600" });

    const seen: string[] = [];
    for await (const line of createInterface({ input: child.stdout })) {
      const type = recordFromJsonLine(line)?.type;
      if (type === undefined || type === null) continue;
      seen.push(String(type));
      if (type === "assistant") send(child, { type: "stop" });
      if (type === "result") send(child, { type: "end" });
      if (type === "luke_probe_exit") break;
    }

    expect(seen).toEqual([
      "system",
      "luke_probe_account",
      "assistant",
      "result",
      "luke_probe_exit",
    ]);
  }, 10_000);
});

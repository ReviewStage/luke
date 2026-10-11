/**
 * harness-spike-live.ts -- SPIKE (do not merge): one live Claude Code run on the AI SDK's HarnessAgent, in a local process sandbox, recorded.
 *
 * Run by hand, never by a check: `pnpm exec tsx scripts/harness-spike-live.ts <out-dir>`
 * with `ANTHROPIC_API_KEY` set. No Vercel credential is needed, because
 * the sandbox here is a directory on this machine with its own `HOME`,
 * shaped as the harness's network sandbox session (commands, files, one
 * port the bridge listens on). It has no firewall, so the adapter hands
 * the key to the bridge's environment and warns; on Vercel the key is
 * brokered at the firewall instead. The run measures what the spike asks:
 * the bridge's first install, a task turn against a small repository
 * with a failing test, a follow-up on a fresh agent resumed from the
 * parked state (as a new function would), a Stop that aborts a turn
 * mid-command, and `session.stop()` on a turn under way. Every harness
 * part is recorded as the adapter emitted it, with the key scrubbed from
 * everything written, so the hermetic test can replay it.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";

const KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = "claude-haiku-5-5";
const BRIDGE_PORT = 4317;

/** Anything written passes here first: the key and anything shaped like one are gone. */
function scrub(text: string): string {
  const keyless = KEY.length > 0 ? text.split(KEY).join("[REDACTED]") : text;
  return keyless.replace(/sk-ant-[A-Za-z0-9_-]{8,}/gu, "[REDACTED]");
}

/** A local directory as the harness's network sandbox session. */
function localSandbox(root: string) {
  const home = join(root, "home");
  const work = join(root, "work");
  const children = new Set<ReturnType<typeof spawn>>();
  const environment = (extra?: Record<string, string>) => ({
    PATH: process.env.PATH ?? "",
    HOME: home,
    LANG: "C.UTF-8",
    ...extra,
  });
  const start = (options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
  }) => {
    const child = spawn("bash", ["-c", options.command], {
      cwd: options.workingDirectory ?? work,
      env: environment(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    child.on("exit", () => children.delete(child));
    return child;
  };
  return {
    home,
    work,
    session: {
      id: "local-spike",
      description: "A local directory sandbox for the harness spike.",
      defaultWorkingDirectory: work,
      ports: [BRIDGE_PORT],
      getPortEndpoint: async ({ port }: { port: number }) => ({ url: `ws://127.0.0.1:${port}` }),
      getPortUrl: async ({ port }: { port: number }) => `http://127.0.0.1:${port}`,
      run: (options: {
        command: string;
        workingDirectory?: string;
        env?: Record<string, string>;
      }) =>
        new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
          const child = start(options);
          let stdout = "";
          let stderr = "";
          child.stdout?.on("data", (chunk) => (stdout += chunk));
          child.stderr?.on("data", (chunk) => (stderr += chunk));
          child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
        }),
      spawn: async (options: {
        command: string;
        workingDirectory?: string;
        env?: Record<string, string>;
      }) => {
        const child = start(options);
        return {
          pid: child.pid,
          stdout: Readable.toWeb(child.stdout ?? Readable.from([])) as ReadableStream<Uint8Array>,
          stderr: Readable.toWeb(child.stderr ?? Readable.from([])) as ReadableStream<Uint8Array>,
          wait: () =>
            new Promise<{ exitCode: number }>((resolve) =>
              child.on("close", (code) => resolve({ exitCode: code ?? 1 })),
            ),
          kill: async () => {
            child.kill("SIGTERM");
          },
        };
      },
      readTextFile: async ({ path }: { path: string }) => readFile(path, "utf8").catch(() => null),
      readBinaryFile: async ({ path }: { path: string }) => readFile(path).catch(() => null),
      readFile: async ({ path }: { path: string }) =>
        readFile(path)
          .then((bytes) => new Blob([bytes]).stream())
          .catch(() => null),
      writeTextFile: async ({ path, content }: { path: string; content: string }) => {
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, content);
      },
      writeBinaryFile: async ({ path, content }: { path: string; content: Uint8Array }) => {
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, content);
      },
      writeFile: async ({
        path,
        content,
      }: {
        path: string;
        content: ReadableStream<Uint8Array>;
      }) => {
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, Buffer.from(await new Response(content).arrayBuffer()));
      },
      stop: async () => {
        for (const child of children) child.kill("SIGTERM");
      },
      destroy: async () => {
        for (const child of children) child.kill("SIGKILL");
      },
      restricted() {
        return this;
      },
    },
  };
}

/** The adapter with every part it emits recorded, per turn, as it emitted it. */
type ClaudeCodeHarness = ReturnType<typeof createClaudeCode>;

function recording(harness: ClaudeCodeHarness, turns: unknown[][]): ClaudeCodeHarness {
  return {
    ...harness,
    doStart: async (options) => {
      const session = await harness.doStart(options);
      return {
        ...session,
        sessionId: session.sessionId,
        isResume: session.isResume,
        doPromptTurn: (turn) => {
          const parts: unknown[] = [];
          turns.push(parts);
          return session.doPromptTurn({
            ...turn,
            emit: (part) => {
              parts.push(part);
              turn.emit(part);
            },
          });
        },
        doCompact: (instructions) => session.doCompact(instructions),
        doContinueTurn: (continued) => session.doContinueTurn(continued),
        doSuspendTurn: () => session.doSuspendTurn(),
        doDetach: () => session.doDetach(),
        doStop: () => session.doStop(),
        doDestroy: () => session.doDestroy(),
        ...(session.doReadHistory === undefined
          ? undefined
          : { doReadHistory: session.doReadHistory.bind(session) }),
      };
    },
  };
}

const sh = (sandbox: ReturnType<typeof localSandbox>, command: string) =>
  sandbox.session.run({ command });

/** A tiny repository with a failing test and a bare origin to push to. */
async function seedRepository(sandbox: ReturnType<typeof localSandbox>, root: string) {
  const origin = join(root, "origin.git");
  const seeded = await sh(
    sandbox,
    [
      "set -e",
      `git init -q --bare ${origin}`,
      "git init -q -b main .",
      "git config user.name 'Spike Developer'",
      "git config user.email spike@example.invalid",
      `printf '%s\\n' 'export function sum(a, b) {' '  return a - b;' '}' > sum.mjs`,
      `printf '%s\\n' "import assert from 'node:assert/strict';" "import { sum } from './sum.mjs';" 'assert.equal(sum(2, 3), 5);' "console.log('ok');" > test.mjs`,
      `printf '%s\\n' '# Agent guide' 'Run node test.mjs to test.' > AGENTS.md`,
      "git add -A && git commit -qm 'seed'",
      `git remote add origin ${origin} && git push -q origin main`,
    ].join("\n"),
  );
  if (seeded.exitCode !== 0) throw new Error(`seeding failed: ${seeded.stderr}`);
}

interface TurnReport {
  readonly label: string;
  readonly ms: number;
  readonly firstPartMs?: number;
  readonly parts: number;
  readonly text: string;
  readonly toolCalls: readonly string[];
  readonly finish?: unknown;
  readonly ended: string;
}

/** One turn streamed to its end, timed, with what it said and called. */
async function streamTurn(
  label: string,
  agent: HarnessAgent<ClaudeCodeHarness>,
  session: Awaited<ReturnType<HarnessAgent<ClaudeCodeHarness>["createSession"]>>,
  prompt: string,
  options: {
    readonly abortAfterFirstCall?: (abort: () => void) => void;
    readonly onFirstCall?: () => Promise<void>;
  } = {},
): Promise<TurnReport> {
  const started = Date.now();
  const controller = new AbortController();
  const result = await agent.stream({ session, prompt, abortSignal: controller.signal });
  let firstPartMs: number | undefined;
  let parts = 0;
  let text = "";
  const toolCalls: string[] = [];
  let finish: unknown;
  let ended = "stream-end";
  let sawCall = false;
  for await (const part of result.fullStream) {
    parts += 1;
    firstPartMs ??= Date.now() - started;
    if (part.type === "text-delta") text += part.text;
    if (part.type === "tool-call") {
      toolCalls.push(`${part.toolName} ${JSON.stringify(part.input).slice(0, 120)}`);
      if (!sawCall) {
        sawCall = true;
        options.abortAfterFirstCall?.(() => controller.abort());
        await options.onFirstCall?.();
      }
    }
    if (part.type === "finish") {
      finish = {
        finishReason: part.finishReason,
        totalUsage: part.totalUsage,
        harness: (part as { providerMetadata?: unknown }).providerMetadata,
      };
      ended = "finish";
    }
    if (part.type === "abort") ended = "abort";
    if (part.type === "error") ended = `error: ${String(part.error)}`;
  }
  return {
    label,
    ms: Date.now() - started,
    ...(firstPartMs === undefined ? {} : { firstPartMs }),
    parts,
    text,
    toolCalls,
    finish,
    ended,
  };
}

async function main() {
  const out = process.argv[2];
  if (out === undefined || KEY.length === 0)
    throw new Error("usage: ANTHROPIC_API_KEY=… tsx harness-spike-live.ts <out-dir>");
  const root = "/tmp/harness-live";
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, "home"), { recursive: true });
  await mkdir(join(root, "work"), { recursive: true });
  await mkdir(out, { recursive: true });
  const sandbox = localSandbox(root);
  await seedRepository(sandbox, root);

  const recorded: unknown[][] = [];
  const logs: string[] = [];
  const makeAgent = () =>
    new HarnessAgent({
      harness: recording(
        createClaudeCode({ auth: { ANTHROPIC_API_KEY: KEY }, effort: "low", port: BRIDGE_PORT }),
        recorded,
      ),
      id: "luke-coder-spike",
      model: MODEL,
      instructions:
        "You are Luke's coding agent. Work in the repository you are in. Commit on a new branch named luke/fix-sum and push it to origin. Keep answers short.",
      permissionMode: "allow-all",
      onLog: (event) => logs.push(scrub(JSON.stringify(event))),
    });
  const reports: Record<string, unknown> = {};

  // Turn 1: the task, on a fresh session; the bridge installs on first start.
  const agent = makeAgent();
  const t0 = Date.now();
  const template = await agent.getSandboxTemplate();
  await template?.prepare?.({ session: sandbox.session as never });
  reports.bootstrapMs = Date.now() - t0;
  const t1 = Date.now();
  const session = await agent.createSession({
    sessionId: "spike-session",
    sandboxSession: sandbox.session as never,
  });
  reports.createSessionMs = Date.now() - t1;
  reports.turn1 = await streamTurn(
    "task",
    agent,
    session,
    "The test fails: run it, fix the bug, commit, push the branch.",
  );
  const branch = await sh(sandbox, "git branch --show-current && git ls-remote --heads origin");
  reports.branchAfterTurn1 = branch.stdout;
  const t2 = Date.now();
  const parked = await session.stop();
  reports.parkMs = Date.now() - t2;
  reports.parkedStateKeys = Object.keys((parked as { data?: object }).data ?? {});

  // Turn 2: a follow-up on a fresh agent resumed from the parked state, as a new function would.
  const resumedAgent = makeAgent();
  const t3 = Date.now();
  const resumed = await resumedAgent.createSession({
    sessionId: "spike-session",
    sandboxSession: sandbox.session as never,
    resumeFrom: parked,
  });
  reports.resumeMs = Date.now() - t3;
  reports.turn2 = await streamTurn(
    "follow-up after resume",
    resumedAgent,
    resumed,
    "What did you change in the last turn, in one sentence? Do not run any tools.",
  );

  // Turn 3: a Stop, the turn's abort signal fired once it is running a long command.
  reports.turn3 = await streamTurn(
    "abort mid-command",
    resumedAgent,
    resumed,
    "Run exactly this shell command and nothing else: sleep 45 && echo SLEPT > slept.txt",
    { abortAfterFirstCall: (abort) => setTimeout(abort, 3_000) },
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  reports.sleepAfterAbort = (await sh(sandbox, "pgrep -fa 'sleep 45' || echo none")).stdout.trim();

  // Turn 4: `session.stop()` on a turn under way, which the core documents as a suspend, not an abort.
  const turn4Started = Date.now();
  let stopAnswer = "";
  reports.turn4 = await streamTurn(
    "session.stop() mid-turn",
    resumedAgent,
    resumed,
    "Run exactly this shell command and nothing else: sleep 20 && echo SECOND > second.txt",
    {
      onFirstCall: async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const state = await resumed.stop().catch((error: unknown) => String(error));
        stopAnswer =
          typeof state === "string" ? state : `state ${Object.keys(state as object).join(",")}`;
      },
    },
  );
  reports.turn4StopAnswer = scrub(stopAnswer);
  reports.turn4StopReturnedAfterMs = Date.now() - turn4Started;
  await new Promise((resolve) => setTimeout(resolve, 25_000));
  reports.secondFileAfterStop = (
    await sh(sandbox, "cat second.txt 2>/dev/null || echo absent")
  ).stdout.trim();

  await sandbox.session.destroy();
  await writeFile(join(out, "report.json"), scrub(JSON.stringify(reports, null, 2)));
  await writeFile(join(out, "recorded-parts.json"), scrub(JSON.stringify(recorded, null, 2)));
  await writeFile(join(out, "harness-log.ndjson"), logs.join("\n"));
  process.stdout.write(`${scrub(JSON.stringify(reports, null, 2))}\n`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(
      `${scrub(error instanceof Error ? (error.stack ?? error.message) : String(error))}\n`,
    );
    process.exit(1);
  },
);

/**
 * agent-browser-fake.ts -- an agent's browser for the suites that drive one: a fake Chromium that speaks CDP, the bridge in front of it on a fake PTY, and a fake sandbox it runs in.
 *
 * The service under them is the real one (`agents/browser/agent-browser.ts`);
 * only what it reaches across a process boundary is faked. The sandbox is
 * Vercel's REST API as a scenario has it: listed under a session's tag or
 * not, running or stopped, resuming after some asks, and running the
 * browser's start as the start script would, started the first time and
 * attached to after, until a resume brings the sandbox up without it. The
 * PTY runs the bridge only where its start frame names it, writes what a
 * real PTY would around it (a stray line, `\r\n` line ends, a line split
 * across frames, mid-character), and carries each command line to the
 * fake Chromium and its answer back. The Chromium keeps page targets,
 * answers `Target.getTargets`, `createTarget`, and `closeTarget`, refuses
 * any method it does not know as Chrome does, and answers what a suite's
 * own `answer` says first, which may be nothing at all.
 */

import type { CdpEvent, PageTarget } from "@luke/features/browser-cdp";
import { type Cause, Effect, Layer, Queue, Redacted, Ref, Schema, Stream } from "effect";
import {
  AgentBrowser,
  agentBrowserOver,
  BROWSER_UNREACHABLE,
  type BrowserSandboxApi,
  BrowserUnreachable,
} from "../agents/browser/agent-browser.js";
import {
  BRIDGE_SOURCE,
  BROWSER_START_OUTPUT,
  SANDBOX_BROWSER,
} from "../agents/browser/sandbox-browser.js";
import type { SandboxPtyService } from "../agents/sandbox-pty.js";
import {
  type CommandAsk,
  type ListedSandbox,
  SandboxUnavailable,
} from "../agents/vercel-sandbox-api.js";
import type { RelayFrame } from "../terminal/relay.js";

/** Chrome's own refusal of a method it does not know, and of a target it does not hold. */
const CHROME_ERROR = { NO_METHOD: -32601, INVALID_PARAMS: -32602 } as const;

/** What the fake Chromium answers a command: a result, a refusal, or nothing ever. */
export type FakeCdpAnswer =
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string } }
  | { readonly silent: true };

/** A command as the fake Chromium reads it off its line. */
export interface FakeCdpCommand {
  readonly method: string;
  readonly params: { readonly [key: string]: unknown };
  readonly sessionId?: string | undefined;
}

/** How the bridge comes up: ready, unable to reach the browser, never saying anything, or unable only on its first PTY, as just after a fresh start. */
export const FAKE_BRIDGE = {
  READY: "ready",
  ERROR: "error",
  SILENT: "silent",
  ERROR_FIRST: "error-first",
} as const;

export type FakeBridge = (typeof FAKE_BRIDGE)[keyof typeof FAKE_BRIDGE];

export interface FakeCdpPeer {
  /** The page targets the browser holds now. */
  readonly pages: Effect.Effect<readonly PageTarget[]>;
  /** Sends an event on every open connection. */
  readonly emit: (event: CdpEvent) => Effect.Effect<void>;
  /** Ends every open connection, as a bridge that exits does. */
  readonly hangUp: Effect.Effect<void>;
  /** Writes what the PTY says to every open connection; the service's PTY reader takes it. */
  readonly write: (text: string) => Effect.Effect<void>;
  /** Registers a connection's output, which events and the hang-up then reach. */
  readonly attach: (output: Queue.Queue<RelayFrame, Cause.Done>) => Effect.Effect<void>;
  /** The answer to one command. */
  readonly answer: (command: FakeCdpCommand) => Effect.Effect<FakeCdpAnswer>;
}

const CommandLineSchema = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  sessionId: Schema.optional(Schema.String),
});

const decodeCommandLine = Schema.decodeUnknownOption(Schema.fromJsonString(CommandLineSchema));

/** A text's bytes, split in two frames inside its first multi-byte character where it has one, so a reader must join them. */
function framesOf(text: string): readonly RelayFrame[] {
  const bytes = new TextEncoder().encode(text);
  const wide = bytes.findIndex((byte) => byte >= 0x80);
  const at = wide >= 0 ? wide + 1 : Math.floor(bytes.length / 2);
  return [{ bytes: bytes.slice(0, at) }, { bytes: bytes.slice(at) }];
}

/** A fake Chromium holding the pages given, answering a suite's own `answer` first. */
export function fakeCdpPeer(
  options: {
    readonly pages?: readonly PageTarget[];
    readonly answer?: (command: FakeCdpCommand) => FakeCdpAnswer | undefined;
  } = {},
): Effect.Effect<FakeCdpPeer> {
  return Effect.gen(function* () {
    const pages = yield* Ref.make<readonly PageTarget[]>(
      options.pages ?? [{ targetId: "page-blank", url: "about:blank", title: "" }],
    );
    const created = yield* Ref.make(0);
    const outputs = new Set<Queue.Queue<RelayFrame, Cause.Done>>();
    const write = (text: string) =>
      Effect.forEach([...outputs], (output) => Queue.offerAll(output, framesOf(text)), {
        discard: true,
      });

    const known = (command: FakeCdpCommand): Effect.Effect<FakeCdpAnswer> =>
      Effect.gen(function* () {
        const { params } = command;
        if (command.method === "Target.getTargets") {
          const held = yield* Ref.get(pages);
          const infos = held.map((page) => ({ ...page, type: "page", attached: false }));
          return {
            result: {
              targetInfos: [
                ...infos,
                { targetId: "worker-1", type: "service_worker", url: "", title: "" },
              ],
            },
          };
        }
        if (command.method === "Target.createTarget") {
          const targetId = `page-${yield* Ref.updateAndGet(created, (count) => count + 1)}`;
          const url = typeof params.url === "string" ? params.url : "about:blank";
          yield* Ref.update(pages, (held) => [...held, { targetId, url, title: "" }]);
          return { result: { targetId } };
        }
        if (command.method === "Target.closeTarget") {
          const held = yield* Ref.get(pages);
          if (!held.some((page) => page.targetId === params.targetId)) {
            return {
              error: {
                code: CHROME_ERROR.INVALID_PARAMS,
                message: "No target with given id found",
              },
            };
          }
          yield* Ref.set(
            pages,
            held.filter((page) => page.targetId !== params.targetId),
          );
          return { result: {} };
        }
        return {
          error: { code: CHROME_ERROR.NO_METHOD, message: `'${command.method}' wasn't found` },
        };
      });

    return {
      pages: Ref.get(pages),
      emit: (event) => write(`${JSON.stringify(event)}\r\n`),
      hangUp: Effect.suspend(() =>
        Effect.forEach([...outputs], (output) => Queue.end(output), { discard: true }),
      ),
      write,
      attach: (output) => Effect.sync(() => void outputs.add(output)),
      answer: (command) => {
        const own = options.answer?.(command);
        return own === undefined ? known(command) : Effect.succeed(own);
      },
    };
  });
}

/** Whether a PTY start frame runs the bridge, on the port the browser listens on. */
function startsBridge(text: string): boolean {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("args" in parsed)) return false;
  const { args } = parsed;
  return (
    Array.isArray(args) &&
    args.includes(BRIDGE_SOURCE) &&
    args.at(-1) === String(SANDBOX_BROWSER.DEVTOOLS_PORT)
  );
}

/** The sandbox's PTY, running the bridge in front of the fake Chromium as it is told to come up. */
export function fakeBridgePty(
  peer: FakeCdpPeer,
  bridge: FakeBridge = FAKE_BRIDGE.READY,
): SandboxPtyService {
  let connections = 0;
  return {
    connect: () =>
      Effect.gen(function* () {
        connections += 1;
        const word =
          bridge === FAKE_BRIDGE.ERROR_FIRST
            ? connections === 1
              ? FAKE_BRIDGE.ERROR
              : FAKE_BRIDGE.READY
            : bridge;
        const output = yield* Queue.make<RelayFrame, Cause.Done>();
        yield* Effect.addFinalizer(() => Queue.end(output));
        let held = "";
        const say = (text: string) => Queue.offerAll(output, framesOf(text));
        return {
          frames: Stream.fromQueue(output),
          close: () => Queue.end(output).pipe(Effect.asVoid),
          send: (frame) =>
            Effect.gen(function* () {
              if ("text" in frame) {
                if (!startsBridge(frame.text) || word === FAKE_BRIDGE.SILENT) return;
                yield* peer.attach(output);
                yield* say("a line the PTY printed before the bridge\r\n");
                const said =
                  word === FAKE_BRIDGE.ERROR
                    ? { bridge: word, reason: "socket" }
                    : { bridge: word };
                yield* say(`${JSON.stringify(said)}\r\n`);
                return;
              }
              held += new TextDecoder().decode(frame.bytes);
              const lines = held.split("\n");
              held = lines.pop() ?? "";
              for (const line of lines) {
                const command = decodeCommandLine(line);
                if (command._tag === "None") continue;
                const { id, method, params, sessionId: target } = command.value;
                const asked = { method, params: params ?? {}, sessionId: target };
                const answer = yield* peer.answer(asked);
                if ("silent" in answer) continue;
                const sessionId =
                  asked.sessionId === undefined ? {} : { sessionId: asked.sessionId };
                yield* say(`${JSON.stringify({ id, ...answer, ...sessionId })}\r\n`);
              }
            }),
        };
      }),
  };
}

/** What a fake sandbox has: its status, if it is listed at all, and what it does when asked. */
export interface FakeSandboxScenario {
  /** The status the sandbox is listed in; none for a session that opened no sandbox. */
  readonly status: string | undefined;
  /** The session tag it is listed under. */
  readonly sessionId: string;
  /** How many resumes answer it still pending before one answers it running; one that never comes up is `Infinity`. */
  readonly pendingResumes?: number;
  /** The exit the browser's start ends on; 0 where it starts or attaches. */
  readonly startExit?: number;
  /** Whether every call is unavailable, as Vercel answering the status given. */
  readonly unavailable?: number;
  /** Whether every resume is unavailable, as Vercel answering the status given. */
  readonly resumeUnavailable?: number;
}

export const FAKE_SANDBOX = {
  NAME: "eve-sbx-browser-fixture",
  RUNNING_SESSION: "sbs_running",
  RESUMED_SESSION: "sbs_resumed",
} as const;

/** Vercel's REST API over one sandbox as the scenario has it, and the commands it ran, by the session each ran in. */
export function fakeSandboxApi(scenario: FakeSandboxScenario) {
  const ran: { readonly sandboxSessionId: string; readonly ask: CommandAsk }[] = [];
  let status = scenario.status;
  let current: string = FAKE_SANDBOX.RUNNING_SESSION;
  let resumes = 0;
  let browserUp = false;
  const refused = () =>
    scenario.unavailable === undefined
      ? undefined
      : Effect.fail(new SandboxUnavailable({ status: scenario.unavailable }));
  const listed = (): ListedSandbox => ({
    name: FAKE_SANDBOX.NAME,
    status,
    currentSessionId: current,
  });
  const api: BrowserSandboxApi = {
    listTagged: (sessionId) =>
      refused() ??
      Effect.succeed(sessionId === scenario.sessionId && status !== undefined ? [listed()] : []),
    resume: () =>
      refused() ??
      (scenario.resumeUnavailable === undefined
        ? undefined
        : Effect.fail(new SandboxUnavailable({ status: scenario.resumeUnavailable }))) ??
      Effect.sync(() => {
        if (status === "running") return listed();
        resumes += 1;
        status = resumes > (scenario.pendingResumes ?? 0) ? "running" : "pending";
        current = FAKE_SANDBOX.RESUMED_SESSION;
        // A resume starts from the snapshot, where no browser runs.
        browserUp = false;
        return listed();
      }),
    run: (sandboxSessionId, ask) =>
      refused() ??
      Effect.sync(() => {
        ran.push({ sandboxSessionId, ask });
        const exitCode = scenario.startExit ?? 0;
        if (exitCode !== 0) return { exitCode, stdout: "", stderr: "Chromium did not start\n" };
        const stdout = browserUp ? BROWSER_START_OUTPUT.ATTACHED : BROWSER_START_OUTPUT.STARTED;
        browserUp = true;
        return { exitCode, stdout: `${stdout}\n`, stderr: "" };
      }),
    openInteractive: () =>
      refused() ??
      Effect.succeed({ url: "wss://sbx-fixture.vercel.run/ws", token: Redacted.make("pty-token") }),
    updateTimeout: () => Effect.die("a sandbox the scenario opened is already within the timeout"),
  };
  return { api, ran };
}

/**
 * `AgentBrowser` over a running sandbox tagged with the session given and a
 * ready bridge in front of the peer: the double a suite that drives a
 * browser provides.
 */
export function agentBrowserTestLayer(
  peer: FakeCdpPeer,
  sessionId: string,
): Layer.Layer<AgentBrowser> {
  const { api } = fakeSandboxApi({ status: "running", sessionId });
  return Layer.succeed(AgentBrowser, agentBrowserOver(api, fakeBridgePty(peer)));
}

/**
 * `AgentBrowser` for an agent that has opened no sandbox: every call is
 * refused as not reachable. The double a suite provides where its agent
 * never reaches a browser.
 */
export const noSandboxBrowserLayer: Layer.Layer<AgentBrowser> = Layer.succeed(AgentBrowser, {
  ensure: () => Effect.fail(new BrowserUnreachable({ reason: BROWSER_UNREACHABLE.NOT_OPENED })),
  connect: () => Effect.fail(new BrowserUnreachable({ reason: BROWSER_UNREACHABLE.NOT_OPENED })),
});

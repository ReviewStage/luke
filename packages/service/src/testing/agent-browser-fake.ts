import type { CdpEvent, PageTarget } from "@repo/features/browser-cdp";
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
import {
  RECORDER_SOURCE,
  RECORDING_READ_EXIT,
  RECORDING_SCRIPT_NAME,
  RECORDING_START_OUTPUT,
  SANDBOX_RECORDING,
} from "../agents/browser/sandbox-recorder.js";
import type { SandboxPtyService } from "../agents/sandbox-pty.js";
import {
  type CommandAsk,
  type CommandRun,
  type OpenedSandbox,
  SandboxUnavailable,
} from "../agents/vercel-sandbox-api.js";
import type { RelayFrame } from "../terminal/relay.js";

const CHROME_ERROR = { NO_METHOD: -32601, INVALID_PARAMS: -32602 } as const;

export type FakeCdpAnswer =
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string } }
  | { readonly silent: true };

export interface FakeCdpCommand {
  readonly method: string;
  readonly params: { readonly [key: string]: unknown };
  readonly sessionId?: string | undefined;
}

export const FAKE_BRIDGE = {
  READY: "ready",
  ERROR: "error",
  SILENT: "silent",
  ERROR_FIRST: "error-first",
} as const;

export type FakeBridge = (typeof FAKE_BRIDGE)[keyof typeof FAKE_BRIDGE];

export interface FakeCdpPeer {
  readonly pages: Effect.Effect<readonly PageTarget[]>;
  readonly emit: (event: CdpEvent) => Effect.Effect<void>;
  readonly hangUp: Effect.Effect<void>;
  readonly write: (text: string) => Effect.Effect<void>;
  readonly attach: (output: Queue.Queue<RelayFrame, Cause.Done>) => Effect.Effect<void>;
  readonly answer: (command: FakeCdpCommand) => Effect.Effect<FakeCdpAnswer>;
}

const CommandLineSchema = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  sessionId: Schema.optional(Schema.String),
});

const decodeCommandLine = Schema.decodeUnknownOption(Schema.fromJsonString(CommandLineSchema));

function framesOf(text: string): readonly RelayFrame[] {
  const bytes = new TextEncoder().encode(text);
  const wide = bytes.findIndex((byte) => byte >= 0x80);
  const at = wide >= 0 ? wide + 1 : Math.floor(bytes.length / 2);
  return [{ bytes: bytes.slice(0, at) }, { bytes: bytes.slice(at) }];
}

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

export interface FakeSandboxScenario {
  readonly status: string | undefined;
  readonly sessionId: string;
  readonly pendingResumes?: number;
  readonly startExit?: number;
  readonly unavailable?: number;
  readonly resumeUnavailable?: number;
  readonly resumeCode?: string;
  readonly recording?: {
    readonly start?: CommandRun;
    readonly stop?: string;
    readonly video?: Uint8Array;
  };
}

export const FAKE_SANDBOX = {
  NAME: "eve-sbx-browser-fixture",
  RUNNING_SESSION: "sbs_running",
  RESUMED_SESSION: "sbs_resumed",
} as const;

export const FAKE_RECORDING_PATH = `/home/vercel-sandbox/${SANDBOX_RECORDING.VIDEO}`;

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
  const listed = (): OpenedSandbox => ({
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
        : Effect.fail(
            new SandboxUnavailable({
              status: scenario.resumeUnavailable,
              ...(scenario.resumeCode === undefined ? undefined : { code: scenario.resumeCode }),
            }),
          )) ??
      Effect.sync(() => {
        if (status === "running") return listed();
        resumes += 1;
        status = resumes > (scenario.pendingResumes ?? 0) ? "running" : "pending";
        current = FAKE_SANDBOX.RESUMED_SESSION;
        browserUp = false;
        return listed();
      }),
    session: ({ sessionId: sandboxSessionId }) =>
      refused() ??
      Effect.succeed({
        run: (ask: CommandAsk) =>
          refused() ??
          Effect.sync((): CommandRun => {
            ran.push({ sandboxSessionId, ask });
            if (ask.args.includes(RECORDER_SOURCE)) {
              return (
                scenario.recording?.start ?? {
                  exitCode: 0,
                  stdout: `${RECORDING_START_OUTPUT.STARTED}\n`,
                  stderr: "",
                }
              );
            }
            if (ask.args.includes(SANDBOX_RECORDING.VIDEO)) {
              const video = scenario.recording?.video;
              return video === undefined
                ? { exitCode: RECORDING_READ_EXIT.NO_VIDEO, stdout: "", stderr: "" }
                : {
                    exitCode: 0,
                    stdout: `${FAKE_RECORDING_PATH}\n${Buffer.from(video).toString("base64")}`,
                    stderr: "",
                  };
            }
            if (ask.args.includes(RECORDING_SCRIPT_NAME)) {
              const stop = scenario.recording?.stop ?? `{"ok":false,"reason":"none"}`;
              return { exitCode: 0, stdout: `${stop}\n`, stderr: "" };
            }
            const exitCode = scenario.startExit ?? 0;
            if (exitCode !== 0) return { exitCode, stdout: "", stderr: "Chromium did not start\n" };
            const stdout = browserUp ? BROWSER_START_OUTPUT.ATTACHED : BROWSER_START_OUTPUT.STARTED;
            browserUp = true;
            return { exitCode, stdout: `${stdout}\n`, stderr: "" };
          }),
        openInteractive: () =>
          refused() ??
          Effect.succeed({
            url: "wss://sbx-fixture.vercel.run/ws",
            token: Redacted.make("pty-token"),
          }),
      }),
  };
  return { api, ran };
}

export function agentBrowserTestLayer(
  peer: FakeCdpPeer,
  sessionId: string,
): Layer.Layer<AgentBrowser> {
  const { api } = fakeSandboxApi({ status: "running", sessionId });
  return Layer.succeed(AgentBrowser, agentBrowserOver(api, fakeBridgePty(peer)));
}

export const noSandboxBrowserLayer: Layer.Layer<AgentBrowser> = Layer.succeed(AgentBrowser, {
  ensure: () => Effect.fail(new BrowserUnreachable({ reason: BROWSER_UNREACHABLE.NOT_OPENED })),
  startRecording: () =>
    Effect.fail(new BrowserUnreachable({ reason: BROWSER_UNREACHABLE.NOT_OPENED })),
  stopRecording: () =>
    Effect.fail(new BrowserUnreachable({ reason: BROWSER_UNREACHABLE.NOT_OPENED })),
  connect: () => Effect.fail(new BrowserUnreachable({ reason: BROWSER_UNREACHABLE.NOT_OPENED })),
});

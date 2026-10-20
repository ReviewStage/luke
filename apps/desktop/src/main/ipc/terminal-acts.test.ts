import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, it } from "@effect/vitest";
import {
  TERMINAL_CONNECTION,
  TERMINAL_PORT_MESSAGE,
  TERMINAL_REFUSAL,
  type TerminalConnection,
  type TerminalPortOutbound,
  type TerminalPortTicket,
} from "@luke/features/terminal-acts";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import type { ActSender } from "@luke/host/act-router";
import { ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import type { WireBoundaryInput } from "@luke/wire";
import { Deferred, Effect, Fiber } from "effect";
import type { WebContents } from "electron";
import {
  type MainTerminalPort,
  type TerminalActsDependencies,
  terminalProcedures,
  whenPageGone,
} from "./terminal-acts";

/**
 * The Terminal tab's acts as main carries them, over a host and ports that
 * answer from a script: each call answers what the host said, or the kind's
 * own refusal where it had nothing; an attach posts a port to the asking
 * panel alone, and what the host hears of that connection reaches that port
 * and no other; what the panel sends on it reaches the host by connection;
 * a second attach of the same shell, a detach, and the page's end each
 * close the port and let the connection go, a reload being the page's end;
 * an attach the host refused after a newer one leaves the newer standing;
 * and only a panel is answered.
 * Synthetic ids and bytes throughout.
 */

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const SHELL_ID = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL = { id: SHELL_ID, title: "zsh", command: "zsh", cwd: "/workspace", running: false };
const ATTACH = { agentId: AGENT_ID, terminalId: SHELL_ID, cols: 120, rows: 32 };

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const panelOf = (): ActSender<WebContents> => ({
  sender: {} as WebContents,
  panel: true,
  voice: false,
  call: false,
});

type Listener<Event> = (event: Event) => void;

/** One port main opened, as the test watches it: where it went, what main posted on it, and whether it closed. */
interface ScriptedPort {
  readonly sender: WebContents;
  readonly ticket: TerminalPortTicket;
  readonly posted: TerminalPortOutbound[];
  closed: boolean;
  send(message: WireBoundaryInput): void;
}

function fixture(
  options: {
    connectTaken?: boolean;
    connect?: (connectionId: string) => Effect.Effect<boolean>;
  } = {},
) {
  const asked: string[] = [];
  const opened: ScriptedPort[] = [];
  const gone = new Map<WebContents, () => void>();
  const pending: Effect.Effect<unknown>[] = [];
  let outputListener: Listener<{ connectionId: string; data: Uint8Array }> | undefined;
  let stateListener: Parameters<HostOperator["onTerminalState"]>[0] | undefined;
  let ids = 0;
  const host: TerminalActsDependencies["host"] = {
    terminalList: ({ agentId }) =>
      Effect.sync(() => {
        asked.push(`list:${agentId}`);
        return { sandbox: SANDBOX_STATE.RUNNING, terminals: [SHELL] };
      }),
    terminalCreate: () => Effect.succeed({ refused: TERMINAL_REFUSAL.SANDBOX_STOPPED }),
    terminalRename: () => Effect.succeed(undefined),
    terminalKill: () => Effect.succeed({ sandbox: SANDBOX_STATE.RUNNING, terminals: [] }),
    terminalResume: () => Effect.succeed({ sandbox: SANDBOX_STATE.RUNNING }),
    terminalConnect: (params) =>
      Effect.sync(() => {
        asked.push(
          `connect:${params.connectionId}:${params.agentId}:${params.terminalId}:${params.cols}x${params.rows}`,
        );
      }).pipe(
        Effect.andThen(
          options.connect?.(params.connectionId) ?? Effect.succeed(options.connectTaken ?? true),
        ),
      ),
    terminalInput: ({ connectionId, data }) =>
      Effect.sync(() => void asked.push(`input:${connectionId}:${data}`)),
    terminalResize: ({ connectionId, cols, rows }) =>
      Effect.sync(() => void asked.push(`resize:${connectionId}:${cols}x${rows}`)),
    terminalAck: ({ connectionId, bytes }) =>
      Effect.sync(() => void asked.push(`ack:${connectionId}:${bytes}`)),
    terminalDisconnect: ({ connectionId }) =>
      Effect.sync(() => void asked.push(`disconnect:${connectionId}`)),
    onTerminalOutput: (listener) => {
      outputListener = listener;
      return () => undefined;
    },
    onTerminalState: (listener) => {
      stateListener = listener;
      return () => undefined;
    },
  };
  const actPort = testActPort(
    terminalProcedures({
      host,
      ports: {
        open: (sender, ticket): MainTerminalPort => {
          let heard: ((message: WireBoundaryInput) => void) | undefined;
          const port: ScriptedPort = {
            sender,
            ticket,
            posted: [],
            closed: false,
            send: (message) => heard?.(message),
          };
          opened.push(port);
          return {
            post: (message) => void port.posted.push(message),
            onMessage: (listener) => {
              heard = listener;
            },
            close: () => {
              port.closed = true;
            },
          };
        },
        whenGone: (sender, then) => void gone.set(sender, then),
      },
      createId: () => `connection-${++ids}`,
      run: <A>(effect: Effect.Effect<A>) => {
        pending.push(effect);
        return new Promise<A>(() => undefined);
      },
    }),
  );
  ports.push(actPort);
  return {
    actPort,
    asked,
    opened,
    /** The host's events, as the operator would hand them up. */
    hostSays: {
      output: (connectionId: string, text: string) =>
        outputListener?.({ connectionId, data: new TextEncoder().encode(text) }),
      state: (connectionId: string, state: TerminalConnection, code?: number) =>
        stateListener?.({ connectionId, state, ...(code === undefined ? undefined : { code }) }),
    },
    /** The page behind a panel going away. */
    pageGone: (sender: WebContents) => gone.get(sender)?.(),
    /** What the ports' callbacks handed to the runtime, run now. */
    drain: Effect.suspend(() => Effect.all(pending.splice(0), { discard: true })),
  };
}

const DETACH = { agentId: AGENT_ID, terminalId: SHELL_ID };

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [ACT_KIND.TERMINAL_LIST]: "Could not reach this agent's sandbox.",
  [ACT_KIND.TERMINAL_RENAME]: "Could not rename that shell.",
  [ACT_KIND.TERMINAL_ATTACH]: "Could not open that shell.",
} as const;

/** The kind's own refusal, as the asking window hears it. */
const refusedAs = (kind: keyof typeof REFUSAL) => ({ refused: REFUSAL[kind] });

it.effect(
  "each call answers what the host said, or the kind's own refusal where it had nothing",
  () =>
    Effect.gen(function* () {
      const { actPort, asked } = fixture();
      const panel = panelOf();

      const listed = yield* actPort.perform(
        { kind: ACT_KIND.TERMINAL_LIST, payload: { agentId: AGENT_ID } },
        panel,
      );
      const created = yield* actPort.perform(
        { kind: ACT_KIND.TERMINAL_CREATE, payload: { agentId: AGENT_ID } },
        panel,
      );
      const renamed = yield* actPort.perform(
        {
          kind: ACT_KIND.TERMINAL_RENAME,
          payload: { agentId: AGENT_ID, terminalId: SHELL_ID, title: "tests" },
        },
        panel,
      );

      assert.deepEqual(listed, {
        answer: { sandbox: SANDBOX_STATE.RUNNING, terminals: [SHELL] },
      });
      assert.deepEqual(created, {
        answer: { refused: TERMINAL_REFUSAL.SANDBOX_STOPPED },
      });
      assert.deepEqual(renamed, refusedAs(ACT_KIND.TERMINAL_RENAME));
      assert.deepEqual(asked, [`list:${AGENT_ID}`]);
    }),
);

it.effect("only a panel is answered", () =>
  Effect.gen(function* () {
    const { actPort, asked, opened } = fixture();
    const voice: ActSender<WebContents> = { ...panelOf(), panel: false, voice: true };

    const listed = yield* actPort.perform(
      { kind: ACT_KIND.TERMINAL_LIST, payload: { agentId: AGENT_ID } },
      voice,
    );
    const attached = yield* actPort.perform(
      { kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH },
      voice,
    );

    assert.deepEqual(listed, refusedAs(ACT_KIND.TERMINAL_LIST));
    assert.deepEqual(attached, refusedAs(ACT_KIND.TERMINAL_ATTACH));
    assert.deepEqual(asked, []);
    assert.deepEqual(opened, [], "no port is posted to a window that draws no tab");
  }),
);

it.effect(
  "an attach posts a port to the asking panel alone, and what the host hears of that connection reaches that port and no other",
  () =>
    Effect.gen(function* () {
      const { actPort, asked, opened, hostSays } = fixture();
      const one = panelOf();
      const other = panelOf();

      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, one);
      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, other);
      hostSays.output("connection-1", "README.md\r\n");
      hostSays.state("connection-1", TERMINAL_CONNECTION.EXITED, 3);
      hostSays.output("connection-9", "nobody's");

      const [first, second] = opened;
      assert.ok(first && second);
      assert.equal(first.sender, one.sender);
      assert.equal(second.sender, other.sender);
      assert.deepEqual(first.ticket, { agentId: AGENT_ID, terminalId: SHELL_ID });
      assert.deepEqual(asked, [
        `connect:connection-1:${AGENT_ID}:${SHELL_ID}:120x32`,
        `connect:connection-2:${AGENT_ID}:${SHELL_ID}:120x32`,
      ]);
      assert.deepEqual(first.posted, [
        {
          type: TERMINAL_PORT_MESSAGE.OUTPUT,
          data: new TextEncoder().encode("README.md\r\n"),
        },
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.EXITED, code: 3 },
      ]);
      assert.deepEqual(second.posted, [], "the other panel's port hears none of it");
    }),
);

it.effect(
  "what the panel sends on its port reaches the host by connection, and anything else is dropped",
  () =>
    Effect.gen(function* () {
      const { actPort, asked, opened, drain } = fixture();

      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, panelOf());
      const [port] = opened;
      assert.ok(port);
      port.send({ type: TERMINAL_PORT_MESSAGE.INPUT, data: "ls\r" });
      port.send({ type: TERMINAL_PORT_MESSAGE.RESIZE, cols: 100, rows: 30 });
      port.send({ type: TERMINAL_PORT_MESSAGE.ACK, bytes: 5_000 });
      port.send({ type: "eval", code: "rm -rf /" });
      port.send({ type: TERMINAL_PORT_MESSAGE.RESIZE, cols: 0, rows: 30 });
      yield* drain;

      assert.deepEqual(asked.slice(1), [
        "input:connection-1:ls\r",
        "resize:connection-1:100x30",
        "ack:connection-1:5000",
      ]);
    }),
);

it.effect(
  "a second attach of the same shell, a detach, and the page's end each close the port and let the connection go",
  () =>
    Effect.gen(function* () {
      const { actPort, asked, opened, hostSays, pageGone, drain } = fixture();
      const panel = panelOf();
      const leaving = panelOf();

      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, panel);
      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, panel);
      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_DETACH, payload: DETACH }, panel);
      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, leaving);
      pageGone(leaving.sender);
      yield* drain;
      hostSays.output("connection-2", "late");

      assert.deepEqual(
        opened.map((port) => port.closed),
        [true, true, true],
      );
      assert.deepEqual(
        asked.filter((line) => line.startsWith("disconnect")),
        ["disconnect:connection-1", "disconnect:connection-2", "disconnect:connection-3"],
      );
      assert.deepEqual(opened[1]?.posted, [], "a detached port hears nothing after");
    }),
);

it.effect("an attach the host did not take is refused, and its port closed", () =>
  Effect.gen(function* () {
    const { actPort, opened } = fixture({ connectTaken: false });

    const attached = yield* actPort.perform(
      { kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH },
      panelOf(),
    );

    assert.deepEqual(attached, refusedAs(ACT_KIND.TERMINAL_ATTACH));
    assert.equal(opened[0]?.closed, true);
  }),
);

it.effect(
  "an attach the host refused after a newer attach of the shell leaves the newer one standing",
  () =>
    Effect.gen(function* () {
      const firstAnswer = yield* Deferred.make<boolean>();
      const { actPort, asked, opened } = fixture({
        connect: (connectionId) =>
          connectionId === "connection-1" ? Deferred.await(firstAnswer) : Effect.succeed(true),
      });
      const panel = panelOf();

      const first = yield* Effect.forkChild(
        actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, panel),
      );
      yield* Effect.yieldNow;
      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, panel);
      yield* Deferred.succeed(firstAnswer, false);
      yield* Fiber.join(first);
      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_DETACH, payload: DETACH }, panel);

      assert.equal(opened[1]?.closed, true, "the newer port is still the panel's to detach");
      assert.ok(asked.includes("disconnect:connection-2"));
    }),
);

it("a page is gone when its contents are destroyed, its renderer dies, or it navigates to a new document", () => {
  const ends: string[] = [];
  const watched = (name: string) => {
    const contents = new EventEmitter();
    whenPageGone(contents, () => ends.push(name));
    return contents;
  };

  const reloaded = watched("reloaded");
  reloaded.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  reloaded.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  reloaded.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  reloaded.emit("destroyed");
  watched("crashed").emit("render-process-gone", {}, { reason: "crashed" });
  watched("closed").emit("destroyed");

  assert.deepEqual(ends, ["reloaded", "crashed", "closed"], "each page ends once");
});

it.effect(
  "one shell id under two agents is two shells: a detach of one leaves the other's port",
  () =>
    Effect.gen(function* () {
      const { actPort, opened, hostSays } = fixture();
      const panel = panelOf();
      const otherAgent = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";

      yield* actPort.perform({ kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH }, panel);
      yield* actPort.perform(
        { kind: ACT_KIND.TERMINAL_ATTACH, payload: { ...ATTACH, agentId: otherAgent } },
        panel,
      );
      yield* actPort.perform(
        { kind: ACT_KIND.TERMINAL_DETACH, payload: { agentId: otherAgent, terminalId: SHELL_ID } },
        panel,
      );
      hostSays.output("connection-1", "still here");

      assert.deepEqual(
        opened.map((port) => port.closed),
        [false, true],
      );
      assert.equal(opened[0]?.posted.length, 1, "the first agent's shell still hears its output");
    }),
);

it.effect(
  "a frame this build does not trust is refused, even as a panel, and no port is posted",
  () =>
    Effect.gen(function* () {
      const { actPort, asked, opened } = fixture();
      const untrusted = { trusted: false };

      const listed = yield* actPort.perform(
        { kind: ACT_KIND.TERMINAL_LIST, payload: { agentId: AGENT_ID } },
        panelOf(),
        untrusted,
      );
      const attached = yield* actPort.perform(
        { kind: ACT_KIND.TERMINAL_ATTACH, payload: ATTACH },
        panelOf(),
        untrusted,
      );

      assert.deepEqual(listed, refusedAs(ACT_KIND.TERMINAL_LIST));
      assert.deepEqual(attached, refusedAs(ACT_KIND.TERMINAL_ATTACH));
      assert.deepEqual(asked, []);
      assert.deepEqual(opened, []);
    }),
);

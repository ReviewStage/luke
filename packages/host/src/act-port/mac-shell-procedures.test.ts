import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  TERMINAL_PORT_MESSAGE,
  type TerminalPortOutbound,
  type TerminalPortTicket,
} from "@repo/features/terminal-acts";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { ACT_KIND } from "../acts.js";
import type { ActSender } from "./base.js";
import { type MacShell, macShellProcedures } from "./mac-shell-procedures.js";
import { type TestActPort, testActPort } from "./testing.js";

/**
 * Shells on this Mac as main carries them, over shells and ports that answer
 * from a script: a shell belongs to the window that opened it, which alone
 * attaches to and closes it; it opens at the size the panel asked; its port
 * carries what it printed, its exit, and what the panel typed and resized;
 * output pauses the shell past the tab's acks, and never once the panel
 * closed its port; and a close or the page's end kills it. A window is an inert
 * object of its own. Synthetic ids, folders, and bytes throughout.
 */

/** A platform's handle on a window, which the procedures read by identity alone. */
type Window = { readonly window: number };

const ports: TestActPort<Window>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const FOLDER = "/Users/someone/.vespin/mirrors/8c1a6a4f/repository";

let windows = 0;

const panelOf = (): ActSender<Window> => ({ sender: { window: ++windows }, panel: true });

/** One shell the platform started, as the test drives it and watches it. */
interface ScriptedShell {
  readonly folder: string;
  readonly size: string;
  readonly heard: string[];
  print(text: string): void;
  exit(code: number): void;
}

/** One port posted to a window, as the test watches it. */
interface ScriptedPort {
  readonly sender: Window;
  readonly ticket: TerminalPortTicket;
  readonly posted: TerminalPortOutbound[];
  closed: boolean;
  send(message: WireBoundaryInput): void;
  /** The panel closing its end. */
  hangUp(): void;
}

function fixture() {
  const shells: ScriptedShell[] = [];
  const opened: ScriptedPort[] = [];
  const pageGone = new Map<Window, () => void>();
  let ids = 0;
  const spawn = (folder: string, cols: number, rows: number): MacShell | undefined => {
    if (folder !== FOLDER) return undefined;
    const heard: string[] = [];
    let data: ((bytes: Uint8Array) => void) | undefined;
    let exit: ((code: number) => void) | undefined;
    shells.push({
      folder,
      size: `${cols}x${rows}`,
      heard,
      print: (text) => data?.(new TextEncoder().encode(text)),
      exit: (code) => exit?.(code),
    });
    return {
      onData: (listener) => {
        data = listener;
      },
      onExit: (listener) => {
        exit = listener;
      },
      write: (text) => void heard.push(`write:${text}`),
      resize: (cols, rows) => void heard.push(`resize:${cols}x${rows}`),
      pause: () => void heard.push("pause"),
      resume: () => void heard.push("resume"),
      kill: () => void heard.push("kill"),
    };
  };
  const actPort = testActPort(
    macShellProcedures<Window>({
      mirror: () => Effect.succeed(undefined),
      spawn,
      ports: {
        open: (sender, ticket) => {
          let listener: ((message: WireBoundaryInput) => void) | undefined;
          let hungUp: (() => void) | undefined;
          const port: ScriptedPort = {
            sender,
            ticket,
            posted: [],
            closed: false,
            send: (message) => listener?.(message),
            hangUp: () => hungUp?.(),
          };
          opened.push(port);
          return {
            post: (message) => void port.posted.push(message),
            onMessage: (heard) => {
              listener = heard;
            },
            onClose: (then) => {
              hungUp = then;
            },
            close: () => {
              port.closed = true;
            },
          };
        },
        whenGone: (sender, then) => void pageGone.set(sender, then),
      },
      createId: () => `shell-${++ids}`,
    }),
  );
  ports.push(actPort);
  return {
    actPort,
    shells,
    opened,
    pageGone: (sender: Window) => pageGone.get(sender)?.(),
  };
}

const open = {
  kind: ACT_KIND.MAC_SHELL_OPEN,
  payload: { agentId: AGENT_ID, folder: FOLDER, cols: 100, rows: 30 },
};
const attach = (terminalId: string) => ({
  kind: ACT_KIND.MAC_SHELL_ATTACH,
  payload: { agentId: AGENT_ID, terminalId, cols: 120, rows: 32 },
});
const shellOf = (terminalId: string) => ({ agentId: AGENT_ID, terminalId });

/** What a port carried, its bytes read as text. */
function carried(port: ScriptedPort | undefined) {
  return port?.posted.map((message) =>
    message.type === TERMINAL_PORT_MESSAGE.OUTPUT
      ? new TextDecoder().decode(message.data)
      : message,
  );
}

it.effect(
  "a shell opens in its folder for the panel that asked, which alone attaches to it, and its port carries what it printed and its exit",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const one = panelOf();
      const other = panelOf();

      const elsewhere = yield* actPort.perform(
        { ...open, payload: { agentId: AGENT_ID, folder: "/nowhere" } },
        one,
      );
      const notPanel = yield* actPort.perform(open, { ...one, panel: false });
      const made = yield* actPort.perform(open, one);
      assert.deepEqual(made, { answer: { terminalId: "shell-1" } });
      const stolen = yield* actPort.perform(attach("shell-1"), other);
      yield* actPort.perform(attach("shell-1"), one);
      const [shell] = shells;
      shell?.print("README.md\r\n");
      shell?.exit(3);

      assert.ok("refused" in elsewhere && "refused" in notPanel && "refused" in stolen);
      assert.equal(shells.length, 1);
      assert.equal(
        shells[0]?.size,
        "100x30",
        "the shell opens at the size its screen was fitted to",
      );
      assert.equal(opened.length, 1, "no port is posted to a window that did not open the shell");
      const [port] = opened;
      assert.equal(port?.sender, one.sender);
      assert.deepEqual(port?.ticket, shellOf("shell-1"));
      assert.deepEqual(carried(port), [
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED },
        "README.md\r\n",
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.EXITED, code: 3 },
      ]);
    }),
);

it.effect("what the panel types and resizes on the port reaches the shell", () =>
  Effect.gen(function* () {
    const { actPort, shells, opened } = fixture();
    const panel = panelOf();

    yield* actPort.perform(open, panel);
    yield* actPort.perform(attach("shell-1"), panel);
    const [port] = opened;
    port?.send({ type: TERMINAL_PORT_MESSAGE.INPUT, data: "ls\r" });
    port?.send({ type: TERMINAL_PORT_MESSAGE.RESIZE, cols: 80, rows: 24 });
    port?.send({ type: "something else" });

    assert.deepEqual(shells[0]?.heard, ["resize:120x32", "write:ls\r", "resize:80x24"]);
  }),
);

it.effect(
  "output past the tab's acks pauses the shell, and an ack that catches up resumes it",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(attach("shell-1"), panel);
      shells[0]?.print("x".repeat(TERMINAL_FLOW.PAUSE_ABOVE_BYTES + 1));
      opened[0]?.send({ type: TERMINAL_PORT_MESSAGE.ACK, bytes: TERMINAL_FLOW.PAUSE_ABOVE_BYTES });

      assert.deepEqual(shells[0]?.heard, ["resize:120x32", "pause", "resume"]);
    }),
);

it.effect(
  "a shell whose port the panel closed is never paused for the acks it no longer sends",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(attach("shell-1"), panel);
      opened[0]?.hangUp();
      shells[0]?.print("x".repeat(TERMINAL_FLOW.PAUSE_ABOVE_BYTES + 1));

      assert.deepEqual(shells[0]?.heard, ["resize:120x32"]);
      assert.equal(
        opened[0]?.posted.length,
        1,
        "nothing is posted past the attach on a port that closed",
      );
    }),
);

it.effect(
  "a close and the page's end, a reload or the window's close, each kill the window's shells",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, pageGone } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(open, panel);
      yield* actPort.perform(
        { kind: ACT_KIND.MAC_SHELL_CLOSE, payload: shellOf("shell-1") },
        panel,
      );
      const reattached = yield* actPort.perform(attach("shell-1"), panel);
      pageGone(panel.sender);

      assert.ok("refused" in reattached);
      assert.deepEqual(
        shells.map((shell) => shell.heard),
        [["kill"], ["kill"]],
      );
    }),
);

it.effect(
  "a second attach before the panel takes the first port closes the first, whose close leaves the second live",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(attach("shell-1"), panel);
      yield* actPort.perform(attach("shell-1"), panel);
      const [first, second] = opened;
      first?.hangUp();
      shells[0]?.print("ls\r\n");

      assert.equal(first?.closed, true);
      assert.equal(second?.closed, false);
      assert.deepEqual(carried(second), [
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED },
        "ls\r\n",
      ]);
      assert.ok(!shells[0]?.heard.includes("kill"));
    }),
);

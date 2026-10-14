// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  TERMINAL_PORT_CHANNEL,
  TERMINAL_REFUSAL,
  type TerminalPortInbound,
  type TerminalPortOutbound,
  type TerminalRefusal,
} from "@luke/features/terminal-acts";
import { SANDBOX_STATE, type TerminalsAnswer } from "@luke/features/terminal-wire";
import type { UnparsedWireValue } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "#shared/messages/acts";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/plans-control";
import "../terminal/index";
import { TerminalTab } from "./terminal-tab";

/**
 * An agent's Terminal tab as the developer meets it: a shell in the agent's
 * own sandbox, found and attached only while the tab is shown, under a bar
 * naming the agent and where the connection stands, with each state said the
 * way a terminal says it. Main is the process boundary: its act channel
 * answers from a staged sandbox, and a shell's port is handed into the page
 * as the preload hands it, the test speaking for the host on it. The screen
 * is the real terminal bundle.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: PLAN,
  model: "openai/gpt-5.6-sol",
  effort: "high",
  title: "Invite flow",
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: null,
};

const OLDEST = "3f1c5a7b-9d2e-4b6f-8a1c-3e5f7a9b1d20";
const NEWER = "4a2d6b8c-0e3f-4c7a-9b2d-4f6a8b0c2e31";
const MADE = "5b3e7c9d-1f4a-4d8b-8c3e-5a7b9c1d3f42";

/** A shell as the sandbox lists it. */
function shell(id: string, title: string) {
  return { id, title, command: "zsh", cwd: "/vercel/sandbox/luke", running: false };
}

const RUNNING: TerminalsAnswer = {
  sandbox: SANDBOX_STATE.RUNNING,
  terminals: [shell(OLDEST, "zsh"), shell(NEWER, "dev server")],
};

/** A shell's port as the test holds it: what the tab posted on it, whether the tab closed it, and the host's voice on it. */
interface HostPort {
  readonly posted: TerminalPortInbound[];
  readonly closed: () => boolean;
  /** A message main sends, or one no message of main's, which the tab must ignore. */
  readonly say: (message: TerminalPortOutbound | UnparsedWireValue) => void;
}

/** What main answers and posts, as the test stages it. */
interface Main {
  /** Every act the tab sent, by kind and payload, in order. */
  readonly sent: Act[];
  /** The sandbox's list as `terminal.list` answers it, which a test may change. */
  listed: TerminalsAnswer;
  /** The kinds main refuses outright, as it does when the service cannot be reached. */
  readonly down: Set<ActKind>;
  /** What `terminal.create` answers in place of a shell, where the sandbox refuses one. */
  createRefused: TerminalRefusal | undefined;
  /** What `terminal.list` answers in place of the list, where the service refuses it. */
  listRefused: TerminalRefusal | undefined;
  /** Posts a shell's port to the tab, as main does after an attach, answering the host's half. */
  readonly post: (terminalId: string) => HostPort;
}

const roots: Root[] = [];
let main: Main;

beforeEach(() => {
  const sent: Act[] = [];
  const answer = (request: Act): ActResultFor<ActKind> => {
    switch (request.kind) {
      case ACT_KIND.TERMINAL_LIST:
        return main.listRefused === undefined ? main.listed : { refused: main.listRefused };
      case ACT_KIND.TERMINAL_CREATE:
        if (main.createRefused !== undefined) return { refused: main.createRefused };
        main.listed = { ...main.listed, terminals: [...main.listed.terminals, shell(MADE, "zsh")] };
        return { terminal: shell(MADE, "zsh") };
      case ACT_KIND.TERMINAL_RESUME:
        main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [] };
        return { sandbox: SANDBOX_STATE.RUNNING };
      default:
        return undefined;
    }
  };
  main = {
    sent,
    listed: RUNNING,
    down: new Set(),
    createRefused: undefined,
    listRefused: undefined,
    post: (terminalId) => {
      const { port1: port } = new MessageChannel();
      const posted: TerminalPortInbound[] = [];
      vi.spyOn(port, "postMessage").mockImplementation((message: TerminalPortInbound) => {
        posted.push(message);
      });
      const close = vi.spyOn(port, "close");
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { channel: TERMINAL_PORT_CHANNEL, ticket: { agentId: AGENT.id, terminalId } },
            source: window,
            ports: [port],
          }),
        );
      });
      return {
        posted,
        closed: () => close.mock.calls.length > 0,
        // The host's message, delivered to the tab's own handler as the port would.
        say: (message) =>
          act(() => port.onmessage?.(new MessageEvent("message", { data: message }))),
      };
    },
  };
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        if (main.down.has(request.kind)) {
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.REFUSED,
            reason: "Could not reach this agent's sandbox.",
          });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: answer(request) });
      },
    },
  });
  // jsdom has neither constructed sheets nor media queries; the window has both.
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    writable: true,
    value: [],
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Lets the act channel's answers, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The tab mounted for the agent, shown or not, with what it draws. */
async function mount(shown = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  const registry = AtomRegistry.make();
  let closed = 0;
  const render = (on: boolean) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(TerminalTab, {
            agentId: AGENT.id,
            agents,
            shown: on,
            onOpenAgent: () => undefined,
            onClose: () => {
              closed += 1;
            },
          }),
        ),
      ),
    );
  render(shown);
  await settle();
  const keyboard = () => {
    const field = container.querySelector("textarea");
    assert.ok(field, "the screen takes the keyboard");
    return field;
  };
  return {
    container,
    render: async (on: boolean) => {
      render(on);
      await settle();
    },
    /** How many times the tab asked to close. */
    closed: () => closed,
    /** The acts the tab sent, by kind, from the n-th on. */
    kinds: (from = 0) => main.sent.slice(from).map((request) => request.kind),
    /** Where the bar says the connection stands. */
    standing: () => container.querySelector(".terminal-tab-standing")?.textContent,
    /** The slim bar's words, its action's label, or nothing without one. */
    bar: () => container.querySelector(".terminal-bar-words")?.textContent,
    action: () => container.querySelector<HTMLButtonElement>(".terminal-bar-action"),
    dimmed: () =>
      container.querySelector(".terminal-tab-screen")?.getAttribute("data-dim") === "true",
    /** A key pressed in the screen, as the window delivers it: its keypress only where its keydown went unclaimed. */
    type: async (key: string, keyCode: number) => {
      const field = keyboard();
      const down = new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true });
      field.dispatchEvent(down);
      if (!down.defaultPrevented) {
        const charCode = key.length === 1 ? key.charCodeAt(0) : keyCode;
        field.dispatchEvent(
          new KeyboardEvent("keypress", {
            key,
            keyCode,
            charCode,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      await settle();
    },
  };
}

/**
 * Text as the bytes a shell prints, in this page's own `Uint8Array`, as a
 * port's structured clone delivers them. Note that jsdom's `TextEncoder`
 * answers another realm's.
 */
function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/** The attach the tab sent last, as main received it. */
function lastAttach() {
  const attach = main.sent.findLast((request) => request.kind === "terminal.attach");
  assert.ok(attach);
  return attach.payload;
}

test("the tab is left out of the screen recording, its screen and bar with it", async () => {
  const tab = await mount();
  const screen = tab.container.querySelector(".terminal-tab-screen");
  assert.ok(screen?.closest(".ph-no-capture"));
  assert.ok(tab.container.querySelector(".file-view-bar")?.closest(".ph-no-capture"));
});

test("shown, the tab lists the agent's shells and attaches to the oldest; hidden, it lets the port go and attaches nothing more", async () => {
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["terminal.list", "terminal.attach"]);
  const attach = lastAttach();
  assert.ok(attach instanceof Object && "terminalId" in attach);
  assert.equal(attach.terminalId, OLDEST);
  assert.equal(tab.standing(), "· sandbox · connecting…");
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  assert.equal(tab.standing(), "· sandbox · connected");
  assert.equal(tab.bar(), undefined);
  await tab.render(false);
  assert.equal(port.closed(), true);
  assert.deepEqual(tab.kinds(2), []);
});

test("what is typed goes to the shell's port while it is connected", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  await tab.type("l", 76);
  await tab.type("Enter", 13);
  const typed = port.posted.flatMap((message) => (message.type === "input" ? [message.data] : []));
  assert.equal(typed.join(""), "l\r");
});

test("a port posted for a shell the tab did not ask for, or after it was hidden, is closed at once", async () => {
  const tab = await mount();
  assert.equal(main.post(NEWER).closed(), true);
  await tab.render(false);
  assert.equal(main.post(OLDEST).closed(), true);
});

test("a sandbox with no shell has one opened, and the tab attaches to it", async () => {
  main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [] };
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["terminal.list", "terminal.create", "terminal.attach"]);
  const attach = lastAttach();
  assert.ok(attach instanceof Object && "terminalId" in attach);
  assert.equal(attach.terminalId, MADE);
});

test("a stopped sandbox shows its bar over the dimmed screen and resumes only on its action, then opens a shell", async () => {
  main.listed = { sandbox: SANDBOX_STATE.STOPPED, terminals: [] };
  const tab = await mount();
  assert.equal(tab.standing(), "· sandbox · sandbox stopped");
  assert.equal(tab.bar(), "Sandbox stopped.");
  assert.equal(tab.dimmed(), true);
  assert.match(tab.action()?.textContent ?? "", /^Resume sandbox/);
  // Typing anything but Return resumes nothing.
  await tab.type("x", 88);
  assert.deepEqual(tab.kinds(), ["terminal.list"]);
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(), [
    "terminal.list",
    "terminal.resume",
    "terminal.list",
    "terminal.create",
    "terminal.attach",
  ]);
});

test("Return on the stopped bar resumes the sandbox, as its action does", async () => {
  main.listed = { sandbox: SANDBOX_STATE.STOPPED, terminals: [] };
  const tab = await mount();
  await tab.type("Enter", 13);
  assert.equal(tab.kinds()[1], "terminal.resume");
});

test("an agent that has not opened its sandbox yet shows the waiting bar", async () => {
  main.listed = { sandbox: SANDBOX_STATE.STARTING, terminals: [] };
  const tab = await mount();
  assert.equal(tab.standing(), "· sandbox · waiting for sandbox");
  assert.equal(tab.bar(), "Waiting for the agent to open its sandbox…");
  assert.equal(tab.action(), null);
});

test("a dropped connection shows its bar, late, and its action asks for the shell again at once", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "reconnecting" });
  assert.equal(tab.bar(), "Connection lost. Reconnecting…");
  assert.equal(tab.container.querySelector(".terminal-bar")?.getAttribute("data-late"), "true");
  assert.equal(tab.dimmed(), true);
  const before = main.sent.length;
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.attach"]);
});

test("after five idle minutes the screen dims with no bar, and any key reconnects to the same shell", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "idle" });
  assert.equal(tab.standing(), "· sandbox · disconnected");
  assert.equal(tab.bar(), undefined);
  assert.equal(tab.dimmed(), true);
  const before = main.sent.length;
  await tab.type("q", 81);
  assert.deepEqual(tab.kinds(before), ["terminal.attach"]);
  const attach = lastAttach();
  assert.ok(attach instanceof Object && "terminalId" in attach);
  assert.equal(attach.terminalId, OLDEST);
  // The key reconnected; it never reached the shell.
  assert.equal(port.posted.length, 0);
});

test("a shell that ended takes any key for a new one", async () => {
  main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [shell(OLDEST, "zsh")] };
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "exited", code: 0 });
  assert.equal(tab.bar(), undefined);
  assert.equal(tab.dimmed(), false);
  main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [] };
  const before = main.sent.length;
  await tab.type("a", 65);
  assert.deepEqual(tab.kinds(before), ["terminal.list", "terminal.create", "terminal.attach"]);
});

test("a sandbox that refuses a shell because it stopped meanwhile shows the stopped bar", async () => {
  main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [] };
  main.createRefused = TERMINAL_REFUSAL.SANDBOX_STOPPED;
  const tab = await mount();
  assert.equal(tab.bar(), "Sandbox stopped.");
  assert.deepEqual(tab.kinds(), ["terminal.list", "terminal.create"]);
});

test("a service it cannot reach shows a bar whose action asks again", async () => {
  main.down.add(ACT_KIND.TERMINAL_LIST);
  const tab = await mount();
  assert.equal(tab.standing(), "· sandbox · unreachable");
  assert.equal(tab.bar(), "Couldn’t reach the sandbox.");
  main.down.clear();
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(), ["terminal.list", "terminal.list", "terminal.attach"]);
});

test("the screen says it has drawn each five thousand characters of output, which the host paces the shell by", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  vi.useFakeTimers();
  port.say({ type: "output", data: bytes("x".repeat(4_000)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(port.posted, []);
  port.say({ type: "output", data: bytes("y".repeat(1_500)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(port.posted, [{ type: "ack", bytes: 5_500 }]);
  assert.equal(tab.standing(), "· sandbox · connected");
});

test("a message on the port that is no message of main's is never drawn nor acted on", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  port.say({ type: "state", state: "melted" });
  port.say({ type: "output", data: "not bytes" });
  assert.equal(tab.standing(), "· sandbox · connected");
});

test("a terminal bundle that fails to load leaves the tab saying so, and attaches nothing", async () => {
  const bundle = window.lukeTerminal;
  assert.ok(bundle);
  delete window.lukeTerminal;
  try {
    const tab = await mount();
    const script = document.head.querySelector('script[src="terminal.js"]');
    assert.ok(script, "the tab asks for the bundle");
    script.dispatchEvent(new Event("error"));
    await settle();
    assert.equal(
      tab.container.querySelector(".terminal-tab-failed")?.textContent,
      "The terminal could not be shown.",
    );
    assert.deepEqual(tab.kinds(), []);
  } finally {
    window.lukeTerminal = bundle;
  }
});

test("an agent archived or retired closes its Terminal tab, as its Changes tab closes", async () => {
  main.listRefused = TERMINAL_REFUSAL.GONE;
  const tab = await mount();
  assert.equal(tab.closed(), 1);
  assert.deepEqual(tab.kinds(), ["terminal.list"]);
});

test("a shell or agent the service cannot find shows the bar that asks again, and leaves the tab open", async () => {
  main.listRefused = TERMINAL_REFUSAL.NOT_FOUND;
  const tab = await mount();
  assert.equal(tab.bar(), "Couldn’t reach the sandbox.");
  assert.equal(tab.closed(), 0);
});

test("of two attaches out at once, only the newest one's port is taken, and the late one is closed", async () => {
  const tab = await mount();
  // Hidden and shown again before the first attach's port lands, the tab attaches again.
  await tab.render(false);
  await tab.render(true);
  assert.deepEqual(tab.kinds(), [
    "terminal.list",
    "terminal.attach",
    "terminal.list",
    "terminal.attach",
  ]);
  // Main posts the ports in the order the attaches went out.
  const late = main.post(OLDEST);
  assert.equal(late.closed(), true);
  // What the late port says moves nothing: the tab waits on the newest.
  late.say({ type: "state", state: "attached" });
  assert.equal(tab.standing(), "· sandbox · connecting…");
  const newest = main.post(OLDEST);
  assert.equal(newest.closed(), false);
  newest.say({ type: "state", state: "attached" });
  await tab.type("x", 88);
  assert.deepEqual(newest.posted, [{ type: "input", data: "x" }]);
});

test("output still being drawn when its port gives way is counted for no other port", async () => {
  const tab = await mount();
  const first = main.post(OLDEST);
  first.say({ type: "state", state: "attached" });
  vi.useFakeTimers();
  first.say({ type: "output", data: bytes("x".repeat(6_000)) });
  first.say({ type: "state", state: "reconnecting" });
  await act(async () => tab.action()?.click());
  const second = main.post(OLDEST);
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(second.posted, []);
});

test("the bar's action hands the keyboard back to the screen, since its button goes with the bar", async () => {
  main.listed = { sandbox: SANDBOX_STATE.STOPPED, terminals: [] };
  const tab = await mount();
  const resume = tab.action();
  assert.ok(resume);
  resume.focus();
  await act(async () => resume.click());
  await settle();
  // Note that the elements are compared as a yes or no, because a failing comparison of two elements prints them whole.
  assert.ok(
    document.activeElement === tab.container.querySelector("textarea"),
    "the screen holds the keyboard",
  );
});

test("what is typed while the connection is still opening goes nowhere, as the host would drop it", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "connecting" });
  await tab.type("l", 76);
  assert.deepEqual(port.posted, []);
  port.say({ type: "state", state: "attached" });
  await tab.type("s", 83);
  assert.deepEqual(port.posted, [{ type: "input", data: "s" }]);
});

test("a port that answers no attach in line is closed without losing the tab its place, so a late one is still told apart", async () => {
  const tab = await mount();
  await tab.render(false);
  await tab.render(true);
  // Two attaches are out for the oldest shell; a port for another shell answers neither.
  assert.equal(main.post(NEWER).closed(), true);
  const late = main.post(OLDEST);
  assert.equal(late.closed(), true);
  const newest = main.post(OLDEST);
  assert.equal(newest.closed(), false);
});

test("a tab taken down with an attach still out lets its shell go, and closes the port that lands after it", async () => {
  await mount();
  for (const root of roots.splice(0)) act(() => root.unmount());
  assert.deepEqual(main.sent.at(-1), {
    kind: ACT_KIND.TERMINAL_DETACH,
    payload: { agentId: AGENT.id, terminalId: OLDEST },
  });
  assert.equal(main.post(OLDEST).closed(), true);
});

test("a paste longer than one message is cut between characters, never inside one", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  // An emoji straddling the cut: two UTF-16 units across the limit.
  const paste = `${"a".repeat(65_535)}😀b`;
  const field = tab.container.querySelector("textarea");
  assert.ok(field);
  act(() => {
    // jsdom draws no clipboard; the paste carries the one reader the terminal asks of it.
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => paste } });
    field.dispatchEvent(event);
  });
  await settle();
  const sent = port.posted.flatMap((message) => (message.type === "input" ? [message.data] : []));
  assert.equal(sent.join(""), paste);
  for (const part of sent) assert.doesNotMatch(part, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
});

test("an attach refused after its tab was taken down leaves nothing waiting, so a later tab's port for the same shell stands", async () => {
  main.down.add(ACT_KIND.TERMINAL_ATTACH);
  await mount();
  for (const root of roots.splice(0)) act(() => root.unmount());
  await settle();
  main.down.clear();
  const later = await mount();
  const port = main.post(OLDEST);
  assert.equal(port.closed(), false);
  port.say({ type: "state", state: "attached" });
  assert.equal(later.standing(), "· sandbox · connected");
});

test("a tab taken down with attaches out for two shells closes both ports, whichever lands first", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "idle" });
  // A key re-attaches the oldest shell; hidden and shown, the tab attaches again before any port lands.
  await tab.type("q", 81);
  main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [shell(NEWER, "dev server")] };
  await tab.render(false);
  await tab.render(true);
  for (const root of roots.splice(0)) act(() => root.unmount());
  // The later attach's port lands first.
  assert.equal(main.post(NEWER).closed(), true);
  assert.equal(main.post(OLDEST).closed(), true);
});

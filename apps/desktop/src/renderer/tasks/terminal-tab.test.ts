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
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "@luke/host/acts";
import type { UnparsedWireValue } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/tasks-control";
import "../terminal/index";
import { shellsAsked } from "@luke/features/terminal-store";
import { APP_COMMAND } from "#shared/shortcuts";
import { runAppCommand } from "../app-commands";
import { FindScope } from "../find-in-tab";
import { TerminalCardFoot } from "./terminal-shells";
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

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK,
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
  /** The answers held back, in the order asked, each landing when the test lets it go. */
  readonly held: (() => void)[];
  /** The kinds whose answers are held back until the test lets them go. */
  readonly holding: Set<ActKind>;
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
      case ACT_KIND.TERMINAL_RENAME:
        main.listed = {
          ...main.listed,
          terminals: main.listed.terminals.map((each) =>
            each.id === request.payload.terminalId
              ? { ...each, title: request.payload.title }
              : each,
          ),
        };
        return main.listed;
      case ACT_KIND.TERMINAL_KILL:
        main.listed = {
          ...main.listed,
          terminals: main.listed.terminals.filter((each) => each.id !== request.payload.terminalId),
        };
        return main.listed;
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
    held: [],
    holding: new Set(),
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
        // A held answer says what main said when it was asked, landing whenever it is let go.
        if (main.holding.has(request.kind)) {
          const value = answer(request);
          return new Promise((resolve) =>
            main.held.push(() => resolve({ status: ACT_OUTCOME_STATUS.DONE, value })),
          );
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
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** Lets the act channel's answers, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The tab mounted for the agent, shown or not, with what it draws. */
async function mount(
  shown = true,
  shellsOpen = true,
  before?: (registry: AtomRegistry.AtomRegistry) => void,
  /** Whether the tab stands in a find scope holding the window's keys, as the side panel draws it. */
  findable = false,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  const registry = AtomRegistry.make();
  before?.(registry);
  const wrapped = (tab: React.ReactElement) =>
    findable
      ? createElement(FindScope, {
          active: true,
          subject: { task: TASK, tab: { terminal: AGENT.id } },
          children: tab,
        })
      : tab;
  let closed = 0;
  let toggled = 0;
  const render = (on: boolean) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          wrapped(
            createElement(TerminalTab, {
              agentId: AGENT.id,
              agents,
              shown: on,
              onOpenAgent: () => undefined,
              onClose: () => {
                closed += 1;
              },
              shells: {
                open: shellsOpen,
                onToggle: () => {
                  toggled += 1;
                },
              },
            }),
          ),
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
    /** How many times the shells list's toggle was pressed. */
    toggled: () => toggled,
    registry,
    /** The shells as the list draws them: each one's name, what it says under it, whether it is shown, and whether it runs something. */
    rows: () =>
      [...container.querySelectorAll(".terminal-shell")].map((row) => ({
        name: row.querySelector(".terminal-shell-name")?.textContent,
        detail: row.querySelector(".terminal-shell-detail")?.textContent,
        shown: row.getAttribute("aria-current") === "true",
        running: row.querySelector(".terminal-shell-running") !== null,
      })),
    /** Presses the button the label names, wherever it stands in the tab. */
    press: async (label: string) => {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      assert.ok(button, `a button named ${label}`);
      await act(async () => button.click());
      await settle();
    },
    /** Presses a shell's row, which shows it. */
    choose: async (name: string) => {
      const row = [...container.querySelectorAll<HTMLButtonElement>(".terminal-shell-row")].find(
        (each) => each.querySelector(".terminal-shell-name")?.textContent === name,
      );
      assert.ok(row, `a row for ${name}`);
      // A press takes the keyboard to the row first, as the window's does.
      row.focus();
      await act(async () => row.click());
      await settle();
    },
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

test("a service it cannot reach shows a bar that says so, whose action asks again", async () => {
  main.down.add(ACT_KIND.TERMINAL_LIST);
  const tab = await mount();
  assert.equal(tab.standing(), "· sandbox · unreachable");
  assert.equal(tab.bar(), "Couldn’t reach Luke’s service.");
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
  assert.equal(tab.bar(), "Couldn’t find this agent’s shell.");
  assert.equal(tab.closed(), 0);
});

test("a sandbox that did not answer says it was the agent's sandbox, and its action asks again", async () => {
  main.listRefused = TERMINAL_REFUSAL.SANDBOX_UNANSWERED;
  const tab = await mount();
  assert.equal(tab.standing(), "· sandbox · unreachable");
  assert.equal(tab.bar(), "The agent’s sandbox didn’t answer.");
  main.listRefused = undefined;
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(), ["terminal.list", "terminal.list", "terminal.attach"]);
});

test("a deployment that serves no terminal relay says so, and leaves the tab open", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "unavailable" });
  assert.equal(tab.bar(), "The terminal service isn’t set up on this deployment.");
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

/** The payload of the last act of the kind the tab sent, as main received it. */
function lastPayload(kind: ActKind) {
  const request = main.sent.findLast((each) => each.kind === kind);
  assert.ok(request, `the tab sent ${kind}`);
  return "payload" in request ? request.payload : undefined;
}

test("the list shows each shell in the agent's sandbox, the one shown marked, a running one's command and its dot", async () => {
  main.listed = {
    sandbox: SANDBOX_STATE.RUNNING,
    terminals: [
      shell(OLDEST, "zsh"),
      { ...shell(NEWER, "dev server"), command: "pnpm dev", running: true },
    ],
  };
  const tab = await mount();
  assert.deepEqual(tab.rows(), [
    { name: "zsh", detail: "luke", shown: true, running: false },
    { name: "dev server", detail: "pnpm dev", shown: false, running: true },
  ]);
});

test("a press on another shell's row shows that shell, from a clear screen", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await tab.choose("dev server");
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_ATTACH), {
    agentId: AGENT.id,
    terminalId: NEWER,
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(
    tab.rows().map((row) => row.shown),
    [false, true],
  );
});

test("the list's + starts a shell in the same agent's sandbox and shows it", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await tab.press("New shell");
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_CREATE), { agentId: AGENT.id });
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_ATTACH), {
    agentId: AGENT.id,
    terminalId: MADE,
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(
    tab.rows().map((row) => [row.name, row.shown]),
    [
      ["zsh", false],
      ["dev server", false],
      ["zsh", true],
    ],
  );
});

/** Answers the question standing over the window with its act's button. */
async function confirmWith(verb: string): Promise<void> {
  const dialog = document.querySelector('[role="alertdialog"]');
  assert.ok(dialog, "a question stands over the window");
  const button = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === verb,
  );
  assert.ok(button, `the question offers ${verb}`);
  await act(async () => button.click());
}

test("a shell's × asks first, then ends it, and ending the one shown shows the oldest left", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  const before = main.sent.length;
  await tab.press("End zsh");
  assert.equal(document.querySelector('[role="alertdialog"] h2')?.textContent, "End zsh?");
  assert.deepEqual(tab.kinds(before), [], "nothing is ended before the answer");
  await confirmWith("End shell");
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.kill", "terminal.list", "terminal.attach"]);
  assert.deepEqual(
    tab.rows().map((row) => [row.name, row.shown]),
    [["dev server", true]],
  );
});

test("a shell renamed from its row's menu is renamed in place, and the list says its new name", async () => {
  const tab = await mount();
  const row = tab.container.querySelector<HTMLButtonElement>(".terminal-shell-row");
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  const rename = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Rename",
  );
  assert.ok(rename, "the row's menu offers Rename");
  await act(async () => rename.click());
  const field = tab.container.querySelector<HTMLInputElement>('input[aria-label="Shell name"]');
  assert.ok(field, "the name is edited in place");
  act(() => {
    field.value = "server";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_RENAME), {
    agentId: AGENT.id,
    terminalId: OLDEST,
    title: "server",
  });
  assert.equal(tab.rows()[0]?.name, "server");
});

test("the shells list folds away beside the screen, and its toggle asks the panel to bring it back", async () => {
  const tab = await mount(true, false);
  assert.equal(tab.container.querySelector(".terminal-shells"), null);
  await tab.press("Show shells");
  assert.equal(tab.toggled(), 1);
});

// Note that the test is given longer than most, because jsdom takes seconds
// to lay the window's stylesheets for a width beside a running terminal.
test("in a side panel too narrow for the list beside the screen, the list stands over the screen only while its own toggle holds it open, and a shell chosen there takes it down", {
  timeout: 30_000,
}, async () => {
  const tab = await mount(true, true);
  layContainersAt({ "side-panel": 280 });
  // Note that each element is read for its own display alone, which is where
  // the rules read here hide one, because jsdom takes a tenth of a second to
  // cascade an element through the window's stylesheets.
  const displayed = (element: Element) => getComputedStyle(element).display !== "none";
  const drawn = () => {
    const list = tab.container.querySelector(".terminal-shells");
    return list !== null && displayed(list);
  };
  const toggles = () =>
    [...tab.container.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].filter(displayed);

  assert.equal(drawn(), false, "the list the panel holds open beside the screen stands nowhere");
  assert.deepEqual(
    toggles().map((button) => button.getAttribute("aria-label")),
    ["Show shells"],
  );

  await act(async () => toggles()[0]?.click());
  await settle();
  assert.equal(drawn(), true, "the list stands over the screen");
  assert.equal(toggles()[0]?.getAttribute("aria-label"), "Hide shells");
  assert.equal(tab.toggled(), 0, "the panel's own choice for every tab is left as it was");

  await tab.choose("dev server");
  assert.equal(drawn(), false, "a shell chosen takes the list down");
  // Note that the elements are compared as a yes or no, because a failing comparison of two elements prints them whole.
  assert.ok(
    document.activeElement === tab.container.querySelector("textarea"),
    "the screen holds the keyboard, the list's hold on it gone with the list",
  );
});

// Note that the test is given longer than most, for the reason the one above is.
test("a list opened over the screen and then given room beside it by a widened panel holds the keyboard no more, nor takes the window's Escape", {
  timeout: 30_000,
}, async () => {
  const tab = await mount(true, true);
  const narrow = layContainersAt({ "side-panel": 280 });
  const displayed = (element: Element) => getComputedStyle(element).display !== "none";
  const toggle =
    [...tab.container.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].find(displayed) ??
    assert.fail("a toggle is drawn");
  toggle.focus();
  await act(async () => toggle.click());
  await settle();
  const list = tab.container.querySelector(".terminal-shells") ?? assert.fail("the list is drawn");
  assert.ok(list.contains(document.activeElement), "the keyboard lands in the list");

  narrow.remove();
  layContainersAt({ "side-panel": 520 });
  const screen =
    tab.container.querySelector<HTMLTextAreaElement>("textarea") ??
    assert.fail("the screen is drawn");
  // jsdom walks no focus for Tab, so the walk out is the key, then the focus it lands.
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    screen.focus();
  });
  assert.ok(document.activeElement === screen, "the keyboard stays where it was taken");
  const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(press);
  });
  assert.equal(press.defaultPrevented, false, "the window's own Escape is left to it");
});

// Note that the test is given longer than most, for the reason the one above is.
test("in a side panel at its default width the shells float over the screen rather than stand beside it, peeked by the pointer resting on their toggle and gone once it leaves", {
  timeout: 30_000,
}, async () => {
  const tab = await mount(true, true);
  layContainersAt({ "side-panel": 400 });
  const displayed = (element: Element) => getComputedStyle(element).display !== "none";
  const drawn = () => {
    const list = tab.container.querySelector(".terminal-shells");
    return list !== null && displayed(list);
  };
  const toggle =
    [...tab.container.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].find(displayed) ??
    assert.fail("a toggle is drawn");
  const screen =
    tab.container.querySelector(".terminal-tab-screen") ?? assert.fail("the screen is drawn");
  const cross = (from: Element, to: Element, clientY: number) =>
    act(() => {
      from.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: to, clientY }),
      );
      to.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, relatedTarget: from, clientY }),
      );
    });

  assert.equal(drawn(), false, "the list the panel holds open beside the screen stands nowhere");
  assert.equal(toggle.dataset.place, "over");
  cross(screen, toggle, 0);
  assert.equal(drawn(), true, "the list floats over the screen");
  cross(toggle, screen, -10);
  assert.equal(drawn(), false, "leaving the toggle takes it down");
  assert.equal(tab.toggled(), 0, "the panel's own choice for every tab is left as it was");
});

// Note that the test is given longer than most, for the reason the one above is.
test("a shell started from the list floating over the screen takes the list down, its screen holding the keyboard", {
  timeout: 30_000,
}, async () => {
  const tab = await mount(true, true);
  main.post(OLDEST).say({ type: "state", state: "attached" });
  layContainersAt({ "side-panel": 280 });
  const displayed = (element: Element) => getComputedStyle(element).display !== "none";
  const toggle =
    [...tab.container.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].find(displayed) ??
    assert.fail("a toggle is drawn");
  await act(async () => toggle.click());
  await tab.press("New shell");
  const list = tab.container.querySelector(".terminal-shells");
  assert.equal(list !== null && displayed(list), false, "the list is taken down");
  assert.ok(
    document.activeElement === tab.container.querySelector("textarea"),
    "the new shell's screen holds the keyboard",
  );
});

test("while shown, the shells are read again every few seconds and whenever the window takes the keyboard back", async () => {
  vi.useFakeTimers();
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  const before = main.sent.length;
  main.listed = { ...main.listed, terminals: [...main.listed.terminals, shell(MADE, "tests")] };
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  assert.deepEqual(tab.kinds(before), ["terminal.list"]);
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["zsh", "dev server", "tests"],
  );
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.list", "terminal.list"]);
});

test("the tab's card counts the agent's shells as the tab last read them", async () => {
  const tab = await mount();
  const foot = renderToStaticMarkup(
    onRegistry(tab.registry, createElement(TerminalCardFoot, { agentId: AGENT.id })),
  );
  assert.equal(foot, "Terminal in this agent’s sandbox · 2 shells");
});

test("the list's foot names the agent and where it stands", async () => {
  const tab = await mount();
  assert.equal(tab.container.querySelector(".terminal-shells-foot")?.textContent, "Working…");
});

test("a sandbox that stops under a connected shell is read again, and the list says it holds no shells", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  main.listed = { sandbox: SANDBOX_STATE.STOPPED, terminals: [] };
  port.say({ type: "state", state: "stopped" });
  await settle();
  assert.equal(tab.container.querySelector(".terminal-shells-none")?.textContent, "No shells.");
  assert.equal(tab.container.querySelector(".terminal-shells-foot")?.textContent, "Working…");
  assert.equal(
    tab.container.querySelector<HTMLButtonElement>('button[aria-label="New shell"]')?.disabled,
    true,
  );
});

test("a shell chosen from the list takes the keyboard to the screen, the shell's to type into", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await tab.choose("dev server");
  // Note that the elements are compared as a yes or no, because a failing comparison of two elements prints them whole.
  assert.ok(
    document.activeElement === tab.container.querySelector("textarea"),
    "the screen holds the keyboard",
  );
});

test("a read of the shells that went out before a rename lands nowhere, so the new name stands", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  main.holding.add(ACT_KIND.TERMINAL_LIST);
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  main.holding.clear();
  const row = tab.container.querySelector<HTMLButtonElement>(".terminal-shell-row");
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  const rename = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Rename",
  );
  await act(async () => rename?.click());
  const field = tab.container.querySelector<HTMLInputElement>('input[aria-label="Shell name"]');
  assert.ok(field);
  act(() => {
    field.value = "server";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
  // The read from before the rename lands now, holding the old name.
  for (const release of main.held.splice(0)) release();
  await settle();
  assert.equal(tab.rows()[0]?.name, "server");
});

test("ending the shown shell starts one shell in its place, though the host says it went before the end answers", async () => {
  main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [shell(OLDEST, "zsh")] };
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  const before = main.sent.length;
  main.holding.add(ACT_KIND.TERMINAL_KILL);
  await tab.press("End zsh");
  await confirmWith("End shell");
  // The host says the shell is gone, on the port the tab let go, before the end answers.
  port.say({ type: "state", state: "gone" });
  await settle();
  main.holding.clear();
  for (const release of main.held.splice(0)) release();
  await settle();
  assert.deepEqual(tab.kinds(before), [
    "terminal.kill",
    "terminal.list",
    "terminal.create",
    "terminal.attach",
  ]);
});

test("an end the service refuses leaves the shown shell shown, attached again, and the question saying why", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  main.down.add(ACT_KIND.TERMINAL_KILL);
  const before = main.sent.length;
  await tab.press("End zsh");
  await confirmWith("End shell");
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.kill", "terminal.list", "terminal.attach"]);
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_ATTACH), {
    agentId: AGENT.id,
    terminalId: OLDEST,
    cols: 80,
    rows: 24,
  });
  assert.match(
    document.querySelector('[role="alertdialog"]')?.textContent ?? "",
    /Could not end that shell\./,
  );
});

test("an end still out when another shell is chosen leaves the chosen one shown", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  main.holding.add(ACT_KIND.TERMINAL_KILL);
  await tab.press("End zsh");
  await confirmWith("End shell");
  await tab.choose("dev server");
  const before = main.sent.length;
  main.holding.clear();
  for (const release of main.held.splice(0)) release();
  await settle();
  assert.deepEqual(tab.kinds(before), []);
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_ATTACH), {
    agentId: AGENT.id,
    terminalId: NEWER,
    cols: 80,
    rows: 24,
  });
});

test("the question asked from the list goes when the tab leaves the screen", async () => {
  const tab = await mount();
  await tab.press("End zsh");
  assert.ok(document.querySelector('[role="alertdialog"]'), "the question stands");
  await tab.render(false);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("an idle close is the shown shell's alone: one said on a shell no longer shown changes nothing, and a key after the shown one's re-attaches it", async () => {
  const tab = await mount();
  const first = main.post(OLDEST);
  first.say({ type: "state", state: "attached" });
  await tab.choose("dev server");
  const shown = main.post(NEWER);
  shown.say({ type: "state", state: "attached" });
  // The relay closes each terminal on its own five idle minutes: the one no longer shown first.
  first.say({ type: "state", state: "idle" });
  assert.equal(tab.standing(), "· sandbox · connected");
  assert.equal(tab.dimmed(), false);
  shown.say({ type: "state", state: "idle" });
  assert.equal(tab.standing(), "· sandbox · disconnected");
  const before = main.sent.length;
  await tab.type("q", 81);
  assert.deepEqual(tab.kinds(before), ["terminal.attach"]);
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_ATTACH), {
    agentId: AGENT.id,
    terminalId: NEWER,
    cols: 80,
    rows: 24,
  });
});

test("a new shell asked for before the tab opens is started in place of attaching to the oldest", async () => {
  const tab = await mount(true, true, (registry) => registry.set(shellsAsked(AGENT.id), 1));
  assert.deepEqual(tab.kinds(), ["terminal.list", "terminal.create", "terminal.attach"]);
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 0);
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_ATTACH), {
    agentId: AGENT.id,
    terminalId: MADE,
    cols: 80,
    rows: 24,
  });
});

test("a new shell asked for while a shell is connected starts at once, and shows", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  const before = main.sent.length;
  act(() => {
    tab.registry.update(shellsAsked(AGENT.id), (asked) => asked + 1);
  });
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.create", "terminal.attach", "terminal.list"]);
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 0);
});

test("two new shells asked for at once start two shells, each ask its own", async () => {
  const tab = await mount(true, true, (registry) => registry.set(shellsAsked(AGENT.id), 2));
  assert.deepEqual(tab.kinds(), ["terminal.list", "terminal.create", "terminal.attach"]);
  main.post(MADE).say({ type: "state", state: "attached" });
  await settle();
  assert.equal(tab.kinds().filter((kind) => kind === "terminal.create").length, 2);
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 0);
});

test("a new shell asked for after an idle close connects again and starts it, as a key would", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "idle" });
  const before = main.sent.length;
  act(() => {
    tab.registry.update(shellsAsked(AGENT.id), (asked) => asked + 1);
  });
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.list", "terminal.create", "terminal.attach"]);
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 0);
});

test("a new shell asked for while the tab is hidden waits for a stopped sandbox's Resume, and is not lost", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await tab.render(false);
  main.listed = { sandbox: SANDBOX_STATE.STOPPED, terminals: [] };
  act(() => {
    tab.registry.update(shellsAsked(AGENT.id), (asked) => asked + 1);
  });
  await tab.render(true);
  assert.equal(tab.bar(), "Sandbox stopped.");
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 1);
  assert.ok(!tab.kinds().includes("terminal.create"));
  await act(async () => tab.action()?.click());
  await settle();
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 0);
  assert.equal(tab.kinds().filter((kind) => kind === "terminal.create").length, 1);
});

/** Types into the find bar's field as the keyboard does, which React hears as an input. */
function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>(
    'search.find-bar input[aria-label="Find"]',
  );
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the find bar's tally says. */
function findTally(): string | null | undefined {
  return document.querySelector(".find-bar-tally")?.textContent;
}

test("⌘F finds in the shell's scrollback, which the terminal draws on a canvas, from the newest match up, every match counted and stepped through", async () => {
  vi.useFakeTimers();
  const tab = await mount(true, true, undefined, true);
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  port.say({ type: "output", data: bytes("alpha beta\r\nalpha gamma\r\n") });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("alpha");
  await act(async () => vi.advanceTimersByTimeAsync(100));
  assert.equal(findTally(), "2 of 2");
  act(() => {
    runAppCommand(APP_COMMAND.FIND_NEXT);
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  assert.equal(findTally(), "1 of 2");
  act(() => {
    runAppCommand(APP_COMMAND.FIND_PREVIOUS);
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  assert.equal(findTally(), "2 of 2");
  // What the find draws over the matches stands inside the tab, which the recording leaves out whole.
  for (const drawn of tab.container.querySelectorAll('[class*="xterm-decoration"]')) {
    assert.ok(drawn.closest(".ph-no-capture"));
  }
  typeFind("delta");
  await act(async () => vi.advanceTimersByTimeAsync(100));
  assert.equal(findTally(), "No results");
});

test("a find with more matches than it counts says there are more", async () => {
  vi.useFakeTimers();
  await mount(true, true, undefined, true);
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  port.say({ type: "output", data: bytes("hit\r\n".repeat(1_100)) });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("hit");
  await act(async () => vi.advanceTimersByTimeAsync(100));
  assert.match(findTally() ?? "", /1000\+/);
});

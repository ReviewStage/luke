// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ORPCError } from "@orpc/client";
import { MOTION_DURATION_MS } from "@repo/brand";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import {
  TERMINAL_PORT_CHANNEL,
  TERMINAL_REFUSAL,
  type TerminalPortInbound,
  type TerminalPortOutbound,
  type TerminalRefusal,
} from "@repo/features/terminal-acts";
import { shellsAsked } from "@repo/features/terminal-store";
import { SANDBOX_STATE, type TerminalsAnswer } from "@repo/features/terminal-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  ACT_ERROR,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  type TERMINAL_ACT_KIND,
} from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { timeRuntime } from "@repo/ui";
import type { UnparsedWireValue } from "@repo/wire";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { SIDE_BUNDLES, type SideBundles, sideBundles } from "../bundle-loader.js";
import { FindScope } from "../find-in-tab.js";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { type AnyAct, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { longPress, underAFinger } from "../testing/finger.js";
import { onPhone } from "../testing/phone-tab.js";
import { bundleLanded, fittedTerminalBundles, onSideBundles } from "../testing/side-bundles.js";
import { agentsControl } from "../testing/tasks-control.js";
import { TerminalCardFoot, TerminalStanding } from "./terminal-shells.js";
import { TerminalTab } from "./terminal-tab.js";
import { OpenLinkProvider } from "./use-open-link.js";

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

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK,
  model: "openai/gpt-5.6-sol",
  effort: "high",
  title: "Invite flow",
  createdAt: 1,
  status: AGENT_STATUS.RUNNING,
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

type TerminalKind = (typeof TERMINAL_ACT_KIND)[keyof typeof TERMINAL_ACT_KIND];

/** One Terminal tab act as it rides the act port: its kind, and the payload the kind takes. */
type TerminalAct = {
  [Kind in TerminalKind]: { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[TerminalKind];

/** Any act the tab sends on its act port. */
type SentAct = AnyAct | TerminalAct;

/** What main answers and posts, as the test stages it. */
interface Main {
  /** Every act the tab sent, by kind and payload, in order. */
  readonly sent: SentAct[];
  /** The sandbox's list as `terminal.list` answers it, which a test may change. */
  listed: TerminalsAnswer;
  /** The kinds main refuses outright, as it does when the service cannot be reached. */
  readonly down: Set<PortActKind | TerminalKind>;
  /** What `terminal.create` answers in place of a shell, where the sandbox refuses one. */
  createRefused: TerminalRefusal | undefined;
  /** What `terminal.list` answers in place of the list, where the service refuses it. */
  listRefused: TerminalRefusal | undefined;
  /** What `terminal.resume` answers in place of the sandbox, where the service refuses it. */
  resumeRefused: TerminalRefusal | undefined;
  /** The answers held back, in the order asked, each landing when the test lets it go. */
  readonly held: (() => void)[];
  /** The kinds whose answers are held back until the test lets them go. */
  readonly holding: Set<PortActKind | TerminalKind>;
  /** Posts a shell's port to the tab, as main does after an attach, answering the host's half. */
  readonly post: (terminalId: string) => HostPort;
}

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

// The terminal bundle landed before any tab is drawn, as it is once a terminal has been shown in this window.
let FITTED: SideBundles;
beforeAll(async () => {
  FITTED = await Effect.runPromise(fittedTerminalBundles());
});
let main: Main;

beforeEach(() => {
  const sent: SentAct[] = [];
  const answer = (request: TerminalAct): PortActResult<TerminalKind> => {
    switch (request.kind) {
      case ACT_KIND.TERMINAL_LIST:
        return main.listRefused === undefined ? main.listed : { refused: main.listRefused };
      case ACT_KIND.TERMINAL_CREATE: {
        if (main.createRefused !== undefined) return { refused: main.createRefused };
        // Note that each shell made has an id of its own, as the service mints one per shell, the first of them MADE.
        const made = shell(
          main.listed.terminals.some((each) => each.id === MADE) ? crypto.randomUUID() : MADE,
          "zsh",
        );
        main.listed = { ...main.listed, terminals: [...main.listed.terminals, made] };
        return { terminal: made };
      }
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
        if (main.resumeRefused !== undefined) return { refused: main.resumeRefused };
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
    resumeRefused: undefined,
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
  /** A Terminal tab act answered as main's procedure would: refused, held back, or answered now. */
  const respond = (request: TerminalAct): Promise<PortActResult<TerminalKind>> => {
    sent.push(request);
    if (main.down.has(request.kind)) {
      return Promise.reject(
        new ORPCError(ACT_ERROR.REFUSED, { message: "Could not reach this agent's sandbox." }),
      );
    }
    // A held answer says what main said when it was asked, landing whenever it is let go.
    if (main.holding.has(request.kind)) {
      const value = answer(request);
      return new Promise((resolve) => main.held.push(() => resolve(value)));
    }
    return Promise.resolve(answer(request));
  };
  fakeAppBridge({});
  // SAFETY: each procedure answers its own kind, whose answer `answer` gives by the same kind; the casts are the one dispatch on it.
  fakeActPort({
    [ACT_KIND.TERMINAL_LIST]: (payload) =>
      respond({ kind: ACT_KIND.TERMINAL_LIST, payload }) as Promise<
        PortActResult<typeof ACT_KIND.TERMINAL_LIST>
      >,
    [ACT_KIND.TERMINAL_CREATE]: (payload) =>
      respond({ kind: ACT_KIND.TERMINAL_CREATE, payload }) as Promise<
        PortActResult<typeof ACT_KIND.TERMINAL_CREATE>
      >,
    [ACT_KIND.TERMINAL_RENAME]: (payload) =>
      respond({ kind: ACT_KIND.TERMINAL_RENAME, payload }) as Promise<
        PortActResult<typeof ACT_KIND.TERMINAL_RENAME>
      >,
    [ACT_KIND.TERMINAL_KILL]: (payload) =>
      respond({ kind: ACT_KIND.TERMINAL_KILL, payload }) as Promise<
        PortActResult<typeof ACT_KIND.TERMINAL_KILL>
      >,
    [ACT_KIND.TERMINAL_RESUME]: (payload) =>
      respond({ kind: ACT_KIND.TERMINAL_RESUME, payload }) as Promise<
        PortActResult<typeof ACT_KIND.TERMINAL_RESUME>
      >,
    [ACT_KIND.TERMINAL_ATTACH]: (payload) =>
      respond({ kind: ACT_KIND.TERMINAL_ATTACH, payload }) as Promise<
        PortActResult<typeof ACT_KIND.TERMINAL_ATTACH>
      >,
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
  // Each registry lets its terminals go, as a window's does as it closes.
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.body.style.removeProperty("--ui-duration-pane");
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
  /** The bundles the tab reads its terminal from; the window's own, landed, unless a test hands others. */
  bundles: SideBundles = FITTED,
  /** Whether the tab is drawn as a phone's panel draws it, what it hands the task's header's ⋯ held. */
  phone = false,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = agentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  // Note that the window's ticks never start here, because the working agent's mark steps on one
  // forever, and a test that runs every fake timer out would never finish.
  const registry = AtomRegistry.make({ initialValues: [[timeRuntime, AsyncResult.initial()]] });
  registries.push(registry);
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
  let agentOpened = 0;
  let handed = onPhone(null).handed;
  const render = (on: boolean) => {
    const tab = createElement(TerminalTab, {
      agentId: AGENT.id,
      agents,
      shown: on,
      onOpenAgent: () => {
        agentOpened += 1;
      },
      onClose: () => {
        closed += 1;
      },
      shells: {
        open: shellsOpen,
        onToggle: () => {
          toggled += 1;
        },
      },
    });
    const drawn = onPhone(tab);
    handed = drawn.handed;
    act(() =>
      root.render(
        onRegistry(registry, onSideBundles(bundles, wrapped(phone ? drawn.element : tab))),
      ),
    );
  };
  render(shown);
  await settle();
  const keyboard = () => {
    const field = container.querySelector("textarea");
    assert.ok(field, "the screen takes the keyboard");
    return field;
  };
  return {
    container,
    /** What the tab handed the task's header's ⋯, drawn on a phone. */
    handed: () => handed,
    /** How many times the tab asked to open its agent. */
    agentOpened: () => agentOpened,
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
      [...container.querySelectorAll('[aria-label="Shell list"] > li')].map((row) => ({
        name: row.querySelector(".ui-list-row-title")?.textContent,
        detail: row.querySelector(".terminal-shell-detail")?.textContent,
        shown: row.querySelector('[aria-current="true"]') !== null,
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
      const row = [
        ...container.querySelectorAll<HTMLButtonElement>('[aria-label="Shell list"] > li > button'),
      ].find((each) => each.querySelector(".ui-list-row-title")?.textContent === name);
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
    action: () => container.querySelector<HTMLButtonElement>(".terminal-bar-end button"),
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
  assert.ok(tab.container.querySelector(".ui-pane-bar")?.closest(".ph-no-capture"));
});

test("shown, the tab lists the agent's shells and attaches to the oldest; hidden and shown again, it keeps its port and attaches nothing more", async () => {
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
  await tab.render(true);
  assert.equal(port.closed(), false);
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

test("a resume whose snapshot is gone says the sandbox shut down and how to start a fresh one", async () => {
  main.listed = { sandbox: SANDBOX_STATE.STOPPED, terminals: [] };
  main.resumeRefused = TERMINAL_REFUSAL.SANDBOX_SNAPSHOT_GONE;
  const tab = await mount();
  await act(async () => tab.action()?.click());
  await settle();
  assert.equal(
    tab.bar(),
    "This sandbox shut down after being idle. Send the agent a message to start a fresh one.",
  );
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

/** Ends the bar's reveal, as the browser does once its delay has run; a DOM without animation events is heard through React's webkit-prefixed name for it. */
function revealBar(): void {
  act(() => {
    for (const name of ["animationend", "webkitAnimationEnd"]) {
      document.querySelector(".terminal-bar")?.dispatchEvent(new Event(name, { bubbles: true }));
    }
  });
}

test("a dropped connection shows its bar, and its action asks for the shell again at once", async () => {
  mountAnnouncer();
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "reconnecting" });
  assert.equal(tab.bar(), "Connection lost. Reconnecting…");
  assert.equal(announcedPolitely(), "", "a bar still hidden says nothing, so a blip is never said");
  revealBar();
  assert.equal(announcedPolitely(), "Connection lost. Reconnecting…", "it is said once shown");

  // A later drop hides its bar again, so its words wait for that reveal too.
  port.say({ type: "state", state: "starting" });
  assert.equal(announcedPolitely(), "Waiting for the agent to open its sandbox…");
  port.say({ type: "state", state: "reconnecting" });
  assert.equal(
    announcedPolitely(),
    "",
    "the second bar is hidden, so it says nothing yet, and the bar it replaced took its words back",
  );
  revealBar();
  assert.equal(announcedPolitely(), "Connection lost. Reconnecting…");
  const before = main.sent.length;
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.attach"]);
});

test("after five idle minutes the bar says so, and any key reconnects to the same shell", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "idle" });
  assert.equal(tab.standing(), "· sandbox · disconnected");
  assert.equal(tab.bar(), "Disconnected after 5 min without typing. Press any key to reconnect.");
  const before = main.sent.length;
  await tab.type("q", 81);
  assert.deepEqual(tab.kinds(before), ["terminal.attach"]);
  const attach = lastAttach();
  assert.ok(attach instanceof Object && "terminalId" in attach);
  assert.equal(attach.terminalId, OLDEST);
  // The key reconnected; it never reached the shell.
  assert.deepEqual(
    port.posted.filter((message) => message.type === "input"),
    [],
  );
});

test("a shell that ended takes any key for a new one", async () => {
  main.listed = { sandbox: SANDBOX_STATE.RUNNING, terminals: [shell(OLDEST, "zsh")] };
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "exited", code: 0 });
  assert.equal(tab.standing(), "· sandbox · exited");
  assert.equal(tab.bar(), "Process exited with code 0. Press any key for a new shell.");
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
  mountAnnouncer();
  const tab = await mount();
  assert.equal(tab.standing(), "· sandbox · unreachable");
  assert.equal(tab.bar(), "The service did not answer.");
  assert.equal(announcedPolitely(), "The service did not answer.", "the bar is said as it lands");
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
  const acks = () => port.posted.filter((message) => message.type === "ack");
  port.say({ type: "output", data: bytes("x".repeat(4_000)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(acks(), []);
  port.say({ type: "output", data: bytes("y".repeat(1_500)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(acks(), [{ type: "ack", bytes: 5_500 }]);
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

test("a terminal bundle that fails to load leaves the tab saying so with Retry, which imports it again and draws the screen", async () => {
  const landed = await Effect.runPromise(bundleLanded(SIDE_BUNDLES.terminal));
  let online = false;
  const unloaded = sideBundles({
    terminal: () =>
      online
        ? Promise.resolve(landed)
        : Promise.reject(new Error("The chunk could not be loaded.")),
  });
  const tab = await mount(true, true, undefined, false, unloaded);
  await settle();
  assert.equal(
    tab.container.querySelector(".terminal-tab-host [role=alert]")?.textContent,
    "The terminal could not be shown.Retry",
  );
  assert.equal(tab.container.querySelector(".terminal-tab-screen"), null);
  assert.deepEqual(tab.kinds(), []);

  online = true;
  const retry = [...tab.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  assert.ok(retry, "the failure offers Retry");
  await act(async () => retry.click());
  await settle();

  assert.equal(tab.container.querySelector(".terminal-tab-host [role=alert]"), null);
  assert.ok(tab.container.querySelector(".terminal-tab-screen"));
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
  assert.equal(tab.bar(), "Could not find this agent’s shell.");
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

test("what is typed before the shell's port opens reaches it once it does, after the screen's size", async () => {
  const tab = await mount();
  await tab.type("l", 76);
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "connecting" });
  await tab.type("s", 83);
  assert.deepEqual(port.posted, [
    { type: "resize", cols: 80, rows: 24 },
    { type: "input", data: "l" },
    { type: "input", data: "s" },
  ]);
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

/** The payload of the last act of the kind the tab sent, as main received it. */
function lastPayload(kind: PortActKind | TerminalKind) {
  const request = main.sent.findLast((each) => each.kind === kind);
  assert.ok(request, `the tab sent ${kind}`);
  return "payload" in request ? request.payload : undefined;
}

/** What the shells list says to a reader in place of its rows: the reading region's words, or the failure's. */
function shellsSaid(container: HTMLElement) {
  const list = container.querySelector("aside[aria-label='Shells']");
  assert.ok(list, "the shells list stands");
  return {
    reading: list.querySelector("[role=status]")?.textContent,
    failed: list.querySelector("[role=alert]")?.textContent,
  };
}

test("while the shells are first read, the list stands rows of blocks that say so, and the shells land in their place", async () => {
  main.holding.add(ACT_KIND.TERMINAL_LIST);
  const tab = await mount();
  assert.deepEqual(shellsSaid(tab.container), {
    reading: "Reading the shells…",
    failed: undefined,
  });
  assert.doesNotMatch(tab.container.textContent ?? "", /No shells\./u);

  main.holding.clear();
  for (const release of main.held.splice(0)) release();
  await settle();
  assert.deepEqual(shellsSaid(tab.container), { reading: undefined, failed: undefined });
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["zsh", "dev server"],
  );
});

test("a read of the shells the service refused says so in the list, beside the bar's Retry", async () => {
  main.down.add(ACT_KIND.TERMINAL_LIST);
  const tab = await mount();
  assert.deepEqual(shellsSaid(tab.container), {
    reading: undefined,
    failed: "The shells could not be read.",
  });

  main.down.clear();
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(shellsSaid(tab.container), { reading: undefined, failed: undefined });
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["zsh", "dev server"],
  );
});

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
  await tab.press("End shell");
  assert.equal(document.querySelector('[role="alertdialog"] h2')?.textContent, "End zsh?");
  assert.match(
    document.querySelector('[role="alertdialog"]')?.textContent ?? "",
    /Whatever is running in it stops.*This cannot be undone\./u,
    "the question says what goes",
  );
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
  const row = tab.container.querySelector<HTMLButtonElement>(
    '[aria-label="Shell list"] > li > button',
  );
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

/** Opens the oldest shell's name field from its row's menu and ends it on `name`, as Return does. */
async function renameOldest(container: HTMLElement, name: string): Promise<void> {
  const row = container.querySelector<HTMLButtonElement>('[aria-label="Shell list"] > li > button');
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  const rename = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Rename",
  );
  await act(async () => rename?.click());
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Shell name"]');
  assert.ok(field, "the name is edited in place");
  act(() => {
    field.value = name;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

test("a shell's new name is drawn at once, before the service answers the rename", async () => {
  const tab = await mount();
  main.holding.add(ACT_KIND.TERMINAL_RENAME);
  await renameOldest(tab.container, "server");
  assert.equal(main.held.length, 1, "the rename is still out");
  assert.equal(tab.rows()[0]?.name, "server");

  for (const release of main.held.splice(0)) release();
  await settle();
  assert.equal(tab.rows()[0]?.name, "server");
});

test("a refused shell rename reopens its field holding the name typed, says under it that the shell was not renamed, and Escape leaves the old name", async () => {
  const tab = await mount();
  main.down.add(ACT_KIND.TERMINAL_RENAME);
  await renameOldest(tab.container, "server");

  const reopened = tab.container.querySelector<HTMLInputElement>('input[aria-label="Shell name"]');
  assert.equal(reopened?.value, "server");
  assert.ok(tab.container.textContent?.includes("The shell could not be renamed. Try again."));

  act(() => {
    reopened?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  // Note that the refusal is let go of as its mutation resets, which reaches React a tick later.
  await vi.waitFor(() => assert.equal(tab.rows()[0]?.name, "zsh"));
  assert.ok(!tab.container.textContent?.includes("could not be renamed"));
});

test("a shell row's ⋯, its right-click and the menu key open the same menu of Rename and End shell", async () => {
  const tab = await mount();
  const item = tab.container.querySelector<HTMLElement>('[aria-label="Shell list"] > li');
  const row = item?.querySelector<HTMLButtonElement>(":scope > button, :scope button");
  const more = item?.querySelector<HTMLButtonElement>('button[aria-label="Shell actions"]');
  assert.ok(row && more, "the row stands with its ⋯");
  const offered = () => {
    const menu = document.querySelector('[role="menu"]:not([data-leaving])');
    return {
      label: menu?.getAttribute("aria-label"),
      items: [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map(
        (each) => each.textContent,
      ),
    };
  };
  const closeMenu = async () => {
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await settle();
  };
  const SAME = { label: "Shell actions", items: ["Rename", "End shell"] };

  act(() => more.click());
  assert.deepEqual(offered(), SAME, "the ⋯ opens it");
  await closeMenu();

  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(offered(), SAME, "a right-click opens it");
  await closeMenu();

  act(() => {
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
    );
  });
  assert.deepEqual(offered(), SAME, "the menu key opens it");
});

test("under a finger, a shell row draws its × but no ⋯, and held it opens its menu", async () => {
  underAFinger();
  // Note that the screen listens on a media query by its old door, which a finger's stub leaves out.
  const finger = vi.mocked(window.matchMedia);
  const answer = finger.getMockImplementation() ?? assert.fail("a finger answers the window");
  finger.mockImplementation((query) =>
    Object.assign(answer(query), { addListener: () => undefined, removeListener: () => undefined }),
  );
  const tab = await mount();
  const item = tab.container.querySelector<HTMLElement>('[aria-label="Shell list"] > li');
  const row = item?.querySelector<HTMLButtonElement>(":scope > button, :scope button");
  assert.ok(row, "the row stands");
  assert.ok(item?.querySelector('button[aria-label="Shell actions"]') === null, "no ⋯");
  assert.ok(item?.querySelector('button[aria-label="End shell"]'), "the × stands");

  longPress(row);
  const menu = document.querySelector('[role="menu"]:not([data-leaving])');
  assert.equal(menu?.getAttribute("aria-label"), "Shell actions");
});

test("the shells list folds away beside the screen, and its toggle asks the panel to bring it back", async () => {
  const tab = await mount(true, false);
  assert.equal(tab.container.querySelector(".terminal-shells"), null);
  await tab.press("Show shells");
  assert.equal(tab.toggled(), 1);
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

test("a terminal's row in the panel's + says how the sandbox stands, leaving whether the agent works to its glyph", async () => {
  const tab = await mount();
  const standing = renderToStaticMarkup(
    onRegistry(tab.registry, createElement(TerminalStanding, { agent: AGENT })),
  );
  assert.equal(standing, "2 shells");
});

test("the list's foot names the agent, its glyph saying it works with no word repeating it", async () => {
  const tab = await mount();
  const foot = tab.container.querySelector(".terminal-shells-foot");
  assert.equal(foot?.textContent, "Invite flow");
  assert.ok(foot?.querySelector('[role="img"][aria-label="Working"]'));
});

test("a sandbox that stops under a connected shell is read again, and the list says it holds no shells", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  main.listed = { sandbox: SANDBOX_STATE.STOPPED, terminals: [] };
  port.say({ type: "state", state: "stopped" });
  await settle();
  assert.equal(tab.container.querySelector(".ui-note-line")?.textContent, "No shells.");
  assert.equal(
    tab.container.querySelector(".terminal-shells-foot")?.textContent,
    "Sandbox stopped",
  );
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
  const row = tab.container.querySelector<HTMLButtonElement>(
    '[aria-label="Shell list"] > li > button',
  );
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
  await tab.press("End shell");
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

test("an end the service refuses leaves the shown shell shown on its port, and the question saying why", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  main.down.add(ACT_KIND.TERMINAL_KILL);
  const before = main.sent.length;
  await tab.press("End shell");
  await confirmWith("End shell");
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.kill"]);
  assert.equal(port.closed(), false);
  assert.equal(tab.standing(), "· sandbox · connected");
  assert.match(
    document.querySelector('[role="alertdialog"]')?.textContent ?? "",
    /Could not end that shell\./,
  );
});

test("an end still out when another shell is chosen leaves the chosen one shown", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  main.holding.add(ACT_KIND.TERMINAL_KILL);
  await tab.press("End shell");
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
  await tab.press("End shell");
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
  // Note that the relist is a read sent beside the attach's mutation, so the two reach the port in either order.
  await vi.waitFor(() =>
    assert.deepEqual([...tab.kinds(before)].sort(), [
      "terminal.attach",
      "terminal.create",
      "terminal.list",
    ]),
  );
  assert.equal(tab.kinds(before)[0], "terminal.create");
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
  assert.deepEqual(tab.kinds(before), ["terminal.create", "terminal.list", "terminal.attach"]);
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 0);
});

test("a new shell asked for while the sandbox is stopped waits for its Resume, and is not lost", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  port.say({ type: "state", state: "stopped" });
  act(() => {
    tab.registry.update(shellsAsked(AGENT.id), (asked) => asked + 1);
  });
  await settle();
  assert.equal(tab.bar(), "Sandbox stopped.");
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 1);
  assert.ok(!tab.kinds().includes("terminal.create"));
  await act(async () => tab.action()?.click());
  await settle();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await settle();
  assert.equal(tab.registry.get(shellsAsked(AGENT.id)), 0);
  assert.equal(tab.kinds().filter((kind) => kind === "terminal.create").length, 1);
});

/** Types into the find bar's field as the keyboard does, which React hears as an input. */
function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the find bar's tally says. */
function findTally(): string | null | undefined {
  return document.querySelector('[role="search"][aria-label="Find"] .ui-search-field-tally')
    ?.textContent;
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

/** The shells list over the screen, as it floats where the panel has no room for it beside. */
function floatedShells(tab: { container: HTMLElement }): HTMLElement | null {
  return tab.container.querySelector<HTMLElement>('[aria-label="Shells"]');
}

/** The toggle that floats the shells, which the stylesheet draws in a narrow panel alone. */
function shellsToggle(tab: { container: HTMLElement }): HTMLButtonElement {
  const toggle = tab.container.querySelector<HTMLButtonElement>(
    '.file-tree-toggle[data-place="over"] button',
  );
  assert.ok(toggle, "the toggle that floats the shells is drawn");
  return toggle;
}

/** A panel too narrow for the shells beside the screen, the list closed. */
async function narrowTab() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.body.style.setProperty("--ui-duration-pane", `${MOTION_DURATION_MS.PANE}ms`);
  // Only the sheet that draws the toggles, since each style read weighs every rule laid.
  layContainersAt({ "side-panel": 400 }, { only: ["./tasks.css"] });
  return mount(true, false);
}

test("in a narrow panel the shells open over the screen", async () => {
  const tab = await narrowTab();
  assert.equal(floatedShells(tab), null, "the shells are away until their toggle is pressed");

  await act(async () => shellsToggle(tab).click());
  const opened = floatedShells(tab);
  assert.equal(opened?.getAttribute("data-state"), "open");
  assert.equal(tab.toggled(), 0, "the panel's own place for the list is left as it was");
});

test("shells floated over the screen stay drawn through their exit, then are let go", async () => {
  const tab = await narrowTab();
  await act(async () => shellsToggle(tab).click());
  assert.equal(floatedShells(tab)?.getAttribute("data-state"), "open");

  await act(async () => shellsToggle(tab).click());
  assert.equal(floatedShells(tab)?.getAttribute("data-state"), "leaving");
  act(() => vi.advanceTimersByTime(MOTION_DURATION_MS.PANE - 1));
  assert.notEqual(floatedShells(tab), null, "the exit has not finished");
  act(() => vi.advanceTimersByTime(1));
  assert.equal(floatedShells(tab), null, "the list is let go once its exit has played");
});

test("Escape in the shells floated over the screen puts them away and gives the keyboard back to their toggle", async () => {
  const tab = await narrowTab();
  act(() => shellsToggle(tab).focus());
  await act(async () => shellsToggle(tab).click());
  const shells = floatedShells(tab);
  assert.ok(shells);
  assert.equal(document.activeElement, shells, "the list takes the keyboard as it opens");

  act(() => {
    shells.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(floatedShells(tab)?.getAttribute("data-state"), "leaving");
  assert.equal(document.activeElement, shellsToggle(tab));
});

test("a shell chosen in the list floated over the screen takes the list down", async () => {
  const tab = await narrowTab();
  await act(async () => shellsToggle(tab).click());
  await tab.choose("dev server");
  assert.equal(floatedShells(tab)?.getAttribute("data-state"), "leaving");
});

test("on a phone the tab draws no bar over the screen, and the task's header's ⋯ shows the shells over it and opens the agent, saying where the sandbox stands", async () => {
  const tab = await mount(true, false, undefined, false, FITTED, true);

  assert.equal(tab.container.querySelector(".file-view-bar"), null);
  assert.deepEqual(tab.handed().labels(), ["Show shells", "Open agent"]);
  assert.match(tab.handed().item("Show shells").detail ?? "", /^Sandbox · /u);

  tab.handed().press("Open agent");
  assert.equal(tab.agentOpened(), 1);

  tab.handed().press("Show shells");
  await settle();
  assert.equal(tab.toggled(), 0, "the shells float over the screen, the panel's choice untouched");
  assert.deepEqual(tab.handed().labels(), ["Hide shells", "Open agent"]);
});

test("the window handing the tab a new link opener keeps the shell's scrollback and its connection", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = agentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  const registry = AtomRegistry.make();
  const tab = createElement(TerminalTab, {
    agentId: AGENT.id,
    agents,
    shown: true,
    onOpenAgent: () => undefined,
    onClose: () => undefined,
    shells: { open: true, onToggle: () => undefined },
  });
  // The window's opener is a new closure whenever what it reads changes, as the window draws it.
  const draw = () =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          onSideBundles(
            FITTED,
            createElement(FindScope, {
              active: true,
              subject: { task: TASK, tab: { terminal: AGENT.id } },
              children: createElement(OpenLinkProvider, { value: () => undefined }, tab),
            }),
          ),
        ),
      ),
    );
  draw();
  await settle();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  port.say({ type: "output", data: bytes("pnpm test\r\n") });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  const asked = main.sent.length;

  draw();
  await settle();

  assert.deepEqual(
    main.sent.slice(asked).map((request) => request.kind),
    [],
  );
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("pnpm");
  await act(async () => vi.advanceTimersByTimeAsync(100));
  assert.equal(findTally(), "1 of 1");
});

test("on a phone a connecting terminal says so in a bar over its screen, and a connected one draws no bar", async () => {
  const tab = await mount(true, false, undefined, false, FITTED, true);
  assert.equal(tab.bar(), "Connecting…");

  main.post(OLDEST).say({ type: "state", state: "attached" });
  assert.equal(tab.bar(), undefined);
});

test("in a wide room a connecting terminal draws no bar, the title bar saying so", async () => {
  const tab = await mount();
  assert.equal(tab.standing(), "· sandbox · connecting…");
  assert.equal(tab.bar(), undefined);
});

test("on a phone a drop after connecting waits out its own reveal, as a drop after a connection does", async () => {
  mountAnnouncer();
  const tab = await mount(true, false, undefined, false, FITTED, true);
  revealBar();
  assert.equal(announcedPolitely(), "Connecting…");

  main.post(OLDEST).say({ type: "state", state: "reconnecting" });
  assert.equal(tab.bar(), "Connection lost. Reconnecting…");
  assert.equal(announcedPolitely(), "", "the drop's bar is hidden, so it says nothing yet");
  revealBar();
  assert.equal(announcedPolitely(), "Connection lost. Reconnecting…");
});

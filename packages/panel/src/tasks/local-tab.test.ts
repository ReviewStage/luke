// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ORPCError } from "@orpc/client";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import {
  TERMINAL_PORT_CHANNEL,
  type TerminalPortInbound,
  type TerminalPortOutbound,
} from "@repo/features/terminal-acts";
import { ACT_KIND } from "@repo/host/acts";
import {
  ACT_ERROR,
  type MAC_SHELL_ACT_KIND,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import type { LocalStripTab, ViewedAt } from "@repo/ui/tab-strip-model";
import { localTab } from "@repo/ui/tab-strip-model";
import { STILL_CLOCK, serveEffectsOn } from "@repo/ui/testing/effect-services";
import type { UnparsedWireValue } from "@repo/wire";
import { Clock, Context, Effect } from "effect";
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
import { onRegistry } from "../testing/copy-feedback.js";
import { onPhone } from "../testing/phone-tab.js";
import { bundleLanded, fittedTerminalBundles, onSideBundles } from "../testing/side-bundles.js";
import { agentsControl } from "../testing/tasks-control.js";
import type { HeldShell } from "./terminal-held.js";
import { TERMINAL_KIND } from "./terminal-session.js";
import { TerminalCount, TerminalTab } from "./terminal-tab.js";
import { OpenLinkProvider } from "./use-open-link.js";
import type { SidePanelTab } from "./use-side-panel.js";
import { useEndTerminalTab, useOpenTerminalTab } from "./use-terminal-session.js";

/**
 * A cloud agent's Local tab as the developer meets it: one terminal on
 * this Mac in the agent's mirror, its shell found or opened and attached
 * only while the tab is shown, under a bar naming the agent and where the connection
 * stands, with each state said the way a terminal says it. Main is the
 * process boundary: its act channel answers from the shells it holds, and a
 * shell's port is handed into the page as the preload hands it, the test
 * speaking for main on it. What the window kept across a reload is its
 * session storage, which each test stages. The screen is the real terminal
 * bundle.
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

const MADE = "5b3e7c9d-1f4a-4d8b-8c3e-5a7b9c1d3f42";

/** The agent's mirror on this Mac, as main answers it. */
const FOLDER = "/Users/someone/.vespin/mirrors/8c1a6a4f/luke";

/** The ids the window minted its terminals under, the tab drawn showing the first unless a test draws another. */
const FIRST = "6c4f8d0e-2a5b-4e9c-9d4f-6b8c0d2e4a53";
const SECOND = "7d5a9e1f-3b6c-4f0d-8e5a-7c9d1e3f5b64";

/** The terminals the window holds for the agent unless a test keeps others, oldest first. */
const HELD: readonly HeldShell[] = [
  { shell: FIRST, title: "Local 1" },
  { shell: SECOND, title: "Local 2" },
];

/** The agent's terminals as the window keeps them in its session storage. */
function kept(): readonly HeldShell[] {
  const all: { local?: Record<string, readonly HeldShell[]> } = JSON.parse(
    window.sessionStorage.getItem("vespin.terminals") ?? "{}",
  );
  return all.local?.[AGENT.id] ?? [];
}

/** Keeps the window's terminals for the agent, as a page before a reload left them in session storage. */
function keep(shells: readonly HeldShell[]): void {
  window.sessionStorage.setItem(
    "vespin.terminals",
    JSON.stringify({ cloud: {}, local: shells.length === 0 ? {} : { [AGENT.id]: shells } }),
  );
}

/** A shell's port as the test holds it: what the tab posted on it, whether the tab closed it, and main's voice on it. */
interface HostPort {
  readonly posted: TerminalPortInbound[];
  readonly closed: () => boolean;
  /** A message main sends, or one no message of main's, which the tab must ignore. */
  readonly say: (message: TerminalPortOutbound | UnparsedWireValue) => void;
}

type ShellKind = (typeof MAC_SHELL_ACT_KIND)[keyof typeof MAC_SHELL_ACT_KIND];

/** One Mac shell act as it rides the act port: its kind, and the payload the kind takes. */
type ShellAct = {
  [Kind in ShellKind]: { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[ShellKind];

/** Any act the tab sends on its act port. */
type SentAct = AnyAct | ShellAct;

/** What main answers and posts, as the test stages it. */
interface Main {
  /** Every act the tab sent, by kind and payload, in order. */
  readonly sent: SentAct[];
  /** The shells main holds for this window, which an attach to any other is refused for. */
  readonly shells: Set<string>;
  /** The kinds main refuses outright. */
  readonly down: Set<PortActKind | ShellKind>;
  /** The answers held back, in the order asked, each landing when the test lets it go. */
  readonly held: (() => void)[];
  /** The kinds whose answers are held back until the test lets them go. */
  readonly holding: Set<PortActKind | ShellKind>;
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
  keep(HELD);
  const sent: SentAct[] = [];
  const shells = new Set<string>();
  /** Whether main refuses the act: a kind it is down for, or an attach or close of a shell it does not hold. */
  const refused = (request: ShellAct) =>
    main.down.has(request.kind) ||
    (request.kind === ACT_KIND.MAC_SHELL_ATTACH && !main.shells.has(request.payload.terminalId));
  const answer = (request: ShellAct): PortActResult<ShellKind> => {
    switch (request.kind) {
      case ACT_KIND.MAC_SHELL_MIRROR:
        return { folder: FOLDER };
      case ACT_KIND.MAC_SHELL_OPEN: {
        // Note that each shell opened has an id of its own, as main mints one per shell, the first of them MADE.
        const terminalId = main.shells.has(MADE) ? crypto.randomUUID() : MADE;
        main.shells.add(terminalId);
        return { terminalId };
      }
      case ACT_KIND.MAC_SHELL_CLOSE:
        main.shells.delete(request.payload.terminalId);
        return undefined;
      default:
        return undefined;
    }
  };
  main = {
    sent,
    shells,
    down: new Set(),
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
        // Main's message, delivered to the tab's own handler as the port would.
        say: (message) =>
          act(() => port.onmessage?.(new MessageEvent("message", { data: message }))),
      };
    },
  };
  /** A Mac shell act answered as main's procedure would: refused, held back, or answered now. */
  const respond = (request: ShellAct): Promise<PortActResult<ShellKind>> => {
    sent.push(request);
    const refusal = () =>
      new ORPCError(ACT_ERROR.REFUSED, { message: "Could not open that shell." });
    // A held answer says what main said when it was asked, or refuses as main would when it is let go.
    if (main.holding.has(request.kind)) {
      const value = answer(request);
      return new Promise((resolve, reject) =>
        main.held.push(() => (refused(request) ? reject(refusal()) : resolve(value))),
      );
    }
    if (refused(request)) return Promise.reject(refusal());
    return Promise.resolve(answer(request));
  };
  fakeAppBridge({});
  // SAFETY: each procedure answers its own kind, whose answer `answer` gives by the same kind; the casts are the one dispatch on it.
  fakeActPort({
    [ACT_KIND.MAC_SHELL_MIRROR]: (payload) =>
      respond({ kind: ACT_KIND.MAC_SHELL_MIRROR, payload }) as Promise<
        PortActResult<typeof ACT_KIND.MAC_SHELL_MIRROR>
      >,
    [ACT_KIND.MAC_SHELL_OPEN]: (payload) =>
      respond({ kind: ACT_KIND.MAC_SHELL_OPEN, payload }) as Promise<
        PortActResult<typeof ACT_KIND.MAC_SHELL_OPEN>
      >,
    [ACT_KIND.MAC_SHELL_ATTACH]: (payload) =>
      respond({ kind: ACT_KIND.MAC_SHELL_ATTACH, payload }) as Promise<
        PortActResult<typeof ACT_KIND.MAC_SHELL_ATTACH>
      >,
    [ACT_KIND.MAC_SHELL_CLOSE]: (payload) =>
      respond({ kind: ACT_KIND.MAC_SHELL_CLOSE, payload }) as Promise<
        PortActResult<typeof ACT_KIND.MAC_SHELL_CLOSE>
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
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/** Lets the act channel's answers, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The tab mounted for one of the agent's terminals, shown or not, with what it draws. */
async function mount(
  shown = true,
  /** Whether the tab stands in a find scope holding the window's keys, as the side panel draws it. */
  findable = false,
  /** The bundles the tab reads its terminal from; the window's own, landed, unless a test hands others. */
  bundles: SideBundles = FITTED,
  /** Whether the tab is drawn as a phone's panel draws it, what it hands the task's header's ⋯ held. */
  phone = false,
  /** The terminal the tab shows, by the id the window minted it under. */
  shell = FIRST,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = agentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  // Note that the working agent's mark never steps here, because it steps on a beat forever, and a
  // test that runs every fake timer out would never finish.
  serveEffectsOn(Context.make(Clock.Clock, STILL_CLOCK));
  const registry = AtomRegistry.make();
  registries.push(registry);
  const wrapped = (tab: React.ReactElement) =>
    findable
      ? createElement(FindScope, {
          active: true,
          subject: { task: TASK, tab: localTab(AGENT.id, shell, "Local 1") },
          children: tab,
        })
      : tab;
  let agentOpened = 0;
  let handed = onPhone(null).handed;
  const render = (on: boolean) => {
    const tab = createElement(TerminalTab, {
      tab: localTab(AGENT.id, shell, "Local 1"),
      agents,
      shown: on,
      onOpenAgent: () => {
        agentOpened += 1;
      },
      onClose: () => undefined,
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
    registry,
    /** Presses the button the label names, wherever it stands in the tab. */
    press: async (label: string) => {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      assert.ok(button, `a button named ${label}`);
      await act(async () => button.click());
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

test("the tab is left out of the screen recording, its screen and bar with it", async () => {
  const tab = await mount();
  const screen = tab.container.querySelector(".terminal-tab-screen");
  assert.ok(screen?.closest(".ph-no-capture"));
  assert.ok(tab.container.querySelector(".ui-pane-bar")?.closest(".ph-no-capture"));
});

test("shown, the tab has its agent's files mirrored and a shell opened in the mirror at the size its screen fits, and attaches to it; hidden and shown again, it keeps its port and asks nothing more", async () => {
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["macShell.mirror", "macShell.open", "macShell.attach"]);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_MIRROR), { agentId: AGENT.id });
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_OPEN), {
    agentId: AGENT.id,
    folder: FOLDER,
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
    agentId: AGENT.id,
    terminalId: MADE,
    cols: 80,
    rows: 24,
  });
  assert.equal(tab.standing(), "· connecting…");
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  assert.equal(tab.standing(), "· connected");
  assert.equal(tab.bar(), undefined);
  await tab.render(false);
  await tab.render(true);
  assert.equal(port.closed(), false);
  assert.deepEqual(tab.kinds(3), []);
});

test("what is typed goes to the shell's port while it is connected", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  await tab.type("l", 76);
  await tab.type("Enter", 13);
  const typed = port.posted.flatMap((message) => (message.type === "input" ? [message.data] : []));
  assert.equal(typed.join(""), "l\r");
});

test("a shell that ended takes any key for a new one in the same tab, and is let go", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "exited", code: 0 });
  assert.equal(tab.standing(), "· exited");
  assert.equal(tab.bar(), "Process exited with code 0. Press any key for a new shell.");
  const before = main.sent.length;
  await tab.type("a", 65);
  assert.deepEqual(tab.kinds(before), [
    "macShell.close",
    "macShell.mirror",
    "macShell.open",
    "macShell.attach",
  ]);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_CLOSE), {
    agentId: AGENT.id,
    terminalId: MADE,
  });
});

test("a mirror main could not make shows a bar that says so, whose action asks again", async () => {
  main.down.add(ACT_KIND.MAC_SHELL_MIRROR);
  mountAnnouncer();
  const tab = await mount();
  assert.equal(tab.standing(), "· unreachable");
  assert.equal(tab.bar(), "Could not mirror this agent’s files on this Mac.");
  assert.equal(
    announcedPolitely(),
    "Could not mirror this agent’s files on this Mac.",
    "the bar is said as it lands",
  );
  main.down.clear();
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(), [
    "macShell.mirror",
    "macShell.mirror",
    "macShell.open",
    "macShell.attach",
  ]);
});

test("the screen says it has drawn each five thousand characters of output, which the host paces the shell by", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  vi.useFakeTimers();
  const acks = () => port.posted.filter((message) => message.type === "ack");
  port.say({ type: "output", data: bytes("x".repeat(4_000)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(acks(), []);
  port.say({ type: "output", data: bytes("y".repeat(1_500)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(acks(), [{ type: "ack", bytes: 5_500 }]);
  assert.equal(tab.standing(), "· connected");
});

test("a message on the port that is no message of main's is never drawn nor acted on", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  port.say({ type: "state", state: "melted" });
  port.say({ type: "output", data: "not bytes" });
  assert.equal(tab.standing(), "· connected");
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
  const tab = await mount(true, false, unloaded);
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

test("a shell main could not open in the mirror says so, and its action asks again", async () => {
  main.down.add(ACT_KIND.MAC_SHELL_OPEN);
  const tab = await mount();
  assert.equal(tab.standing(), "· unreachable");
  assert.equal(tab.bar(), "Could not open a shell in this agent’s files.");
  main.down.clear();
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds().slice(2), ["macShell.mirror", "macShell.open", "macShell.attach"]);
});

test("the bar's action hands the keyboard back to the screen, since its button goes with the bar", async () => {
  main.down.add(ACT_KIND.MAC_SHELL_MIRROR);
  const tab = await mount();
  const retry = tab.action();
  assert.ok(retry);
  retry.focus();
  await act(async () => retry.click());
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
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  await tab.type("s", 83);
  assert.deepEqual(port.posted, [
    { type: "resize", cols: 80, rows: 24 },
    { type: "input", data: "l" },
    { type: "input", data: "s" },
  ]);
});

test("a paste longer than one message is cut between characters, never inside one", async () => {
  const tab = await mount();
  const port = main.post(MADE);
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
function lastPayload(kind: PortActKind | ShellKind) {
  const request = main.sent.findLast((each) => each.kind === kind);
  assert.ok(request, `the tab sent ${kind}`);
  return "payload" in request ? request.payload : undefined;
}

test("a terminal's row in the panel's + counts the agent's Local terminals, leaving whether the agent works to its glyph", async () => {
  const tab = await mount();
  const standing = renderToStaticMarkup(
    onRegistry(
      tab.registry,
      createElement(TerminalCount, { kind: TERMINAL_KIND.LOCAL, agentId: AGENT.id }),
    ),
  );
  assert.equal(standing, "2 terminals");
});

/** The doors that open the agent's Local tabs and end one, over a side panel that writes down each tab it is asked to choose. */
function localDoors(
  open: readonly LocalStripTab[] = [],
  viewedAt: ViewedAt<SidePanelTab>[] = [],
  /** The window's atoms, a tab's own where the doors stand beside one. */
  registry = AtomRegistry.make(),
) {
  const chosen: SidePanelTab[] = [];
  let doors: { open: (agentId: string, fresh: boolean) => void; end: (tab: LocalStripTab) => void };
  const Doors = () => {
    const opened = useOpenTerminalTab(
      TERMINAL_KIND.LOCAL,
      { onChoose: (tab) => chosen.push(tab), terminals: [], locals: open, viewedAt },
      () => undefined,
    );
    doors = { open: opened, end: useEndTerminalTab() };
    return null;
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(Doors))));
  return {
    chosen,
    open: (fresh: boolean) => act(() => doors.open(AGENT.id, fresh)),
    end: async (tab: LocalStripTab) => {
      act(() => doors.end(tab));
      await settle();
    },
  };
}

test("a new terminal asked for from the + or ⌘K opens a tab of its own, named past the agent's terminals, whose shell opens as it is shown", async () => {
  const doors = localDoors();
  doors.open(true);
  const [made] = kept().slice(2);
  assert.ok(made);
  assert.equal(made.title, "Local 3");
  assert.deepEqual(doors.chosen, [localTab(AGENT.id, made.shell, "Local 3")]);
  assert.deepEqual(main.sent, []);
});

test("Show local goes to the agent's Local tab viewed last, and with none open, as after a reload, opens a tab for each terminal the window still holds, the newest last", async () => {
  const first = localTab(AGENT.id, FIRST, "Local 1");
  const second = localTab(AGENT.id, SECOND, "Local 2");
  const open = localDoors(
    [first, second],
    [
      { tab: first, at: 2 },
      { tab: second, at: 1 },
    ],
  );
  open.open(false);
  assert.deepEqual(open.chosen, [first]);

  const reloaded = localDoors();
  reloaded.open(false);
  assert.deepEqual(reloaded.chosen, [first, second]);
  assert.equal(kept().length, 2, "no terminal is opened in their place");
});

test("closing a Local tab ends its terminal: out of the window's list, its port closed, and its shell ended in main", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  const doors = localDoors([], [], tab.registry);
  await doors.end(localTab(AGENT.id, FIRST, "Local 1"));
  assert.deepEqual(
    kept().map((each) => each.shell),
    [SECOND],
  );
  assert.equal(port.closed(), true);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_CLOSE), { agentId: AGENT.id, terminalId: MADE });
});

test("a tab hidden and shown again while its shell opens opens one shell", async () => {
  main.holding.add(ACT_KIND.MAC_SHELL_OPEN);
  const tab = await mount();
  await tab.render(false);
  await tab.render(true);
  assert.deepEqual(
    tab.kinds().filter((kind) => kind === "macShell.open"),
    ["macShell.open"],
  );
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
  const tab = await mount(true, true);
  const port = main.post(MADE);
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
  await mount(true, true);
  const port = main.post(MADE);
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

test("the window handing the tab a new link opener keeps the shell's scrollback and its connection", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = agentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  const registry = AtomRegistry.make();
  const tab = createElement(TerminalTab, {
    tab: localTab(AGENT.id, FIRST, "Local 1"),
    agents,
    shown: true,
    onOpenAgent: () => undefined,
    onClose: () => undefined,
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
              subject: { task: TASK, tab: localTab(AGENT.id, FIRST, "Local 1") },
              children: createElement(OpenLinkProvider, { value: () => undefined }, tab),
            }),
          ),
        ),
      ),
    );
  draw();
  await settle();
  const port = main.post(MADE);
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

test("on a phone the tab draws no bar over the screen, and the task's header's ⋯ opens the agent", async () => {
  const tab = await mount(true, false, FITTED, true);
  assert.equal(tab.container.querySelector(".file-view-bar"), null);
  assert.deepEqual(tab.handed().labels(), ["Open agent"]);
  assert.equal(tab.handed().item("Open agent").detail, "Invite flow");
  tab.handed().press("Open agent");
  assert.equal(tab.agentOpened(), 1);
});

test("on a phone a connecting terminal says so in a bar over its screen, and a connected one draws no bar", async () => {
  const tab = await mount(true, false, FITTED, true);
  assert.equal(tab.bar(), "Connecting…");

  main.post(MADE).say({ type: "state", state: "attached" });
  assert.equal(tab.bar(), undefined);
});

test("in a wide room a connecting terminal draws no bar, the title bar saying so", async () => {
  const tab = await mount();
  assert.equal(tab.standing(), "· connecting…");
  assert.equal(tab.bar(), undefined);
});

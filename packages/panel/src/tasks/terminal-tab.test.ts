// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ORPCError } from "@orpc/client";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import {
  TERMINAL_PORT_CHANNEL,
  TERMINAL_REFUSAL,
  type TerminalPortInbound,
  type TerminalPortOutbound,
  type TerminalRefusal,
} from "@repo/features/terminal-acts";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  ACT_ERROR,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  type TERMINAL_ACT_KIND,
} from "@repo/host/contract";
import type { TerminalStripTab } from "@repo/ui/tab-strip-model";
import { terminalTab } from "@repo/ui/tab-strip-model";
import { STILL_CLOCK, serveEffectsOn } from "@repo/ui/testing/effect-services";
import type { UnparsedWireValue } from "@repo/wire";
import { Clock, Context, Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { type AnyAct, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { fittedTerminalBundles, onSideBundles } from "../testing/side-bundles.js";
import { agentsControl } from "../testing/tasks-control.js";
import { onTerminals, windowTerminals } from "../testing/terminals.js";
import type { HeldShell } from "./terminal-held.js";
import { TerminalTab } from "./terminal-tab.js";
import { useEndTerminalTab } from "./use-terminal-session.js";

/**
 * One of an agent's cloud terminal tabs as the developer meets it: a shell
 * started in the agent's own sandbox once the tab is first shown, under a
 * bar naming the agent and where the connection stands, with each state
 * said the way a terminal says it. Main is the process boundary: its act
 * channel answers from a staged sandbox, and a shell's port is handed into
 * the page as the preload hands it, the test speaking for the host on it.
 * What the window kept across a reload is its session storage, which a test
 * stages. The screen is the real terminal bundle. What every terminal tab
 * does alike, cloud or Local, is `local-tab.test.ts`'s.
 */

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "openai/gpt-5.6-sol",
  effort: "high",
  title: "Invite flow",
  createdAt: 1,
  status: AGENT_STATUS.RUNNING,
  turnId: null,
};

/** The shell the sandbox starts first, and one a reload left running. */
const MADE = "5b3e7c9d-1f4a-4d8b-8c3e-5a7b9c1d3f42";
const RUNNING_ON = "3f1c5a7b-9d2e-4b6f-8a1c-3e5f7a9b1d20";

/** The tab drawn: the id the window minted its terminal under, and its name. */
const TAB: TerminalStripTab = terminalTab(
  AGENT.id,
  "6c4f8d0e-2a5b-4e9c-9d4f-6b8c0d2e4a53",
  "Cloud 1",
);

/** Keeps the window's cloud terminals for the agent, as a page before a reload left them in session storage. */
function keep(shells: readonly HeldShell[]): void {
  window.sessionStorage.setItem(
    "vespin.terminals",
    JSON.stringify({ cloud: { [AGENT.id]: shells }, local: {} }),
  );
}

/** The agent's cloud terminals as the window keeps them in its session storage. */
function kept(): readonly HeldShell[] {
  const all: { cloud?: Record<string, readonly HeldShell[]> } = JSON.parse(
    window.sessionStorage.getItem("vespin.terminals") ?? "{}",
  );
  return all.cloud?.[AGENT.id] ?? [];
}

/** A shell as the sandbox answers it. */
function shell(id: string) {
  return { id, title: "zsh", command: "zsh", cwd: "/vercel/sandbox/luke", running: false };
}

/** A shell's port as the test holds it: what the tab posted on it, whether the tab closed it, and the host's voice on it. */
interface HostPort {
  readonly posted: TerminalPortInbound[];
  readonly closed: () => boolean;
  /** A message main sends, or one no message of main's, which the tab must ignore. */
  readonly say: (message: TerminalPortOutbound | UnparsedWireValue) => void;
}

type TerminalKind = (typeof TERMINAL_ACT_KIND)[keyof typeof TERMINAL_ACT_KIND];

/** One terminal act as it rides the act port: its kind, and the payload the kind takes. */
type TerminalAct = {
  [Kind in TerminalKind]: { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[TerminalKind];

/** Any act the tab sends on its act port. */
type SentAct = AnyAct | TerminalAct;

/** What main answers and posts, as the test stages it. */
interface Main {
  /** Every act the tab sent, by kind and payload, in order. */
  readonly sent: SentAct[];
  /** The kinds main refuses outright, as it does when the service cannot be reached. */
  readonly down: Set<PortActKind | TerminalKind>;
  /** What `terminal.create` answers in place of a shell, where the sandbox refuses one. */
  createRefused: TerminalRefusal | undefined;
  /** What `terminal.resume` answers in place of the sandbox, where the service refuses it. */
  resumeRefused: TerminalRefusal | undefined;
  /** Whether a sandbox the service said it resumed still refuses a shell as stopped. */
  staysStopped: boolean;
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
  keep([{ shell: TAB.shell, title: TAB.title }]);
  const sent: SentAct[] = [];
  let made = 0;
  const answer = (request: TerminalAct): PortActResult<TerminalKind> => {
    switch (request.kind) {
      case ACT_KIND.TERMINAL_CREATE:
        if (main.createRefused !== undefined) return { failure: main.createRefused };
        // Note that each shell made has an id of its own, as the service mints one per shell, the first of them MADE.
        made += 1;
        return { terminal: shell(made === 1 ? MADE : crypto.randomUUID()) };
      case ACT_KIND.TERMINAL_KILL:
        return { sandbox: SANDBOX_STATE.RUNNING, terminals: [] };
      case ACT_KIND.TERMINAL_RESUME:
        if (main.resumeRefused !== undefined) return { failure: main.resumeRefused };
        // A resumed sandbox runs, so a shell is made in it.
        if (!main.staysStopped && main.createRefused === TERMINAL_REFUSAL.SANDBOX_STOPPED) {
          main.createRefused = undefined;
        }
        return { sandbox: SANDBOX_STATE.RUNNING };
      default:
        return undefined;
    }
  };
  main = {
    sent,
    down: new Set(),
    createRefused: undefined,
    resumeRefused: undefined,
    staysStopped: false,
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
  /** A terminal act answered as main's procedure would: refused, or answered now. */
  const respond = (request: TerminalAct): Promise<PortActResult<TerminalKind>> => {
    sent.push(request);
    if (main.down.has(request.kind)) {
      return Promise.reject(
        new ORPCError(ACT_ERROR.REFUSED, { message: "Could not reach this agent's sandbox." }),
      );
    }
    return Promise.resolve(answer(request));
  };
  fakeAppBridge({});
  // SAFETY: each procedure answers its own kind, whose answer `answer` gives by the same kind; the casts are the one dispatch on it.
  fakeActPort({
    [ACT_KIND.TERMINAL_CREATE]: (payload) =>
      respond({ kind: ACT_KIND.TERMINAL_CREATE, payload }) as Promise<
        PortActResult<typeof ACT_KIND.TERMINAL_CREATE>
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
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/** Lets the act channel's answers, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The tab mounted, shown or not, with what it draws, and the door that ends it as its × does. */
async function mount(shown = true, still = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = agentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  // Note that the working agent's mark never steps here unless a case moves the clock itself
  // (`still` off), because it steps on a beat forever, and a test that runs every fake timer out would
  // never finish.
  serveEffectsOn(still ? Context.make(Clock.Clock, STILL_CLOCK) : Context.empty());
  const registry = AtomRegistry.make();
  registries.push(registry);
  const terminals = windowTerminals();
  let closed = 0;
  let end: ((tab: TerminalStripTab) => void) | undefined;
  const Ender = () => {
    end = useEndTerminalTab();
    return null;
  };
  const render = (on: boolean) => {
    const tab = createElement(TerminalTab, {
      tab: TAB,
      agents,
      shown: on,
      onOpenAgent: () => undefined,
      onClose: () => {
        closed += 1;
      },
    });
    act(() =>
      root.render(
        onRegistry(
          registry,
          onTerminals(
            terminals,
            onSideBundles(FITTED, createElement(Fragment, null, tab, createElement(Ender))),
          ),
        ),
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
    render: async (on: boolean) => {
      render(on);
      await settle();
    },
    /** Closes the tab, as its × does. */
    end: async () => {
      act(() => end?.(TAB));
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
    action: () => container.querySelector<HTMLButtonElement>(".terminal-bar-end button"),
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

/** The payload of the act of the kind the tab sent last. */
function lastPayload(kind: TerminalKind) {
  const request = main.sent.findLast((each) => each.kind === kind);
  assert.ok(request && "payload" in request, `the tab sent ${kind}`);
  return request.payload;
}

test("shown, the tab starts a shell in the agent's sandbox, keeps its id for a reload, and attaches to it; hidden and shown again, it keeps its port and asks nothing more", async () => {
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["terminal.create", "terminal.attach"]);
  assert.equal((lastPayload(ACT_KIND.TERMINAL_ATTACH) as { terminalId: string }).terminalId, MADE);
  assert.deepEqual(kept(), [{ shell: TAB.shell, title: "Cloud 1", terminal: MADE }]);
  assert.equal(tab.standing(), "· connecting…");
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  assert.equal(tab.standing(), "· connected");
  await tab.render(false);
  await tab.render(true);
  assert.equal(port.closed(), false);
  assert.deepEqual(tab.kinds(2), []);
});

test("after a reload, the tab attaches to the shell its terminal kept, which runs on in the sandbox, starting none", async () => {
  keep([{ shell: TAB.shell, title: TAB.title, terminal: RUNNING_ON }]);
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["terminal.attach"]);
  assert.equal(
    (lastPayload(ACT_KIND.TERMINAL_ATTACH) as { terminalId: string }).terminalId,
    RUNNING_ON,
  );
});

test("closing the tab ends its shell in the sandbox, its port closed and its terminal out of the window's list", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  await tab.end();
  assert.equal(port.closed(), true);
  assert.deepEqual(lastPayload(ACT_KIND.TERMINAL_KILL), { agentId: AGENT.id, terminalId: MADE });
  assert.deepEqual(kept(), []);
});

test("a tab shown over a stopped sandbox resumes it, saying it is connecting, and one that stops while the tab is hidden waits until it is shown", async () => {
  main.createRefused = TERMINAL_REFUSAL.SANDBOX_STOPPED;
  const tab = await mount();
  await settle();
  assert.deepEqual(tab.kinds(), [
    "terminal.create",
    "terminal.resume",
    "terminal.create",
    "terminal.attach",
  ]);
  assert.equal(tab.standing(), "· connecting…");
  assert.equal(tab.bar(), undefined);
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  await tab.render(false);
  port.say({ type: "state", state: "stopped" });
  await settle();
  const before = main.sent.length;
  assert.deepEqual(tab.kinds(before), [], "a hidden tab wakes nothing");
  await tab.render(true);
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.resume", "terminal.attach"]);
});

test("a sandbox still stopped after the tab resumed it says it did not answer, and its action resumes it again", async () => {
  main.createRefused = TERMINAL_REFUSAL.SANDBOX_STOPPED;
  main.staysStopped = true;
  const tab = await mount();
  await settle();
  assert.deepEqual(tab.kinds(), ["terminal.create", "terminal.resume", "terminal.create"]);
  assert.equal(tab.bar(), "The agent’s sandbox didn’t answer.");
  main.staysStopped = false;
  const before = main.sent.length;
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(before), [
    "terminal.create",
    "terminal.resume",
    "terminal.create",
    "terminal.attach",
  ]);
});

test("a resume whose snapshot is gone says the sandbox shut down and how to start a fresh one", async () => {
  main.createRefused = TERMINAL_REFUSAL.SANDBOX_STOPPED;
  main.resumeRefused = TERMINAL_REFUSAL.SANDBOX_SNAPSHOT_GONE;
  const tab = await mount();
  await settle();
  assert.equal(
    tab.bar(),
    "This sandbox shut down after being idle. Send the agent a message to start a fresh one.",
  );
});

test("an agent that has not opened its sandbox yet shows the waiting bar, and the tab asks again a few seconds on", async () => {
  main.createRefused = TERMINAL_REFUSAL.AGENT_NOT_READY;
  vi.useFakeTimers();
  const tab = await mount(true, false);
  assert.equal(tab.standing(), "· waiting for sandbox");
  assert.equal(tab.bar(), "Waiting for the agent to open its sandbox…");
  assert.equal(tab.action(), null);
  main.createRefused = undefined;
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  await settle();
  assert.deepEqual(tab.kinds(), ["terminal.create", "terminal.create", "terminal.attach"]);
});

/** Ends the bar's reveal, as the browser does once its delay has run; a DOM without animation events is heard through React's webkit-prefixed name for it. */
function revealBar(): void {
  act(() => {
    for (const name of ["animationend", "webkitAnimationEnd"]) {
      document.querySelector(".terminal-bar")?.dispatchEvent(new Event(name, { bubbles: true }));
    }
  });
}

test("a dropped connection shows its bar, said once revealed, and its action asks for the same shell again at once", async () => {
  mountAnnouncer();
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "reconnecting" });
  assert.equal(tab.bar(), "Connection lost. Reconnecting…");
  assert.equal(announcedPolitely(), "", "a bar still hidden says nothing, so a blip is never said");
  revealBar();
  assert.equal(announcedPolitely(), "Connection lost. Reconnecting…", "it is said once shown");
  const before = main.sent.length;
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(before), ["terminal.attach"]);
});

test("a connection the host ended says so in the bar, and any key reconnects to the same shell", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "idle" });
  assert.equal(tab.standing(), "· disconnected");
  assert.equal(tab.bar(), "Disconnected. Press any key to reconnect.");
  const before = main.sent.length;
  await tab.type("q", 81);
  assert.deepEqual(tab.kinds(before), ["terminal.attach"]);
  assert.equal((lastPayload(ACT_KIND.TERMINAL_ATTACH) as { terminalId: string }).terminalId, MADE);
  // The key reconnected; it never reached the shell.
  assert.deepEqual(
    port.posted.filter((message) => message.type === "input"),
    [],
  );
});

test("a tab says on its shell's port each minute that it is shown, only while shown in a window in use", async () => {
  vi.useFakeTimers();
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const tab = await mount(true, false);
  const port = main.post(MADE);
  port.say({ type: "state", state: "attached" });
  const shown = () => port.posted.filter((message) => message.type === "shown").length;
  const minute = () => act(async () => vi.advanceTimersByTimeAsync(60_000));
  await minute();
  const whileInUse = shown();
  focused.mockReturnValue(false);
  await minute();
  const whileUnfocused = shown();
  focused.mockReturnValue(true);
  await tab.render(false);
  await minute();

  assert.equal(whileInUse, 1);
  assert.equal(whileUnfocused, 1, "a window nobody is using says nothing");
  assert.equal(shown(), 1, "a hidden tab says nothing");
});

test("a shell that ended takes any key for a new one in the same tab", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "exited", code: 0 });
  assert.equal(tab.standing(), "· exited");
  assert.equal(tab.bar(), "Process exited with code 0. Press any key for a new shell.");
  const before = main.sent.length;
  await tab.type("a", 65);
  assert.deepEqual(tab.kinds(before), ["terminal.create", "terminal.attach"]);
  assert.equal(kept().length, 1, "the tab is still the one terminal");
});

test("a service it cannot reach shows a bar that says so, whose action asks again", async () => {
  main.down.add(ACT_KIND.TERMINAL_CREATE);
  mountAnnouncer();
  const tab = await mount();
  assert.equal(tab.standing(), "· unreachable");
  assert.equal(tab.bar(), "The service did not answer.");
  assert.equal(announcedPolitely(), "The service did not answer.", "the bar is said as it lands");
  main.down.clear();
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(), ["terminal.create", "terminal.create", "terminal.attach"]);
});

test("an agent archived or retired closes its tab, as its Changes tab closes", async () => {
  main.createRefused = TERMINAL_REFUSAL.GONE;
  const tab = await mount();
  assert.equal(tab.closed(), 1);
});

test("a refusal of the agent's sandbox says which, and leaves the tab open with an action that asks again", async () => {
  main.createRefused = TERMINAL_REFUSAL.SANDBOX_UNANSWERED;
  const tab = await mount();
  assert.equal(tab.bar(), "The agent’s sandbox didn’t answer.");
  assert.equal(tab.closed(), 0);
  main.createRefused = undefined;
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds(), ["terminal.create", "terminal.create", "terminal.attach"]);
});

test("a deployment that serves no terminal relay says so, and leaves the tab open", async () => {
  const tab = await mount();
  const port = main.post(MADE);
  port.say({ type: "state", state: "unavailable" });
  assert.equal(tab.bar(), "The terminal service isn’t set up on this deployment.");
  assert.equal(tab.closed(), 0);
});

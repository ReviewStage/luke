// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ORPCError } from "@orpc/client";
import { MOTION_DURATION_MS } from "@repo/brand";
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
import { bundleLanded, onSideBundles } from "../testing/side-bundles.js";
import { agentsControl } from "../testing/tasks-control.js";
import { type HeldShell, localShellsAsked } from "./local-held.js";
import { LocalStanding } from "./local-shells.js";
import { LocalTab } from "./local-tab.js";
import { OpenLinkProvider } from "./use-open-link.js";

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

const FOLDER = "/Users/someone/.vespin/mirrors/8c1a6a4f/luke";

const HELD: readonly HeldShell[] = [
  { terminalId: OLDEST, title: "zsh" },
  { terminalId: NEWER, title: "dev server" },
];

function keep(shells: readonly HeldShell[]): void {
  window.sessionStorage.setItem(
    "vespin.localShells",
    JSON.stringify(shells.length === 0 ? {} : { [AGENT.id]: shells }),
  );
}

interface HostPort {
  readonly posted: TerminalPortInbound[];
  readonly closed: () => boolean;
  readonly say: (message: TerminalPortOutbound | UnparsedWireValue) => void;
}

type ShellKind = (typeof MAC_SHELL_ACT_KIND)[keyof typeof MAC_SHELL_ACT_KIND];

type ShellAct = {
  [Kind in ShellKind]: { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[ShellKind];

type SentAct = AnyAct | ShellAct;

interface Main {
  readonly sent: SentAct[];
  readonly shells: Set<string>;
  readonly down: Set<PortActKind | ShellKind>;
  readonly held: (() => void)[];
  readonly holding: Set<PortActKind | ShellKind>;
  readonly post: (terminalId: string) => HostPort;
}

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(bundleLanded(SIDE_BUNDLES.terminal)));
let main: Main;

beforeEach(() => {
  keep(HELD);
  const sent: SentAct[] = [];
  const shells = new Set(HELD.map((each) => each.terminalId));
  const refused = (request: ShellAct) =>
    main.down.has(request.kind) ||
    (request.kind === ACT_KIND.MAC_SHELL_ATTACH && !main.shells.has(request.payload.terminalId));
  const answer = (request: ShellAct): PortActResult<ShellKind> => {
    switch (request.kind) {
      case ACT_KIND.MAC_SHELL_MIRROR:
        return { folder: FOLDER };
      case ACT_KIND.MAC_SHELL_OPEN: {
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
        say: (message) =>
          act(() => port.onmessage?.(new MessageEvent("message", { data: message }))),
      };
    },
  };
  const respond = (request: ShellAct): Promise<PortActResult<ShellKind>> => {
    sent.push(request);
    const refusal = () =>
      new ORPCError(ACT_ERROR.REFUSED, { message: "Could not open that shell." });
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
  document.body.style.removeProperty("--ui-duration-pane");
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

async function mount(
  shown = true,
  shellsOpen = true,
  before?: (registry: AtomRegistry.AtomRegistry) => void,
  findable = false,
  bundles: SideBundles = SIDE_BUNDLES,
  phone = false,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const agents = agentsControl({ agents: [AGENT], agentIds: [AGENT.id] });
  const registry = AtomRegistry.make({ initialValues: [[timeRuntime, AsyncResult.initial()]] });
  before?.(registry);
  const wrapped = (tab: React.ReactElement) =>
    findable
      ? createElement(FindScope, {
          active: true,
          subject: { task: TASK, tab: { local: AGENT.id } },
          children: tab,
        })
      : tab;
  let toggled = 0;
  let agentOpened = 0;
  let handed = onPhone(null).handed;
  const render = (on: boolean) => {
    const tab = createElement(LocalTab, {
      agentId: AGENT.id,
      agents,
      shown: on,
      onOpenAgent: () => {
        agentOpened += 1;
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
    handed: () => handed,
    agentOpened: () => agentOpened,
    render: async (on: boolean) => {
      render(on);
      await settle();
    },
    toggled: () => toggled,
    registry,
    rows: () =>
      [...container.querySelectorAll('[aria-label="Shell list"] > li')].map((row) => ({
        name: row.querySelector(".ui-list-row-title")?.textContent,
        shown: row.querySelector('[aria-current="true"]') !== null,
      })),
    press: async (label: string) => {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      assert.ok(button, `a button named ${label}`);
      await act(async () => button.click());
      await settle();
    },
    choose: async (name: string) => {
      const row = [
        ...container.querySelectorAll<HTMLButtonElement>('[aria-label="Shell list"] > li > button'),
      ].find((each) => each.querySelector(".ui-list-row-title")?.textContent === name);
      assert.ok(row, `a row for ${name}`);
      row.focus();
      await act(async () => row.click());
      await settle();
    },
    kinds: (from = 0) => main.sent.slice(from).map((request) => request.kind),
    standing: () => container.querySelector(".terminal-tab-standing")?.textContent,
    bar: () => container.querySelector(".terminal-bar-words")?.textContent,
    action: () => container.querySelector<HTMLButtonElement>(".terminal-bar-end button"),
    dimmed: () =>
      container.querySelector(".terminal-tab-screen")?.getAttribute("data-dim") === "true",
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

function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

test("the tab is left out of the screen recording, its screen and bar with it", async () => {
  const tab = await mount();
  const screen = tab.container.querySelector(".terminal-tab-screen");
  assert.ok(screen?.closest(".ph-no-capture"));
  assert.ok(tab.container.querySelector(".ui-pane-bar")?.closest(".ph-no-capture"));
});

test("shown, the tab attaches to the oldest shell the window holds; hidden, it lets the port go and attaches nothing more", async () => {
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["macShell.attach"]);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
    agentId: AGENT.id,
    terminalId: OLDEST,
    cols: 80,
    rows: 24,
  });
  assert.equal(tab.standing(), "· connecting…");
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  assert.equal(tab.standing(), "· connected");
  assert.equal(tab.bar(), undefined);
  await tab.render(false);
  assert.equal(port.closed(), true);
  assert.deepEqual(tab.kinds(1), []);
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

test("an agent with no shell yet has its files mirrored and a shell opened in the mirror, and the tab attaches to it", async () => {
  keep([]);
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["macShell.mirror", "macShell.open", "macShell.attach"]);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_MIRROR), { agentId: AGENT.id });
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_OPEN), { agentId: AGENT.id, folder: FOLDER });
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
    agentId: AGENT.id,
    terminalId: MADE,
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["Terminal 1"],
  );
});

test("a shell that ended takes any key for a new one, and is let go", async () => {
  keep([{ terminalId: OLDEST, title: "zsh" }]);
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "exited", code: 0 });
  assert.equal(tab.standing(), "· exited");
  assert.equal(tab.bar(), undefined);
  const before = main.sent.length;
  await tab.type("a", 65);
  assert.deepEqual(tab.kinds(before), [
    "macShell.close",
    "macShell.mirror",
    "macShell.open",
    "macShell.attach",
  ]);
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["Terminal 1"],
  );
});

test("a mirror main could not make shows a bar that says so, whose action asks again", async () => {
  keep([]);
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
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  vi.useFakeTimers();
  port.say({ type: "output", data: bytes("x".repeat(4_000)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(port.posted, []);
  port.say({ type: "output", data: bytes("y".repeat(1_500)) });
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(port.posted, [{ type: "ack", bytes: 5_500 }]);
  assert.equal(tab.standing(), "· connected");
});

test("a message on the port that is no message of main's is never drawn nor acted on", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
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

test("a shell main no longer holds, as one kept from before the window closed, is dropped and the next one attached", async () => {
  main.shells.delete(OLDEST);
  const tab = await mount();
  assert.deepEqual(tab.kinds(), ["macShell.attach", "macShell.attach"]);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
    agentId: AGENT.id,
    terminalId: NEWER,
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["dev server"],
  );
});

test("a shell main could not open in the mirror says so, and its action asks again", async () => {
  keep([]);
  main.down.add(ACT_KIND.MAC_SHELL_OPEN);
  const tab = await mount();
  assert.equal(tab.standing(), "· unreachable");
  assert.equal(tab.bar(), "Could not open a shell in this agent’s files.");
  main.down.clear();
  await act(async () => tab.action()?.click());
  await settle();
  assert.deepEqual(tab.kinds().slice(2), ["macShell.mirror", "macShell.open", "macShell.attach"]);
});

test("of two attaches out at once, only the newest one's port is taken, and the late one is closed", async () => {
  const tab = await mount();
  await tab.render(false);
  await tab.render(true);
  assert.deepEqual(tab.kinds(), ["macShell.attach", "macShell.attach"]);
  const late = main.post(OLDEST);
  assert.equal(late.closed(), true);
  late.say({ type: "state", state: "attached" });
  assert.equal(tab.standing(), "· connecting…");
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
  await tab.render(false);
  await tab.render(true);
  const second = main.post(OLDEST);
  await act(async () => vi.runAllTimersAsync());
  assert.deepEqual(second.posted, []);
});

test("the bar's action hands the keyboard back to the screen, since its button goes with the bar", async () => {
  keep([]);
  main.down.add(ACT_KIND.MAC_SHELL_MIRROR);
  const tab = await mount();
  const retry = tab.action();
  assert.ok(retry);
  retry.focus();
  await act(async () => retry.click());
  await settle();
  assert.ok(
    document.activeElement === tab.container.querySelector("textarea"),
    "the screen holds the keyboard",
  );
});

test("what is typed while the shell is still attaching goes nowhere", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
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
  assert.equal(main.post(NEWER).closed(), true);
  const late = main.post(OLDEST);
  assert.equal(late.closed(), true);
  const newest = main.post(OLDEST);
  assert.equal(newest.closed(), false);
});

test("a tab taken down with an attach still out closes the port that lands after it", async () => {
  await mount();
  for (const root of roots.splice(0)) act(() => root.unmount());
  assert.equal(main.post(OLDEST).closed(), true);
});

test("a paste longer than one message is cut between characters, never inside one", async () => {
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  const paste = `${"a".repeat(65_535)}😀b`;
  const field = tab.container.querySelector("textarea");
  assert.ok(field);
  act(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => paste } });
    field.dispatchEvent(event);
  });
  await settle();
  const sent = port.posted.flatMap((message) => (message.type === "input" ? [message.data] : []));
  assert.equal(sent.join(""), paste);
  for (const part of sent) assert.doesNotMatch(part, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
});

test("an attach refused after its tab was taken down leaves nothing waiting, so a later tab's port stands", async () => {
  main.holding.add(ACT_KIND.MAC_SHELL_ATTACH);
  await mount();
  for (const root of roots.splice(0)) act(() => root.unmount());
  main.shells.delete(OLDEST);
  main.holding.clear();
  for (const release of main.held.splice(0)) release();
  await settle();
  const later = await mount();
  const port = main.post(NEWER);
  port.say({ type: "state", state: "attached" });
  assert.equal(later.standing(), "· connected");
});

test("a tab taken down with attaches out for two shells closes both ports, whichever lands first", async () => {
  const tab = await mount();
  await tab.choose("dev server");
  for (const root of roots.splice(0)) act(() => root.unmount());
  assert.equal(main.post(NEWER).closed(), true);
  assert.equal(main.post(OLDEST).closed(), true);
});

function lastPayload(kind: PortActKind | ShellKind) {
  const request = main.sent.findLast((each) => each.kind === kind);
  assert.ok(request, `the tab sent ${kind}`);
  return "payload" in request ? request.payload : undefined;
}

test("the list shows each shell the window holds for the agent, the one shown marked", async () => {
  const tab = await mount();
  assert.deepEqual(tab.rows(), [
    { name: "zsh", shown: true },
    { name: "dev server", shown: false },
  ]);
});

test("a press on another shell's row shows that shell, from a clear screen", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await tab.choose("dev server");
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
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

test("the list's + opens a shell in the same agent's mirror and shows it", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await tab.press("New shell");
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_OPEN), { agentId: AGENT.id, folder: FOLDER });
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
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
      ["Terminal 1", true],
    ],
  );
});

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
  assert.deepEqual(tab.kinds(before), ["macShell.close", "macShell.attach"]);
  assert.deepEqual(
    tab.rows().map((row) => [row.name, row.shown]),
    [["dev server", true]],
  );
});

test("a shell renamed from its row's menu is renamed in place, and a reload finds it under its new name", async () => {
  const tab = await mount();
  await renameOldest(tab.container, "server");
  assert.equal(tab.rows()[0]?.name, "server");
  for (const root of roots.splice(0)) act(() => root.unmount());

  const reloaded = await mount();
  assert.deepEqual(
    reloaded.rows().map((row) => row.name),
    ["server", "dev server"],
  );
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
    agentId: AGENT.id,
    terminalId: OLDEST,
    cols: 80,
    rows: 24,
  });
});

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

test("a terminal's row in the panel's + counts the agent's shells, leaving whether the agent works to its glyph", async () => {
  const tab = await mount();
  const standing = renderToStaticMarkup(
    onRegistry(tab.registry, createElement(LocalStanding, { agentId: AGENT.id })),
  );
  assert.equal(standing, "2 shells");
});

test("the list's foot names the agent, its glyph saying it works with no word repeating it", async () => {
  const tab = await mount();
  const foot = tab.container.querySelector(".terminal-shells-foot");
  assert.equal(foot?.textContent, "Invite flow");
  assert.ok(foot?.querySelector('[role="img"][aria-label="Working"]'));
});

test("a shell chosen from the list takes the keyboard to the screen, the shell's to type into", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  await tab.choose("dev server");
  assert.ok(
    document.activeElement === tab.container.querySelector("textarea"),
    "the screen holds the keyboard",
  );
});

test("ending the only shell opens one in its place once the end answers", async () => {
  keep([{ terminalId: OLDEST, title: "zsh" }]);
  const tab = await mount();
  const port = main.post(OLDEST);
  port.say({ type: "state", state: "attached" });
  const before = main.sent.length;
  main.holding.add(ACT_KIND.MAC_SHELL_CLOSE);
  await tab.press("End shell");
  await confirmWith("End shell");
  await settle();
  assert.deepEqual(tab.kinds(before), ["macShell.close"]);
  main.holding.clear();
  for (const release of main.held.splice(0)) release();
  await settle();
  assert.deepEqual(tab.kinds(before), [
    "macShell.close",
    "macShell.mirror",
    "macShell.open",
    "macShell.attach",
  ]);
});

test("an end main refuses leaves the shown shell shown, attached again, and the question saying why", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  main.down.add(ACT_KIND.MAC_SHELL_CLOSE);
  const before = main.sent.length;
  await tab.press("End shell");
  await confirmWith("End shell");
  await settle();
  assert.deepEqual(tab.kinds(before), ["macShell.close", "macShell.attach"]);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
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
  main.holding.add(ACT_KIND.MAC_SHELL_CLOSE);
  await tab.press("End shell");
  await confirmWith("End shell");
  await tab.choose("dev server");
  const before = main.sent.length;
  main.holding.clear();
  for (const release of main.held.splice(0)) release();
  await settle();
  assert.deepEqual(tab.kinds(before), []);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
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

test("an exit said on a shell no longer shown changes nothing", async () => {
  const tab = await mount();
  const first = main.post(OLDEST);
  first.say({ type: "state", state: "attached" });
  await tab.choose("dev server");
  main.post(NEWER).say({ type: "state", state: "attached" });
  first.say({ type: "state", state: "exited", code: 0 });
  assert.equal(tab.standing(), "· connected");
});

test("a new shell asked for before the tab opens is opened in place of attaching to the oldest", async () => {
  const tab = await mount(true, true, (registry) => registry.set(localShellsAsked(AGENT.id), 1));
  assert.deepEqual(tab.kinds(), ["macShell.mirror", "macShell.open", "macShell.attach"]);
  assert.equal(tab.registry.get(localShellsAsked(AGENT.id)), 0);
  assert.deepEqual(lastPayload(ACT_KIND.MAC_SHELL_ATTACH), {
    agentId: AGENT.id,
    terminalId: MADE,
    cols: 80,
    rows: 24,
  });
});

test("a new shell asked for while a shell is connected opens at once, and shows", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "attached" });
  const before = main.sent.length;
  act(() => {
    tab.registry.update(localShellsAsked(AGENT.id), (asked) => asked + 1);
  });
  await settle();
  assert.deepEqual(tab.kinds(before), ["macShell.mirror", "macShell.open", "macShell.attach"]);
  assert.equal(tab.registry.get(localShellsAsked(AGENT.id)), 0);
});

test("two new shells asked for at once open two shells, each ask its own", async () => {
  const tab = await mount(true, true, (registry) => registry.set(localShellsAsked(AGENT.id), 2));
  assert.deepEqual(tab.kinds(), ["macShell.mirror", "macShell.open", "macShell.attach"]);
  main.post(MADE).say({ type: "state", state: "attached" });
  await settle();
  assert.equal(tab.kinds().filter((kind) => kind === "macShell.open").length, 2);
  assert.equal(tab.registry.get(localShellsAsked(AGENT.id)), 0);
});

test("a new shell asked for while the tab is hidden on a shell that ended opens one shell once shown, letting the ended one go", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "exited", code: 0 });
  await tab.render(false);
  const before = main.sent.length;
  act(() => {
    tab.registry.update(localShellsAsked(AGENT.id), (asked) => asked + 1);
  });
  await tab.render(true);
  assert.deepEqual(tab.kinds(before), [
    "macShell.close",
    "macShell.mirror",
    "macShell.open",
    "macShell.attach",
  ]);
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["dev server", "Terminal 1"],
  );
});

test("a new shell asked for after the shown shell ended lets the ended one go and opens it, as a key would", async () => {
  const tab = await mount();
  main.post(OLDEST).say({ type: "state", state: "exited", code: 0 });
  const before = main.sent.length;
  act(() => {
    tab.registry.update(localShellsAsked(AGENT.id), (asked) => asked + 1);
  });
  await settle();
  assert.deepEqual(tab.kinds(before), [
    "macShell.close",
    "macShell.mirror",
    "macShell.open",
    "macShell.attach",
  ]);
  assert.equal(tab.registry.get(localShellsAsked(AGENT.id)), 0);
  assert.deepEqual(
    tab.rows().map((row) => row.name),
    ["dev server", "Terminal 1"],
  );
});

function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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

function floatedShells(tab: { container: HTMLElement }): HTMLElement | null {
  return tab.container.querySelector<HTMLElement>('[aria-label="Shells"]');
}

function shellsToggle(tab: { container: HTMLElement }): HTMLButtonElement {
  const toggle = tab.container.querySelector<HTMLButtonElement>(
    '.file-tree-toggle[data-place="over"] button',
  );
  assert.ok(toggle, "the toggle that floats the shells is drawn");
  return toggle;
}

async function narrowTab() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.body.style.setProperty("--ui-duration-pane", `${MOTION_DURATION_MS.PANE}ms`);
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

test("on a phone the tab draws no bar over the screen, and the task's header's ⋯ shows the shells over it and opens the agent, saying where the connection stands", async () => {
  const tab = await mount(true, false, undefined, false, SIDE_BUNDLES, true);

  assert.equal(tab.container.querySelector(".file-view-bar"), null);
  assert.deepEqual(tab.handed().labels(), ["Show shells", "Open agent"]);
  assert.match(tab.handed().item("Show shells").detail ?? "", /^Local · /u);

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
  const tab = createElement(LocalTab, {
    agentId: AGENT.id,
    agents,
    shown: true,
    onOpenAgent: () => undefined,
    shells: { open: true, onToggle: () => undefined },
  });
  const draw = () =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          onSideBundles(
            SIDE_BUNDLES,
            createElement(FindScope, {
              active: true,
              subject: { task: TASK, tab: { local: AGENT.id } },
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
  const tab = await mount(true, false, undefined, false, SIDE_BUNDLES, true);
  assert.equal(tab.bar(), "Connecting…");

  main.post(OLDEST).say({ type: "state", state: "attached" });
  assert.equal(tab.bar(), undefined);
});

test("in a wide room a connecting terminal draws no bar, the title bar saying so", async () => {
  const tab = await mount();
  assert.equal(tab.standing(), "· connecting…");
  assert.equal(tab.bar(), undefined);
});

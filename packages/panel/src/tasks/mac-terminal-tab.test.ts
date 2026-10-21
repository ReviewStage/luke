// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  MAC_TERMINAL_PORT_CHANNEL,
  MAC_TERMINAL_PORT_MESSAGE,
  type MacTerminalPortOutbound,
} from "@luke/features/mac-terminal-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { SIDE_BUNDLES } from "../bundle-loader.js";
import {
  type AnyAct,
  fakeActPortAnswering,
  fakeAppBridge,
  type SentPortAct,
} from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { bundleLanded, onSideBundles } from "../testing/side-bundles.js";
import { MacTerminalTab } from "./mac-terminal-tab.js";

/**
 * Run on this Mac's tab as the developer meets it: a press reads the agent's
 * pushed branch and starts a run of it; the bar says how the run stands and
 * offers Stop while it runs and Run once it has ended; Stop asks main to end
 * it and the tab draws it stopped when main says it ended; Run starts it
 * anew; Open in Terminal asks main to open the worktree once a run has
 * started; and the tab drawn again over a run only shows it, a stopped one
 * still Stopped. Main is the process boundary: its act
 * channel answers, and a run's port is handed into the page as the preload
 * hands it. Synthetic names throughout.
 */

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** Every act the tab sent, on the act channel or the act port, by kind and payload, in order. */
let sent: (AnyAct | SentPortAct)[];
const roots: Root[] = [];

beforeAll(() => Effect.runPromise(bundleLanded(SIDE_BUNDLES.terminal)));

beforeEach(() => {
  sent = [];
  const published = {
    repository: "acme/app",
    branch: "luke/add-thing",
    pullRequest: {
      number: 42,
      title: "Add the thing",
      url: "https://github.com/acme/app/pull/42",
      state: "open",
      checks: "passing",
      additions: 1,
      deletions: 0,
      changedFiles: 1,
    },
  };
  fakeAppBridge({});
  // Note that the acts main answers itself, a run's among them, and what the agent published, ride the act port.
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(
      request.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST ? published : undefined,
    );
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
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The tab drawn for the agent's press, with what it draws and does. */
async function mount(asked: number) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  act(() =>
    root.render(
      onRegistry(
        registry,
        onSideBundles(
          SIDE_BUNDLES,
          createElement(MacTerminalTab, {
            tab: { macTerminal: AGENT, repository: "acme/app", asked },
          }),
        ),
      ),
    ),
  );
  await settle();
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
  return {
    unmount: () => act(() => root.unmount()),
    /** Where the bar says the run stands. */
    bar: () => container.querySelector(".terminal-tab-standing")?.textContent ?? "",
    /** The words on each button the bar offers, and whether it can be pressed. */
    offered: () => buttons().map((each) => `${each.textContent}${each.disabled ? " (off)" : ""}`),
    press: async (words: string) => {
      const button = buttons().find((each) => each.textContent === words);
      assert.ok(button, `a button saying ${words}`);
      await act(async () => button.click());
      await settle();
    },
    /** Hands the tab a run's port, as main does after an open, and says on it what main says. */
    post: () => {
      const { port1: port } = new MessageChannel();
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { channel: MAC_TERMINAL_PORT_CHANNEL, ticket: { agentId: AGENT } },
            source: window,
            ports: [port],
          }),
        );
      });
      return (message: MacTerminalPortOutbound) =>
        act(() => port.onmessage?.(new MessageEvent("message", { data: message })));
    },
  };
}

/** Each open the tab asked main for, as its payload. */
const opens = () =>
  sent.flatMap((each) =>
    each.kind === ACT_KIND.MAC_TERMINAL_OPEN
      ? // SAFETY: the tab sends an open with the open's own payload.
        [each.payload as { branch: string; pullRequest: number | null; again: boolean }]
      : [],
  );

test("a press reads the branch and starts a run; Stop ends it, and Run starts it anew", async () => {
  const tab = await mount(1);
  assert.deepEqual(
    opens().map(({ branch, pullRequest, again }) => ({ branch, pullRequest, again })),
    [{ branch: "luke/add-thing", pullRequest: 42, again: true }],
  );
  const say = tab.post();
  await settle();
  assert.match(tab.bar(), /luke\/add-thing · this Mac · Running/u);
  assert.deepEqual(tab.offered(), ["Open in Terminal", "Stop"]);

  await tab.press("Stop");
  assert.equal(sent.at(-1)?.kind, ACT_KIND.MAC_TERMINAL_STOP);
  assert.match(tab.bar(), /Stopping…/u);
  say({ type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code: 143 });
  assert.match(tab.bar(), /Stopped/u);
  assert.deepEqual(tab.offered(), ["Open in Terminal", "Run"]);

  await tab.press("Run");
  assert.equal(opens().length, 2);
  assert.equal(opens()[1]?.again, true);
});

test("a run that ends on its own says how it ended", async () => {
  const tab = await mount(2);
  const say = tab.post();
  await settle();

  say({ type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code: 1 });

  assert.match(tab.bar(), /Exited with code 1/u);
});

test("Open in Terminal asks main to open the run's worktree", async () => {
  const tab = await mount(3);
  tab.post();
  await settle();

  await tab.press("Open in Terminal");

  assert.equal(sent.at(-1)?.kind, ACT_KIND.MAC_TERMINAL_REVEAL);
});

test("the tab drawn again over a run only shows it, starting none", async () => {
  const first = await mount(4);
  first.post();
  await settle();
  first.unmount();

  const again = await mount(4);

  assert.deepEqual(
    opens().map((each) => each.again),
    [true, false],
  );
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST).length, 1);
  assert.match(again.bar(), /luke\/add-thing/u);
});

test("a run stopped, its tab drawn again, still says Stopped", async () => {
  const first = await mount(5);
  first.post();
  await settle();
  await first.press("Stop");
  first.unmount();

  const again = await mount(5);
  const say = again.post();
  await settle();
  say({ type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code: 143 });

  assert.match(again.bar(), /Stopped/u);
});

test("Open in Terminal waits for the run to start", async () => {
  const tab = await mount(6);
  // Note that the branch is read and the open asked, but main has handed no port yet.
  assert.deepEqual(tab.offered(), ["Open in Terminal (off)", "Run (off)"]);

  tab.post();
  await settle();

  assert.deepEqual(tab.offered(), ["Open in Terminal", "Stop"]);
});

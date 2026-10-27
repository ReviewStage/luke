// @vitest-environment jsdom

/**
 * app-redraws.test.ts -- what a delivery of main's document draws again in the window: a patch to the settings alone draws the settings' readers and none of the tasks' columns, a patch to the tasks draws the tasks' columns, and the words and turns of a call standing draw neither the sidebar nor the open plan's sections.
 *
 * The window is drawn whole through `App`, on a fake bridge that delivers
 * each document as main would, a new tree each time. What is drawn again is
 * read through wrappers around four surfaces that draw the real ones:
 * ⌘K, which reads the settings, the sidebar's foot, under the sidebar, the
 * page with no task open, under the Tasks column, each section of the open plan's
 * words, and an agent's words, which a chat message draws. Synthetic tasks.
 */

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { type AppStateDelivery, type AppStateSnapshot, RUN_PROFILE } from "@luke/host/app-state";
import { type AppBridge, bridgeEntries } from "@luke/host/bridge";
import { PUSH_METHOD } from "@luke/host/contract";
import { LIVE_STATUS, TRANSCRIPT_SPEAKER } from "@luke/live";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { memoryHistory } from "@luke/ui/history-adapter";
import { AVATAR_OFF } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { App } from "./app.js";
import { runAppCommand } from "./app-commands.js";
import { installWindowHistory } from "./navigation-history.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { deliveryOf, stateWith } from "./testing/app-state.js";

/** How many times each recorded surface was drawn, by its name. */
const draws = vi.hoisted(() => new Map<string, number>());

// Note that each wrapper draws the real surface beneath it and only counts,
// because what is under test is whether the window draws it, not what it draws.
vi.mock("./desktop/command-palette.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./desktop/command-palette.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    CommandPalette: (props: Parameters<typeof actual.CommandPalette>[0]) => {
      draws.set("palette", (draws.get("palette") ?? 0) + 1);
      return draw(actual.CommandPalette, props);
    },
  };
});
vi.mock("./desktop/sidebar-foot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./desktop/sidebar-foot.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    SidebarFoot: (props: Parameters<typeof actual.SidebarFoot>[0]) => {
      draws.set("sidebar", (draws.get("sidebar") ?? 0) + 1);
      return draw(actual.SidebarFoot, props);
    },
  };
});
vi.mock("./markdown-message.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./markdown-message.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    MarkdownMessage: (props: Parameters<typeof actual.MarkdownMessage>[0]) => {
      if (props.className?.includes("plan-unit") === true) {
        draws.set("section", (draws.get("section") ?? 0) + 1);
      }
      return draw(actual.MarkdownMessage, props);
    },
  };
});
vi.mock("./tasks/transcript-blocks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tasks/transcript-blocks.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    TranscriptWords: (props: Parameters<typeof actual.TranscriptWords>[0]) => {
      draws.set("words", (draws.get("words") ?? 0) + 1);
      return draw(actual.TranscriptWords, props);
    },
  };
});
vi.mock("./desktop/desktop-welcome.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./desktop/desktop-welcome.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    DesktopWelcome: (props: Parameters<typeof actual.DesktopWelcome>[0]) => {
      draws.set("home", (draws.get("home") ?? 0) + 1);
      return draw(actual.DesktopWelcome, props);
    },
  };
});

const AT = 1_792_000_000_000;

const INVITES: TaskSummary = {
  id: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

/** Main's document for a signed-in account at `version`, no task listed. */
const FIRST: AppStateSnapshot = stateWith({}, {});

/** A fixture run's document, its synthetic task open on its plan, with a call standing about another task, its transcript `lines` long and Luke speaking as `lukeSpeaking` says. */
function onCall(version: number, lines: number, lukeSpeaking: boolean): AppStateSnapshot {
  const view: VoiceView = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: lukeSpeaking ? LIVE_STATUS.SPEAKING : LIVE_STATUS.LISTENING,
    listening: !lukeSpeaking,
    lukeSpeaking,
    call: { taskId: "task-on-call", agentId: "agent-on-call" },
  };
  return {
    ...FIRST,
    version,
    run: { ...FIRST.run, fixtureMode: true, profile: RUN_PROFILE.TASKS_WORK },
    voice: { avatar: AVATAR_OFF, view },
    callTranscript: {
      voiceSessionId: "session-on-call",
      lines: Array.from({ length: lines }, (_, at) => ({
        rowId: `row-${at}`,
        speaker: TRANSCRIPT_SPEAKER.USER,
        words: "Invite a teammate by email".slice(0, at + 1),
        startMs: at * 100,
        endMs: at * 100 + 100,
      })),
    },
  };
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
/** The document the window's first read answers with. */
let opening: AppStateSnapshot = FIRST;
let listeners = new Set<(snapshot: AppStateSnapshot) => void>();

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  draws.clear();
  listeners = new Set();
  fakeAppPlatform({ ...QUIET_PANEL, applySessionReplay: () => undefined });
  installWindowHistory(memoryHistory());
  // Every bridge call is quiet but the two the document is read through, as a window with nothing else to hear.
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.resolve(undefined) : () => undefined,
    ]),
  ]);
  fakeAppBridge({
    ...quiet,
    requestAppState: () => Promise.resolve(structuredClone(opening)),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies Partial<AppBridge>);
  // Every act is refused, as a service that answers nothing would.
  fakeActPortAnswering(() => Promise.reject(refusedOnPort("Not here.")));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations, the window's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 24; tick += 1) await Promise.resolve();
  });
}

/** The window drawn on main's first document, every surface's count then cleared. */
async function drawWindow(first: AppStateSnapshot = FIRST): Promise<void> {
  opening = first;
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      createElement(RegistryContext.Provider, { value: AtomRegistry.make() }, createElement(App)),
    ),
  );
  // Note that a fixture run's window waits on its synthetic tasks, which land a few turns later.
  await vi.waitFor(async () => {
    await settle();
    assert.ok((draws.get("sidebar") ?? 0) > 0, "the sidebar stands");
  });
  if (first === FIRST) assert.ok((draws.get("home") ?? 0) > 0, "the page with no task open stands");
  draws.clear();
}

/** Delivers `snapshot` as main would, a new tree, and lets the window draw what it draws. */
async function deliver(snapshot: AppStateSnapshot): Promise<void> {
  act(() => {
    for (const listener of listeners) listener(structuredClone(snapshot));
  });
  await settle();
}

test("a delivery that moves only the settings draws ⌘K again and neither the sidebar nor the page with no task open", async () => {
  await drawWindow();
  await deliver({
    ...FIRST,
    version: 2,
    settings: appSettingsWire(settingsView({ duckOtherMedia: false })),
  });
  assert.ok((draws.get("palette") ?? 0) > 0, "⌘K, which reads the settings, is drawn again");
  assert.equal(draws.get("sidebar") ?? 0, 0, "the sidebar is not drawn again");
  assert.equal(draws.get("home") ?? 0, 0, "the page with no task open is not drawn again");
});

test("the window drawn again for a dialog of its own draws neither the sidebar nor the page with no task open", async () => {
  await drawWindow();
  // Help › Send Feedback opens the window's own dialog, which moves nothing the columns draw.
  act(() => {
    runAppCommand(APP_COMMAND.SEND_FEEDBACK);
  });
  await settle();
  assert.ok(document.querySelector('[role="dialog"]'), "the feedback dialog stands");
  assert.equal(draws.get("sidebar") ?? 0, 0, "the sidebar is not drawn again");
  assert.equal(draws.get("home") ?? 0, 0, "the page with no task open is not drawn again");
});

test("a delivery that moves the tasks draws the sidebar and the page with no task open again", async () => {
  await drawWindow();
  await deliver({ ...FIRST, version: 2, tasks: { ...IDLE_TASKS_VIEW, tasks: [INVITES] } });
  assert.ok((draws.get("sidebar") ?? 0) > 0, "the sidebar is drawn again");
  assert.ok((draws.get("home") ?? 0) > 0, "the page with no task open is drawn again");
});

test("a call's words growing and its turns changing hands draw neither the sidebar nor the open plan's sections", async () => {
  await drawWindow(onCall(1, 1, false));
  await vi.waitFor(async () => {
    await settle();
    assert.ok(document.querySelector(".plan-unit"), "the open plan's sections stand");
  });
  // The task's own reads settle a few turns after it is drawn: its tabs, and its chat's gate.
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 20));
    });
    await settle();
  }
  draws.clear();

  // A caption tick: the transcript grows, nothing else moves.
  await deliver(onCall(2, 2, false));
  await deliver(onCall(3, 3, false));
  // Luke takes the turn, and hands it back.
  await deliver(onCall(4, 3, true));
  await deliver(onCall(5, 4, false));

  assert.equal(draws.get("sidebar") ?? 0, 0, "the sidebar is not drawn again");
  assert.equal(draws.get("section") ?? 0, 0, "no section of the plan is drawn again");
});

test("a delivery that moves what waits in the Inbox, and nothing of the chat, draws no message of Chat again", async () => {
  const onChat = (version: number, holding: number): AppStateSnapshot => ({
    ...FIRST,
    version,
    run: { ...FIRST.run, fixtureMode: true, profile: RUN_PROFILE.CHAT },
    inbox: {
      ...FIRST.inbox,
      tasks: Array.from({ length: holding }, (_, at) => ({
        taskId: `task-${at}`,
        items: 1,
        updatedAt: AT,
      })),
    },
  });
  await drawWindow(onChat(1, 0));
  // Chat opens on For you, its rows drawn once the run's synthetic chat lands.
  await vi.waitFor(async () => {
    act(() => {
      runAppCommand(APP_COMMAND.CHAT);
    });
    await settle();
    assert.ok(document.querySelector(".chat-stream .chat-message"), "Chat's messages stand");
  });
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 20));
    });
    await settle();
  }
  draws.clear();

  await deliver(onChat(2, 1));
  await deliver(onChat(3, 2));

  assert.ok(document.querySelector(".chat-stream"), "Chat's place still stands");
  assert.equal(draws.get("words") ?? 0, 0, "no message of Chat is drawn again");
});

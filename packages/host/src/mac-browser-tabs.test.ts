import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_SCREENSHOT,
  type BrowserAgentAction,
  browserAgentRunSchema,
} from "@luke/features/browser-agent-actions";
import {
  MAC_COMMAND_BOUNDS,
  MAC_COMMAND_IMAGE_TYPE,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { Effect, Schema } from "effect";
import {
  type MacBrowserDesk,
  type MacBrowserTab,
  type MacTabShot,
  type MacTaskTabs,
  macBrowserTabsOver,
  runMacBrowserCommand,
} from "./mac-browser-tabs.js";

/**
 * An agent's browser actions on this Mac's Browser tabs, over fake tabs
 * whose debuggers answer from a script as a page would: who is refused and
 * in which words, which tab an action lands on, how a screenshot is caught
 * and sized, and how the bar's Stop keeps an agent off a tab. Synthetic ids,
 * addresses, and pages throughout.
 */

const TASK = "4c3b2a19-0f8e-4d7c-9b6a-5f4e3d2c1b0a";
const OTHER_TASK = "8a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2d";

/** The bytes a JPEG starts with, then filler, as base64 of the length asked. */
function jpegOf(bytes: number): string {
  const body = Buffer.alloc(bytes, 0x20);
  body.set([0xff, 0xd8, 0xff, 0xe0]);
  return body.toString("base64");
}

/** One fake tab: its page, the commands its debugger heard, the shots asked of it, and whether it is held now. */
interface FakeTab {
  readonly tab: MacBrowserTab;
  readonly heard: string[];
  readonly shots: MacTabShot[];
  readonly held: () => boolean;
  stop: () => void;
  /** Stops the tab as the next command it hears arrives, as a press of Stop mid-run would. */
  stopOn: (method: string) => void;
}

/** A page as its debugger answers: a 1440 by 900 viewport on a Retina display, a button at e42, loaded. */
function pageAnswer(method: string, params: { readonly [key: string]: unknown } | undefined) {
  switch (method) {
    case "Page.getLayoutMetrics":
      return {
        cssLayoutViewport: { clientWidth: 1440, clientHeight: 900 },
        cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1440, clientHeight: 900 },
      };
    case "Runtime.evaluate":
      return {
        result: { value: params?.expression === "window.devicePixelRatio" ? 2 : "complete" },
      };
    case "DOM.getContentQuads":
      return { quads: [[100, 200, 140, 200, 140, 220, 100, 220]] };
    case "Accessibility.getFullAXTree":
      return {
        nodes: [
          {
            nodeId: "1",
            role: { value: "RootWebArea" },
            name: { value: "Sign in" },
            childIds: ["2"],
          },
          {
            nodeId: "2",
            parentId: "1",
            role: { value: "button" },
            name: { value: "Continue" },
            backendDOMNodeId: 42,
          },
        ],
      };
    default:
      return {};
  }
}

/** A long page's tree: a list of the count of links given, each named at a snapshot's longest name. */
function longTree(count: number) {
  const links = Array.from({ length: count }, (_, at) => ({
    nodeId: `${at + 2}`,
    parentId: "1",
    role: { value: "link" },
    name: { value: `${at} ${"word ".repeat(40)}` },
    backendDOMNodeId: at + 100,
  }));
  return {
    nodes: [
      {
        nodeId: "1",
        role: { value: "RootWebArea" },
        name: { value: "Long" },
        childIds: links.map((link) => link.nodeId),
      },
      ...links,
    ],
  };
}

function fakeTab(
  id: string,
  url: string,
  capture: (shot: MacTabShot) => string | undefined = () => jpegOf(40_000),
  tree?: ReturnType<typeof longTree>,
): FakeTab {
  const heard: string[] = [];
  const shots: MacTabShot[] = [];
  let holders = 0;
  let stopped = false;
  let stopOn: string | undefined;
  return {
    heard,
    shots,
    held: () => holders > 0,
    stop: () => {
      stopped = true;
    },
    stopOn: (method) => {
      stopOn = method;
    },
    tab: {
      id,
      page: () => ({ url, title: "Sign in" }),
      stopped: () => stopped,
      capture: (shot) => {
        shots.push(shot);
        return Promise.resolve(capture(shot));
      },
      debugger: {
        attach: () => {
          holders += 1;
        },
        detach: () => {
          holders -= 1;
        },
        send: (method, params) => {
          if (method === stopOn) {
            stopped = true;
            return Promise.reject(new Error("Debugger is not attached"));
          }
          heard.push(method);
          if (tree !== undefined && method === "Accessibility.getFullAXTree") {
            return Promise.resolve(tree);
          }
          return Promise.resolve(pageAnswer(method, params));
        },
        onEvent: () => () => undefined,
      },
    },
  };
}

/** A task's tabs over fake ones, opening a fresh fake tab at the address an open names. */
function taskTabs(standing: readonly FakeTab[]) {
  const tabs = [...standing];
  const closed: string[] = [];
  const own: MacTaskTabs = {
    list: () => tabs.map((each) => each.tab),
    open: (url) => {
      const opened = fakeTab(`opened-${tabs.length}`, url);
      tabs.push(opened);
      return opened.tab;
    },
    close: (id) => {
      const at = tabs.findIndex((each) => each.tab.id === id);
      if (at < 0) return false;
      tabs.splice(at, 1);
      closed.push(id);
      return true;
    },
  };
  return { own, tabs, closed };
}

/** The window as a desk: the experiment on, the window open, a task shown, and each task's tabs. */
function desk(
  byTask: ReadonlyMap<string, MacTaskTabs>,
  standing: Partial<{ experiment: boolean; open: boolean; shown: string }> = {},
): MacBrowserDesk<"panel"> {
  return {
    experimentOn: () => standing.experiment ?? true,
    panel: () => ((standing.open ?? true) ? "panel" : undefined),
    shownTask: () => standing.shown ?? TASK,
    tabsOn: (_panel, taskId) =>
      byTask.get(taskId) ?? { list: () => [], open: () => undefined, close: () => false },
  };
}

const run = (
  over: MacBrowserDesk<"panel">,
  actions: readonly BrowserAgentAction[],
  taskId = TASK,
): Effect.Effect<MacCommandResult> =>
  runMacBrowserCommand(macBrowserTabsOver(over), { taskId, actions });

const refusalOf = (result: MacCommandResult): string =>
  "refused" in result ? result.refused : assert.fail("the command was not refused");

/** What a command ran, its output read as the run every browser answers (`browserAgentRunSchema`), and its image. */
const outputOf = (result: MacCommandResult) =>
  "output" in result
    ? {
        output: Schema.decodeUnknownSync(browserAgentRunSchema)(result.output),
        image: result.image,
      }
    : assert.fail("the command ran nothing");

it.effect(
  "the experiment off, the window closed, or a task neither shown nor holding a tab is refused in words",
  () =>
    Effect.gen(function* () {
      const list = [{ action: BROWSER_AGENT_ACTION.LIST }] as const;
      const off = yield* run(desk(new Map(), { experiment: false }), list);
      const closed = yield* run(desk(new Map(), { open: false }), list);
      const elsewhere = yield* run(desk(new Map(), { shown: OTHER_TASK }), list);

      assert.match(refusalOf(off), /Browser tab experiment is off/u);
      assert.match(refusalOf(closed), /window is closed/u);
      assert.match(refusalOf(elsewhere), /does not show this task/u);
    }),
);

it.effect(
  "a task's tabs are reached while the window shows the task, or holds a tab on it while showing another",
  () =>
    Effect.gen(function* () {
      const held = taskTabs([fakeTab("tab-a", "http://localhost:3000/")]);
      const list = [{ action: BROWSER_AGENT_ACTION.LIST }] as const;
      const shownEmpty = yield* run(desk(new Map()), list);
      const holding = yield* run(desk(new Map([[TASK, held.own]]), { shown: OTHER_TASK }), list);

      assert.deepEqual(outputOf(shownEmpty).output, {
        steps: [{ action: "list", status: "done", tabs: [] }],
        skipped: 0,
      });
      assert.deepEqual(outputOf(holding).output, {
        steps: [
          {
            action: "list",
            status: "done",
            tabs: [{ tab: "tab-a", url: "http://localhost:3000/", title: "Sign in" }],
          },
        ],
        skipped: 0,
      });
    }),
);

it.effect("an action lands on the tab it names, and none on a tab of another task", () =>
  Effect.gen(function* () {
    const first = fakeTab("tab-a", "http://localhost:3000/");
    const second = fakeTab("tab-b", "https://example.com/");
    const elsewhere = fakeTab("tab-c", "https://example.org/");
    const byTask = new Map([
      [TASK, taskTabs([first, second]).own],
      [OTHER_TASK, taskTabs([elsewhere]).own],
    ]);

    const clicked = yield* run(desk(byTask), [
      { action: BROWSER_AGENT_ACTION.CLICK, tab: "tab-b", ref: "e42" },
      { action: BROWSER_AGENT_ACTION.TYPE, text: "hello" },
    ]);
    const foreign = yield* run(desk(byTask), [
      { action: BROWSER_AGENT_ACTION.SNAPSHOT, tab: "tab-c" },
    ]);

    assert.deepEqual(outputOf(clicked).output, {
      steps: [
        { action: "click", status: "done", tab: "tab-b" },
        { action: "type", status: "done", tab: "tab-b" },
      ],
      skipped: 0,
    });
    assert.deepEqual(first.heard, []);
    assert.ok(second.heard.includes("Input.dispatchMouseEvent"));
    assert.ok(second.heard.includes("Input.insertText"));
    assert.deepEqual(elsewhere.heard, []);
    const [refused] = outputOf(foreign).output.steps;
    assert.deepEqual(refused, {
      action: "snapshot",
      status: "failed",
      tab: "tab-c",
      error: "there is no tab tab-c; list the tabs to see which are open",
    });
    assert.ok(
      ![first, second, elsewhere].some((each) => each.held()),
      "every debugger is given back",
    );
  }),
);

it.effect("an open opens a tab on the task, and the actions after it go on in that tab", () =>
  Effect.gen(function* () {
    const tabs = taskTabs([]);
    const result = yield* run(desk(new Map([[TASK, tabs.own]])), [
      { action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:5173/" },
      { action: BROWSER_AGENT_ACTION.SNAPSHOT },
      { action: BROWSER_AGENT_ACTION.CLOSE },
    ]);

    assert.deepEqual(outputOf(result).output, {
      steps: [
        { action: "open", status: "done", tab: "opened-0" },
        {
          action: "snapshot",
          status: "done",
          tab: "opened-0",
          url: "http://localhost:5173/",
          title: "Sign in",
          text: '- page "Sign in"\n  - button "Continue" [ref=e42]',
          truncated: false,
        },
        { action: "close", status: "done", tab: "opened-0" },
      ],
      skipped: 0,
    });
    assert.deepEqual(tabs.closed, ["opened-0"]);
  }),
);

it.effect(
  "a screenshot is caught downscaled to the cloud's longest side, at the first quality under the byte cap, and goes as the result's image",
  () =>
    Effect.gen(function* () {
      const small = jpegOf(120_000);
      const tab = fakeTab("tab-a", "http://localhost:3000/", (shot) =>
        shot.quality > 50 ? jpegOf(BROWSER_SCREENSHOT.MAX_BYTES + 1) : small,
      );
      const result = yield* run(desk(new Map([[TASK, taskTabs([tab]).own]])), [
        { action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "tab-a" },
      ]);

      const ran = outputOf(result);
      // A 1440-pixel-wide page at a ratio of two is 2880 pixels, scaled to 1280.
      assert.deepEqual(tab.shots, [
        { quality: 70, scale: 1280 / 2880 },
        { quality: 50, scale: 1280 / 2880 },
      ]);
      assert.deepEqual(ran.output, {
        steps: [
          {
            action: "screenshot",
            status: "done",
            tab: "tab-a",
            image: { mime: "image/jpeg", data: "", width: 1280, height: 800 },
          },
        ],
        skipped: 0,
      });
      assert.deepEqual(ran.image, { mediaType: MAC_COMMAND_IMAGE_TYPE.JPEG, data: small });
      assert.ok(Buffer.from(small, "base64").length <= BROWSER_SCREENSHOT.MAX_BYTES);
    }),
);

it.effect(
  "a tab the developer stopped refuses an agent's action, before it starts and as Stop is pressed mid-run",
  () =>
    Effect.gen(function* () {
      const stopped = fakeTab("tab-a", "http://localhost:3000/");
      stopped.stop();
      const before = yield* run(desk(new Map([[TASK, taskTabs([stopped]).own]])), [
        { action: BROWSER_AGENT_ACTION.CLICK, tab: "tab-a", x: 10, y: 10 },
        { action: BROWSER_AGENT_ACTION.SNAPSHOT },
      ]);
      const midway = fakeTab("tab-b", "https://example.com/");
      midway.stopOn("Input.insertText");
      const during = yield* run(desk(new Map([[TASK, taskTabs([midway]).own]])), [
        { action: BROWSER_AGENT_ACTION.CLICK, tab: "tab-b", x: 10, y: 10 },
        { action: BROWSER_AGENT_ACTION.TYPE, text: "secret" },
        { action: BROWSER_AGENT_ACTION.SNAPSHOT },
      ]);

      const [refused] = outputOf(before).output.steps;
      assert.ok(refused !== undefined && "error" in refused);
      assert.match(refused.error, /pressed Stop on this Browser tab/u);
      assert.equal(outputOf(before).output.skipped, 1);
      assert.deepEqual(stopped.heard, []);
      const steps = outputOf(during).output.steps;
      assert.deepEqual(
        steps.map((step) => step.status),
        ["done", "failed"],
      );
      const cut = steps[1];
      assert.ok(cut !== undefined && "error" in cut);
      assert.match(cut.error, /pressed Stop on this Browser tab/u);
      assert.equal(outputOf(during).output.skipped, 1);
      assert.ok(!midway.heard.includes("Accessibility.getFullAXTree"));
    }),
);

it.effect("a run of many long lists has each address cut to fit the output a result carries", () =>
  Effect.gen(function* () {
    const long = `https://example.com/${"path/".repeat(1_600)}`;
    const tabs = Array.from({ length: 5 }, (_, at) => fakeTab(`tab-${at}`, long));
    const lists = Array.from({ length: 10 }, () => ({ action: BROWSER_AGENT_ACTION.LIST }));
    const result = yield* run(desk(new Map([[TASK, taskTabs(tabs).own]])), lists);

    const { output } = outputOf(result);
    assert.ok(JSON.stringify(output).length <= MAC_COMMAND_BOUNDS.MAX_BROWSER_OUTPUT_CHARS);
    assert.equal(output.steps.length, 10);
    const [first] = output.steps;
    assert.ok(first !== undefined && "tabs" in first);
    assert.equal(first.tabs.length, 5);
    assert.ok(first.tabs.every((tab) => tab.url.length <= 200 && tab.url.startsWith("https://")));
  }),
);

it.effect(
  "a run of many long snapshots is held under the output a result carries, the latest snapshot whole",
  () =>
    Effect.gen(function* () {
      const tab = fakeTab("tab-a", "http://localhost:3000/", undefined, longTree(400));
      const snapshots = Array.from({ length: 6 }, () => ({
        action: BROWSER_AGENT_ACTION.SNAPSHOT,
        tab: "tab-a",
      }));
      const result = yield* run(desk(new Map([[TASK, taskTabs([tab]).own]])), snapshots);

      const { steps } = outputOf(result).output;
      assert.ok(
        JSON.stringify(outputOf(result).output).length <=
          MAC_COMMAND_BOUNDS.MAX_BROWSER_OUTPUT_CHARS,
      );
      assert.equal(steps.length, 6);
      const last = steps.at(-1);
      assert.ok(last !== undefined && "text" in last);
      assert.ok(last.text.length > 20_000, "the latest snapshot is read whole, to its own cap");
      const first = steps[0];
      assert.ok(first !== undefined && "text" in first);
      assert.deepEqual([first.text, first.truncated], ["", true]);
    }),
);

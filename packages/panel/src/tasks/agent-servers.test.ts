// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SIGN_IN } from "@repo/features/integration-sign-in";
import type { IntegrationToolsView } from "@repo/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationProvider,
  type IntegrationStatus,
  type IntegrationToolsProblemReason,
} from "@repo/features/integration-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { IntegrationStatuses } from "../integration-statuses.js";
import type { IntegrationServer } from "../live-reads.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdIntegrations, holdIntegrationTools } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { playListMotions } from "../testing/pane-motion.js";
import { AgentServersButton } from "./agent-servers.js";

/**
 * The MCP servers popover over a bridge answering each connected server's
 * tools as the service would: the servers under Connected and Not
 * connected, each connected one's switch, a search that finds servers, and
 * the keys that move through it. Synthetic servers and tools.
 */

const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const VERCEL = INTEGRATION_PROVIDER.VERCEL;

/** Where each provider stands; one absent here is not offered. */
const STANDING = new Map<string, IntegrationStatus>([
  [LINEAR, INTEGRATION_STATUS.CONNECTED],
  [VERCEL, INTEGRATION_STATUS.CONNECTED],
  [INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.DISCONNECTED],
]);

const roots: Root[] = [];

/** Each server's tools as the host holds them, its service answering as `toolsOf` says, beside the acts the test answers by now. */
function holdTools(toolsOf: (server: IntegrationServer) => IntegrationToolsView): void {
  holdIntegrationTools(handHostReads({}).deliverTools, toolsOf);
}

/** Each server's tools, one alike for every server, as a server that works lists them. */
const listed = (_server: IntegrationServer): IntegrationToolsView => ({
  tools: [{ name: "search", description: "Searches." }],
});

beforeEach(() => {
  fakeAppBridge({});
  fakeActPort({});
  holdTools(listed);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  releaseMotion();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

const statuses: IntegrationStatuses = {
  statusOf: (server) => STANDING.get(server) ?? INTEGRATION_STATUS.UNAVAILABLE,
  accountsOf: () => [],
  canAdd: () => false,
  listed: () => false,
  signInOf: () => undefined,
  readFailed: false,
  read: () => Promise.resolve(),
  signInBegun: () => undefined,
  cancelSignIn: () => Promise.resolve(true),
};

/** The chip over the servers, opened once every tools read has answered, keeping each switch it was asked for. */
async function opened(standing: IntegrationStatuses = statuses) {
  const switched: (readonly string[])[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (statuses: IntegrationStatuses) =>
    act(() =>
      root.render(
        withQueryClient(
          createElement(AgentServersButton, {
            servers: {
              disabled: [],
              onSwitch: (next) => switched.push(next),
              onOpenSettings: () => undefined,
            },
            statuses,
            face: "None",
          }),
        ),
      ),
    );
  render(standing);
  act(() =>
    container
      .querySelector<HTMLButtonElement>('.agent-servers button[aria-haspopup="dialog"]')
      ?.click(),
  );
  // Note that the servers' tools land on the document once their holds are taken, which says whether each connected server works.
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });
  const field = () =>
    container.querySelector<HTMLInputElement>('.agent-servers-menu input[type="text"]') ??
    assert.fail("no field");
  const key = (name: string) =>
    act(() => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    });
  const type = (text: string) =>
    act(() => {
      const input = field();
      // React hears a typed value through the native setter and an input event, as a keystroke would land.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  return { container, switched, field, key, type, render };
}

/** Each section's heading and its rows' names, as drawn. */
function sections(container: HTMLElement) {
  return [...container.querySelectorAll(".agent-servers-list ul")].map((group) => [
    group.getAttribute("aria-label"),
    [...group.querySelectorAll(".agent-servers-name")].map((name) => {
      // Note that a row names its account beside its provider, so the two read together as "Notion · Acme".
      const account = name.nextElementSibling?.classList.contains("ui-account-words")
        ? name.nextElementSibling.textContent
        : undefined;
      return account ? `${name.textContent} · ${account}` : name.textContent;
    }),
  ]);
}

/** The press of the home's row whose words hold `name`. */
function serverPress(container: HTMLElement, name: string): HTMLElement | undefined {
  return (
    [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")]
      .find((row) => row.textContent?.includes(name))
      ?.querySelector<HTMLElement>("button") ?? undefined
  );
}

/** The button saying `words` on the home's row whose name holds `name`. */
function serverButton(container: HTMLElement, name: string, words: string): HTMLButtonElement {
  const row = [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")].find((each) =>
    each.textContent?.includes(name),
  );
  return (
    [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === words,
    ) ?? assert.fail(`no ${words} on ${name}`)
  );
}

test("the servers stand under Connected and Not connected", async () => {
  const { container } = await opened();

  assert.deepEqual(sections(container), [
    ["Connected", ["Linear", "Vercel"]],
    ["Not connected", ["Mercury"]],
  ]);
});

test("a search finds servers by what they are for", async () => {
  const { container, type } = await opened();

  type("deployments");

  assert.deepEqual(sections(container), [["Connected", ["Vercel"]]]);
});

test("the arrows move the highlight, and Enter flips the highlighted server's switch", async () => {
  const { container, key, switched } = await opened();

  key("ArrowDown");
  assert.equal(
    container.querySelector('.agent-servers-list li:has([aria-current="true"]) .agent-servers-name')
      ?.textContent,
    "Vercel",
  );
  key("Enter");

  assert.deepEqual(switched, [[VERCEL]]);
});

test("a press on a connected server's row flips its switch", async () => {
  const { container, switched } = await opened();

  act(() => serverPress(container, "Linear")?.click());

  assert.deepEqual(switched, [[LINEAR]]);
});

test("two accounts at a provider stand as two rows, each named by its label, and one switched off leaves the other on", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  const accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",

      status: INTEGRATION_STATUS.CONNECTED,
    },
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",

      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const two: IntegrationStatuses = {
    ...statuses,
    statusOf: (server) =>
      server === notion || server === "notion-2"
        ? INTEGRATION_STATUS.CONNECTED
        : INTEGRATION_STATUS.UNAVAILABLE,
    accountsOf: (provider) => (provider === notion ? accounts : []),
  };
  const { container, switched } = await opened(two);

  assert.deepEqual(sections(container), [["Connected", ["Notion · Acme", "Notion · Personal"]]]);
  act(() =>
    [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")]
      .find((row) => row.textContent?.includes("Personal"))
      ?.querySelector<HTMLElement>('[role="switch"]')
      ?.click(),
  );
  assert.deepEqual(switched, [["notion-2"]]);
});

/** The host holding where each provider stands, and the act port answering each server's tools, Linear's with `problem`, as the service would. */
function answerLinear(problem: {
  readonly reason: IntegrationToolsProblemReason;
  readonly message?: string;
}): void {
  fakeActPort({});
  holdTools((server) =>
    (server.connection ?? server.provider) === LINEAR ? { problem } : listed(server),
  );
  holdIntegrations(() => ({
    rows: {
      // SAFETY: the entries are made from INTEGRATION_PROVIDER_LIST, one for every provider, which is the record's every key.
      integrations: Object.fromEntries(
        INTEGRATION_PROVIDER_LIST.map((provider) => [
          provider,
          STANDING.get(provider) ?? INTEGRATION_STATUS.UNAVAILABLE,
        ]),
      ) as Record<IntegrationProvider, IntegrationStatus>,
    },
  }));
}

/** The act port answering as `answerLinear` does, Linear's sign-in refused. */
function answerLinearRefused(): void {
  answerLinear({ reason: INTEGRATION_TOOLS_PROBLEM.REFUSED });
}

test("a server's problem fades where its row cuts it short, as every cut line of the app does, rather than ending in an ellipsis", async () => {
  answerLinearRefused();
  const { container } = await opened();

  const problem = await vi.waitFor(
    () => container.querySelector(".agent-servers-problem") ?? assert.fail("no problem"),
  );
  assert.equal(problem?.textContent, "Linear refused the sign-in.");
});

test("a server's own error is no part of its row's sentence, and stands quoted in the hint its problem hangs", async () => {
  answerLinear({
    reason: INTEGRATION_TOOLS_PROBLEM.REJECTED,
    message: "workspace is suspended",
  });
  const { container } = await opened();
  const problem = await vi.waitFor(
    () => container.querySelector(".agent-servers-problem") ?? assert.fail("no problem"),
  );
  const words = problem.textContent;

  restOn(problem);

  assert.equal(words, "Linear could not be reached.");
  assert.equal(
    document.querySelector('[role="tooltip"]')?.textContent,
    "Linear could not be reached. Linear said: “workspace is suspended”",
  );
});

/** The words on each button standing on `name`'s row, with whether it is busy or off. */
function buttonsOf(container: HTMLElement, name: string) {
  const row = [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")].find((each) =>
    each.textContent?.includes(name),
  );
  // Note that the row's own press holds its name; what stands beside it is the row's buttons.
  const beside = [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter(
    (button) => button.querySelector(".agent-servers-name") === null,
  );
  return beside.map((button) => ({
    words: button.textContent,
    busy: button.getAttribute("aria-busy") === "true",
    off: button.disabled,
  }));
}

test("a Connect shows it is working until the browser has been sent to sign in", async () => {
  const connect = Promise.withResolvers<{ opened: true }>();
  fakeActPort({
    [ACT_KIND.INTEGRATIONS_CONNECT]: () => connect.promise,
  });
  holdTools(() => ({ tools: [] }));
  const { container } = await opened();
  assert.deepEqual(buttonsOf(container, "Mercury"), [
    { words: "Connect", busy: false, off: false },
  ]);

  await act(async () => serverButton(container, "Mercury", "Connect").click());

  assert.deepEqual(
    buttonsOf(container, "Mercury").map(({ busy, off }) => [busy, off]),
    [[true, false]],
  );
  await act(async () => connect.resolve({ opened: true }));
  assert.deepEqual(
    buttonsOf(container, "Mercury").map(({ busy }) => busy),
    [false],
  );
});

test("a Cancel shows it is working while Reopen waits, and a sign-in that failed offers Retry", async () => {
  const cancel = Promise.withResolvers<boolean>();
  const waiting = { kind: SIGN_IN.WAITING, since: 1, deadline: 1000, seenPending: true } as const;
  const failed = { kind: SIGN_IN.FAILED, since: 2 } as const;
  const { container } = await opened({
    ...statuses,
    signInOf: (server) => (server === INTEGRATION_PROVIDER.MERCURY ? waiting : undefined),
    cancelSignIn: () => cancel.promise,
  });
  assert.deepEqual(
    buttonsOf(container, "Mercury").map(({ words }) => words),
    ["Reopen", "Cancel"],
  );

  await act(async () => serverButton(container, "Mercury", "Cancel").click());

  assert.deepEqual(
    buttonsOf(container, "Mercury").map(({ words, busy, off }) => [words, busy, off]),
    [
      ["Reopen", false, true],
      ["Cancel", true, false],
    ],
  );
  await act(async () => cancel.resolve(true));
  assert.deepEqual(
    buttonsOf(container, "Mercury").map(({ busy, off }) => [busy, off]),
    [
      [false, false],
      [false, false],
    ],
  );

  const { container: after } = await opened({
    ...statuses,
    signInOf: (server) => (server === INTEGRATION_PROVIDER.MERCURY ? failed : undefined),
  });
  assert.deepEqual(
    buttonsOf(after, "Mercury").map(({ words }) => words),
    ["Retry"],
  );
});

/** The popover's panel in `container`, while it is drawn. */
function panelIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="dialog"]');
}

/** One exit running on every panel that is ending, as the engine would run its fade, until `finish` ends them: jsdom plays no motion of its own. */
function holdPanelExits() {
  const exits: EventTarget[] = [];
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value(this: Element) {
      if (!this.hasAttribute("data-ending-style")) return [];
      const exit = new EventTarget();
      exits.push(exit);
      return [exit];
    },
  });
  return () => {
    for (const exit of exits.splice(0)) exit.dispatchEvent(new Event("finish"));
  };
}

test("Escape from the home fades the popover out, inert and ending, then takes it away, and it opens afresh", async () => {
  const finishExits = holdPanelExits();
  const { container, key, type, field } = await opened();
  const button = () =>
    container.querySelector<HTMLButtonElement>('.agent-servers button[aria-haspopup="dialog"]') ??
    assert.fail("no button");
  type("deploy");

  key("Escape");
  const fading = panelIn(container);
  const ending = fading?.hasAttribute("data-ending-style");
  const inert = fading?.hasAttribute("inert");
  const expanded = button().getAttribute("aria-expanded");
  act(() => finishExits());
  const gone = panelIn(container) === null;
  act(() => button().click());
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });

  assert.ok(fading, "the popover stands while it fades");
  assert.equal(ending, true, "it is in its ending state");
  assert.equal(inert, true, "it takes nothing while it fades");
  assert.equal(expanded, "false", "its button already says it is closed");
  assert.equal(gone, true, "it goes once its fade has run");
  assert.equal(field().value, "", "opened again it holds no search from before");
});

test("a popover opened again while it fades out hands its field the focus, so the keys still reach it", async () => {
  holdPanelExits();
  const { container, key, field } = await opened();
  const button = () =>
    container.querySelector<HTMLButtonElement>('.agent-servers button[aria-haspopup="dialog"]') ??
    assert.fail("no button");

  key("Escape");
  act(() => button().click());
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });

  // Note that the elements are compared as one boolean, because a failed equality prints both whole.
  assert.equal(document.activeElement === field(), true, "the field holds the focus");
});

test("Escape from the home takes the popover away at once where motion is held", async () => {
  holdPanelExits();
  holdMotion();
  const { container, key } = await opened();

  key("Escape");

  assert.equal(panelIn(container), null);
});

/** How tall a row is drawn, in the layout given. */
const ROW = 40;

/** Each row standing under the rows before it in the list, as a layout would; jsdom lays nothing out. */
function layRowsInOrder() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const rows = [...(this.closest(".agent-servers-list")?.querySelectorAll("li") ?? [])];
    const top = this.matches("li") ? rows.indexOf(this) * ROW : 0;
    return { top, bottom: top + ROW, left: 0, right: 0, width: 0, height: ROW } as DOMRect;
  });
}

/** The statuses with `provider` standing as `standing`. */
function withStanding(provider: string, standing: IntegrationStatus): IntegrationStatuses {
  return {
    ...statuses,
    statusOf: (server) => (server === provider ? standing : statuses.statusOf(server)),
  };
}

test("a server that connects glides from Not connected into Connected, followed by its connection", async () => {
  const motions = playListMotions();
  try {
    const { container, render } = await opened();
    layRowsInOrder();
    const mercury = () =>
      [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")].find((row) =>
        row.textContent?.includes("Mercury"),
      ) ?? assert.fail("no Mercury row");
    assert.equal(mercury().dataset.motionKey, INTEGRATION_PROVIDER.MERCURY);

    render(withStanding(INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.CONNECTED));
    await act(async () => {
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });

    assert.deepEqual(sections(container), [["Connected", ["Linear", "Mercury", "Vercel"]]]);
    const glide = motions.played.find((each) => each.element === mercury());
    assert.deepEqual(glide?.keyframes[0], { transform: `translate(0px, ${ROW}px)` });
  } finally {
    motions.remove();
  }
});

test("with motion held still, a server that connects takes its place and nothing plays", async () => {
  const motions = playListMotions();
  try {
    for (const name of ["--ui-duration-exit", "--ui-duration-shape"]) {
      document.documentElement.style.setProperty(name, "0ms");
    }
    const { container, render } = await opened();
    layRowsInOrder();

    render(withStanding(INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.CONNECTED));

    assert.deepEqual(sections(container), [["Connected", ["Linear", "Mercury", "Vercel"]]]);
    assert.deepEqual(motions.played, []);
  } finally {
    motions.remove();
  }
});

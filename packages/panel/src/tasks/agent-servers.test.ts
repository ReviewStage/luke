// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { IntegrationTool } from "@repo/features/integration-health";
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
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { IntegrationStatuses } from "../integration-statuses.js";
import type { IntegrationServer } from "../live-reads.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdIntegrations, holdIntegrationTools } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { playListMotions } from "../testing/pane-motion.js";
import { AgentServersButton } from "./agent-servers.js";

const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const VERCEL = INTEGRATION_PROVIDER.VERCEL;

const STANDING = new Map<string, IntegrationStatus>([
  [LINEAR, INTEGRATION_STATUS.CONNECTED],
  [VERCEL, INTEGRATION_STATUS.CONNECTED],
  [INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.DISCONNECTED],
]);

const TOOLS = new Map<string, readonly IntegrationTool[]>([
  [
    LINEAR,
    [{ name: "list_issues", description: "Lists issues.", annotations: { readOnlyHint: true } }],
  ],
  [
    VERCEL,
    [
      {
        name: "delete_project",
        description: "Deletes a project.",
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      { name: "delete_domain", description: "Removes a domain." },
      { name: "get_deployment", description: "Reads one deployment." },
      {
        name: "read_project",
        title: "Read project",
        description: "Reads one project.\n\n## Returns\n\nIts `framework` and domains.",
        annotations: { readOnlyHint: true, openWorldHint: false },
        parameters: [
          { name: "teamId", type: "string", required: false },
          {
            name: "idOrName",
            type: "string",
            required: true,
            description: "The project's id or name.",
          },
          {
            name: "format",
            type: "enum",
            required: false,
            values: ["json", "text"],
            default: "json",
          },
        ],
      },
    ],
  ],
]);

const roots: Root[] = [];

function holdTools(toolsOf: (server: IntegrationServer) => IntegrationToolsView): void {
  holdIntegrationTools(handHostReads({}).deliverTools, toolsOf);
}

const listed = (server: IntegrationServer): IntegrationToolsView => ({
  tools: TOOLS.get(server.connection ?? server.provider) ?? [],
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

async function opened(standing: IntegrationStatuses = statuses) {
  const switched: (readonly string[])[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const render = (statuses: IntegrationStatuses) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
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
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });
  await vi.waitFor(() =>
    assert.equal(
      [...container.querySelectorAll('.agent-servers-list ul[aria-label="Connected"] > li')].every(
        (row) => row.querySelector(".ui-list-row-meta, .agent-servers-problem") !== null,
      ),
      true,
    ),
  );
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
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  return { container, switched, field, key, type, render };
}

function sections(container: HTMLElement) {
  return [...container.querySelectorAll(".agent-servers-list ul")].map((group) => [
    group.getAttribute("aria-label"),
    [...group.querySelectorAll(".agent-servers-name")].map((name) => {
      const account = name.nextElementSibling?.classList.contains("ui-account-words")
        ? name.nextElementSibling.textContent
        : undefined;
      return account ? `${name.textContent} · ${account}` : name.textContent;
    }),
  ]);
}

function tools(container: HTMLElement) {
  return [...container.querySelectorAll('ul[aria-label$=" tools"] > li')].map((tool) => [
    (tool.querySelector(".integration-tool-id") ?? tool.querySelector(".integration-tool-title"))
      ?.textContent,
    tool.querySelector(".ui-quiet-words")?.textContent,
  ]);
}

function serverPress(container: HTMLElement, name: string): HTMLElement | undefined {
  return (
    [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")]
      .find((row) => row.textContent?.includes(name))
      ?.querySelector<HTMLElement>("button") ?? undefined
  );
}

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

function openVercel(container: HTMLElement) {
  act(() => serverPress(container, "Vercel")?.click());
}

function highlighted(container: HTMLElement) {
  const row = container.querySelector('ul[aria-label$=" tools"] > li:has([aria-current="true"])');
  return (
    row?.querySelector(".integration-tool-id") ?? row?.querySelector(".integration-tool-title")
  )?.textContent;
}

function keyAtFocus(name: string) {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

test("the servers stand under Connected and Not connected, each connected one with its count", async () => {
  const { container } = await opened();

  assert.deepEqual(sections(container), [
    ["Connected", ["Linear", "Vercel"]],
    ["Not connected", ["Mercury"]],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll(".agent-servers-list .ui-list-row-meta")].map(
      (count) => count.textContent,
    ),
    ["1 tool", "4 tools"],
  );
});

test("pressing a connected server opens its tools in place, each badged only as its server annotated it", async () => {
  const { container } = await opened();

  act(() => serverPress(container, "Vercel")?.click());

  assert.equal(container.querySelector(".agent-servers-page-title")?.textContent, "Vercel");
  assert.deepEqual(tools(container), [
    ["delete_domain", undefined],
    ["delete_project", "Destructive"],
    ["get_deployment", undefined],
    ["read_project", "Read-only"],
  ]);
});

test("a search finds a server and its tools, Enter opens its page filtered to them, and Escape goes back before it closes", async () => {
  const { container, key, type, field } = await opened();

  type("deploy");
  assert.deepEqual(
    [...container.querySelectorAll(".agent-servers-list li .integration-tool-id")].map(
      (hit) => hit.textContent,
    ),
    ["get_deployment"],
  );
  key("Enter");
  assert.equal(container.querySelector(".agent-servers-page-title")?.textContent, "Vercel");
  assert.equal(field().value, "deploy");
  assert.deepEqual(tools(container), [["get_deployment", undefined]]);

  key("Escape");
  assert.equal(container.querySelector(".agent-servers-page-title"), null);
  key("Escape");
  assert.equal(container.querySelector(".agent-servers-menu"), null);
});

test("a tool found by its server's name and its own, Enter opens its server's page still showing it", async () => {
  const { container, key, type, field } = await opened();

  type("vercel get");
  key("Enter");

  assert.equal(container.querySelector(".agent-servers-page-title")?.textContent, "Vercel");
  assert.equal(field().value, "vercel get");
  assert.deepEqual(tools(container), [["get_deployment", undefined]]);
});

test("the arrows move the highlight, and Space on an empty search flips the highlighted server's switch", async () => {
  const { container, key, switched } = await opened();

  key("ArrowDown");
  assert.equal(
    container.querySelector('.agent-servers-list li:has([aria-current="true"]) .agent-servers-name')
      ?.textContent,
    "Vercel",
  );
  key(" ");

  assert.deepEqual(switched, [[VERCEL]]);
});

test("a server page's back is hinted \"Back to Integrations\", names no key since the popover's own keys step back, and returns to the servers", async () => {
  const { container } = await opened();
  openVercel(container);
  const back =
    container.querySelector<HTMLButtonElement>(
      ".agent-servers-page-head > .ui-folding-button button",
    ) ?? assert.fail("no back on the page");

  restOn(back);
  const hint = document.querySelector('[role="tooltip"]:not([inert])');

  assert.equal(hint?.textContent, "Back to Integrations");
  assert.equal(back.getAttribute("aria-keyshortcuts"), null);
  act(() => back.click());
  assert.equal(container.querySelector(".agent-servers-page-title"), null);
});

test("a pointer's press on a server page's switch leaves the focus in the filter, so Backspace still goes back", async () => {
  const { container, key, switched } = await opened();
  act(() => serverPress(container, "Vercel")?.click());
  const toggle =
    container.querySelector<HTMLButtonElement>('.agent-servers-page-head [role="switch"]') ??
    assert.fail("no switch on the page");

  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    toggle.dispatchEvent(press);
    toggle.click();
  });
  key("Backspace");

  assert.equal(press.defaultPrevented, true);
  assert.deepEqual(switched, [[VERCEL]]);
  assert.equal(container.querySelector(".agent-servers-page-title"), null);
});

test("on a server's page the arrows move the highlight, and Enter opens the tool's page: its title and name, its server's hints, what it does rendered, and its parameters, the required first", async () => {
  const { container, key } = await opened();
  openVercel(container);

  assert.equal(highlighted(container), "delete_domain");
  key("ArrowDown");
  key("ArrowDown");
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(highlighted(container), "read_project");
  key("Enter");

  const page = container.querySelector(".integration-tool-detail") ?? assert.fail("no tool page");
  assert.equal(page.querySelector(".integration-tool-detail-title")?.textContent, "Read project");
  assert.equal(page.querySelector(".integration-tool-detail-name")?.textContent, "read_project");
  assert.deepEqual(
    [...page.querySelectorAll(".integration-tool-hints li")].map((hint) => hint.textContent),
    ["Read-only", "Only Vercel's own data"],
  );
  assert.equal(page.querySelector(".ui-markdown-heading")?.textContent, "Returns");
  assert.equal(
    page.querySelector(".integration-tool-description-whole code")?.textContent,
    "framework",
  );
  assert.deepEqual(
    [...page.querySelectorAll(".integration-tool-parameter")].map((parameter) => [
      parameter.querySelector(".integration-tool-parameter-name")?.textContent,
      parameter.querySelector(".integration-tool-parameter-required") !== null,
    ]),
    [
      ["idOrName", true],
      ["teamId", false],
      ["format", false],
    ],
  );
  assert.deepEqual(
    [...page.querySelectorAll(".integration-tool-parameter-values code")].map((value) => [
      value.textContent,
      value.getAttribute("data-default"),
    ]),
    [
      ["json", "true"],
      ["text", null],
    ],
  );
  assert.equal(
    document.getElementById(
      container.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby") ?? "",
    )?.textContent,
    "Read project",
  );
  assert.equal(
    document.activeElement,
    page.querySelector(".integration-tool-detail-body")?.parentElement,
  );
});

test("Escape, Left, and Backspace on a tool's page each go back to its server's page, the filter and the highlight as they were", async () => {
  const { container, key, type, field } = await opened();
  openVercel(container);
  type("project");
  key("ArrowDown");
  assert.equal(highlighted(container), "read_project");

  for (const back of ["Escape", "ArrowLeft", "Backspace"]) {
    key("Enter");
    assert.notEqual(container.querySelector(".integration-tool-detail"), null);
    keyAtFocus(back);
    assert.equal(container.querySelector(".integration-tool-detail"), null, back);
    assert.equal(container.querySelector(".agent-servers-page-title")?.textContent, "Vercel");
    assert.equal(field().value, "project");
    assert.equal(highlighted(container), "read_project");
    assert.equal(document.activeElement, field());
  }

  key("Escape");
  assert.equal(container.querySelector(".agent-servers-page-title"), null);
  key("Escape");
  assert.equal(container.querySelector(".agent-servers-menu"), null);
});

test("on a server's page the pointer coming onto a tool's row moves the highlight to it", async () => {
  const { container } = await opened();
  openVercel(container);
  assert.equal(highlighted(container), "delete_domain");
  const row =
    [
      ...container.querySelectorAll<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button'),
    ].find((button) => button.textContent?.startsWith("delete_project")) ??
    assert.fail("delete_project has its row");

  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });

  assert.equal(highlighted(container), "delete_project");
});

test("a press on a tool opens its page with the popover standing open, and its back goes back to the server's page", async () => {
  const { container } = await opened();
  openVercel(container);
  const head =
    [
      ...container.querySelectorAll<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button'),
    ].find((button) => button.textContent?.startsWith("delete_project")) ??
    assert.fail("delete_project has its row");

  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    head.dispatchEvent(press);
    head.click();
  });

  assert.equal(press.defaultPrevented, true);
  assert.notEqual(container.querySelector(".agent-servers-menu"), null);
  assert.equal(
    container.querySelector(".integration-tool-detail-title")?.textContent,
    "delete_project",
  );
  assert.equal(container.querySelector(".integration-tool-detail-name"), null);
  assert.deepEqual(
    [...container.querySelectorAll(".integration-tool-hints li")].map((hint) => hint.textContent),
    ["Destructive"],
  );

  act(() =>
    container.querySelector<HTMLButtonElement>(".integration-tool-detail-head button")?.click(),
  );
  assert.equal(container.querySelector(".integration-tool-detail"), null);
  assert.equal(container.querySelector(".agent-servers-page-title")?.textContent, "Vercel");
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
      integrations: Object.fromEntries(
        INTEGRATION_PROVIDER_LIST.map((provider) => [
          provider,
          STANDING.get(provider) ?? INTEGRATION_STATUS.UNAVAILABLE,
        ]),
      ) as Record<IntegrationProvider, IntegrationStatus>,
    },
  }));
}

function answerLinearRefused(): void {
  answerLinear({ reason: INTEGRATION_TOOLS_PROBLEM.REFUSED });
}

test("a server's problem fades where its row cuts it short, as every cut line of the app does, rather than ending in an ellipsis", async () => {
  answerLinearRefused();
  const { container } = await opened();

  const problem = container.querySelector(".agent-servers-problem");
  assert.equal(problem?.textContent, "Linear refused the sign-in.");
});

test("a server's own error is no part of its row's sentence, and stands quoted in the card its row hangs", async () => {
  answerLinear({
    reason: INTEGRATION_TOOLS_PROBLEM.REJECTED,
    message: "workspace is suspended",
  });
  const { container } = await opened();
  const problem = container.querySelector(".agent-servers-problem") ?? assert.fail("no problem");
  const words = problem.textContent;

  restOn(problem);
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const card = [...document.querySelectorAll(".ui-tooltip-card > [data-server-card]")].at(-1);

  assert.equal(words, "Linear could not be reached.");
  assert.ok(
    [...(card?.querySelectorAll(".ui-hover-card-note") ?? [])].some(
      (note) => note.textContent === "Linear said: “workspace is suspended”",
    ),
    "the server's card says the server's own words",
  );
});

test("a server's row hangs the server's card beside it, and a tool a search found hangs the card of its tool", async () => {
  answerLinearRefused();
  const { container, type } = await opened();

  restOn(serverPress(container, "Vercel") ?? assert.fail("no Vercel row"));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const card = [...document.querySelectorAll(".ui-tooltip-card > [data-server-card]")].at(-1);
  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "Vercel");
  assert.equal(card?.querySelector(".ui-hover-card-sub")?.textContent, "4 tools");

  type("get_deployment");
  restOn(
    [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")]
      .find((row) => row.textContent?.includes("get_deployment"))
      ?.querySelector<HTMLElement>("button") ?? assert.fail("no tool row"),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const toolCard = [...document.querySelectorAll(".ui-tooltip-card > [data-server-card]")].at(-1);
  assert.equal(toolCard?.querySelector(".ui-hover-card-name")?.textContent, "Vercel");
  assert.equal(toolCard?.querySelectorAll('ul[aria-label$=" tools"] > li').length, 1);
});

test("a server that is not connected hangs its card too, though its press is no page", async () => {
  const { container } = await opened();

  const press = serverPress(container, "Mercury") ?? assert.fail("no Mercury row");
  restOn(press);
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  const card = [...document.querySelectorAll(".ui-tooltip-card > [data-server-card]")].at(-1);
  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "Mercury");
  assert.equal(
    container.querySelectorAll(".agent-servers-list .ui-list-row-chevron").length,
    2,
    "only the two servers with tools say they open a page",
  );
});

function buttonsOf(container: HTMLElement, name: string) {
  const row = [...container.querySelectorAll<HTMLElement>(".agent-servers-list li")].find((each) =>
    each.textContent?.includes(name),
  );
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

test("a connected server that lists no tools has no page to open, so a press on its row flips its switch", async () => {
  fakeActPort({});
  holdTools((server) =>
    (server.connection ?? server.provider) === LINEAR ? { tools: [] } : listed(server),
  );
  const { container, switched } = await opened();

  act(() => serverPress(container, "Linear")?.click());

  assert.deepEqual(switched, [[LINEAR]]);
});

function panelIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="dialog"]');
}

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

test("Escape from the home takes the popover away at once where motion is held", async () => {
  holdPanelExits();
  holdMotion();
  const { container, key } = await opened();

  key("Escape");

  assert.equal(panelIn(container), null);
});

const ROW = 40;

function layRowsInOrder() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const rows = [...(this.closest(".agent-servers-list")?.querySelectorAll("li") ?? [])];
    const top = this.matches("li") ? rows.indexOf(this) * ROW : 0;
    return { top, bottom: top + ROW, left: 0, right: 0, width: 0, height: ROW } as DOMRect;
  });
}

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

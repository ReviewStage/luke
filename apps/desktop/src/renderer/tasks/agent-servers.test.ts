// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { IntegrationTool } from "@luke/features/integration-health";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { IntegrationStatuses } from "@luke/panel/integration-statuses";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { AgentServersButton } from "./agent-servers";

/**
 * The MCP servers popover over a bridge answering each connected server's
 * tools as the service would: the servers under Connected and Not
 * connected, a connected server's page in the popover's place with its
 * tools and the badges its server's annotations earn them, a search that
 * finds a tool and opens its server's page, and the keys that move through
 * it. Synthetic servers and tools.
 */

const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const VERCEL = INTEGRATION_PROVIDER.VERCEL;

/** Where each provider stands; one absent here is not offered. */
const STANDING = new Map<string, IntegrationStatus>([
  [LINEAR, INTEGRATION_STATUS.CONNECTED],
  [VERCEL, INTEGRATION_STATUS.CONNECTED],
  [INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.DISCONNECTED],
]);

/** Each connected server's tools, as its server listed them. */
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

beforeEach(() => {
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.INTEGRATIONS_TOOLS
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: {
                tools: TOOLS.get(request.payload.connection ?? request.payload.provider) ?? [],
              },
            }
          : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
      ),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const statuses: IntegrationStatuses = {
  statusOf: (server) => STANDING.get(server) ?? INTEGRATION_STATUS.UNAVAILABLE,
  accountsOf: () => [],
  canAdd: () => false,
  listed: () => false,
  signInOf: () => undefined,
  readFailed: false,
  read: () => Promise.resolve(),
  settle: () => undefined,
  signInBegun: () => undefined,
  cancelSignIn: () => Promise.resolve(true),
};

/** The button over the servers, opened once every tools read has answered, keeping each switch it was asked for. */
async function opened(standing: IntegrationStatuses = statuses) {
  const switched: (readonly string[])[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AgentServersButton, {
        servers: {
          disabled: [],
          onSwitch: (next) => switched.push(next),
          onOpenSettings: () => undefined,
        },
        statuses: standing,
      }),
    ),
  );
  act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-label="MCP servers"]')?.click(),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const field = () =>
    container.querySelector<HTMLInputElement>(".agent-servers-menu input") ??
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
  return { container, switched, field, key, type };
}

/** Each section's heading and its rows' names, as drawn. */
function sections(container: HTMLElement) {
  return [...container.querySelectorAll(".agent-servers-list > ul")].map((group) => [
    group.getAttribute("aria-label"),
    [...group.querySelectorAll(".agent-servers-name")].map((name) => name.textContent),
  ]);
}

/** Each tool on a server's page: its name and its badge, where it wears one. */
function tools(container: HTMLElement) {
  return [...container.querySelectorAll('ul[aria-label$=" tools"] > li')].map((tool) => [
    (tool.querySelector(".integration-tool-id") ?? tool.querySelector(".integration-tool-title"))
      ?.textContent,
    tool.querySelector(".luke-badge")?.textContent,
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

/** Opens Vercel's page from the popover's home. */
function openVercel(container: HTMLElement) {
  act(() => serverPress(container, "Vercel")?.click());
}

/** The name of the tool a server's page holds highlighted. */
function highlighted(container: HTMLElement) {
  const row = container.querySelector('ul[aria-label$=" tools"] > li:has([aria-current="true"])');
  return (
    row?.querySelector(".integration-tool-id") ?? row?.querySelector(".integration-tool-title")
  )?.textContent;
}

/** A key pressed wherever the focus stands, as a keyboard's lands. */
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
    [...container.querySelectorAll(".agent-servers-count")].map((count) => count.textContent),
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

test("a pointer's press on a server page's switch leaves the focus in the filter, so Backspace still goes back", async () => {
  const { container, key, switched } = await opened();
  act(() => serverPress(container, "Vercel")?.click());
  const toggle =
    container.querySelector<HTMLButtonElement>('.agent-servers-page-head [role="switch"]') ??
    assert.fail("no switch on the page");

  // Note that the browser moves the focus on a press unless its mousedown is refused, which jsdom does not act out.
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
  assert.equal(page.querySelector(".markdown-heading")?.textContent, "Returns");
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
  assert.equal(document.activeElement, page.querySelector(".integration-tool-detail-body"));
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

  // Note that the browser moves the focus on a press unless its mousedown is refused, which jsdom does not act out.
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
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Back to Vercel tools"]')
      ?.click(),
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

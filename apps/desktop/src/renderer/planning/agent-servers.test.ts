// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/features/integration-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import type { IntegrationTool } from "../integration-health";
import type { IntegrationStatuses } from "../integration-statuses";
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
const STANDING = new Map<IntegrationProvider, IntegrationStatus>([
  [LINEAR, INTEGRATION_STATUS.CONNECTED],
  [VERCEL, INTEGRATION_STATUS.CONNECTED],
  [INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.DISCONNECTED],
]);

/** Each connected server's tools, as its server listed them. */
const TOOLS = new Map<IntegrationProvider, readonly IntegrationTool[]>([
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
    ],
  ],
]);

const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.INTEGRATIONS_TOOLS
            ? {
                status: ACT_OUTCOME_STATUS.DONE,
                value: { tools: TOOLS.get(request.payload.provider) ?? [] },
              }
            : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
        ),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const statuses: IntegrationStatuses = {
  statusOf: (provider) => STANDING.get(provider) ?? INTEGRATION_STATUS.UNAVAILABLE,
  signInOf: () => undefined,
  readFailed: false,
  read: () => Promise.resolve(),
  settle: () => undefined,
  signInBegun: () => undefined,
  cancelSignIn: () => Promise.resolve(true),
};

/** The button over the servers, opened once every tools read has answered, keeping each switch it was asked for. */
async function opened() {
  const switched: (readonly IntegrationProvider[])[] = [];
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
        statuses,
      }),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>(".agent-servers-button")?.click());
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
  return [...container.querySelectorAll('.agent-servers-menu [role="group"]')].map((group) => [
    group.querySelector(".menu-heading")?.textContent,
    [...group.querySelectorAll(".agent-servers-row .plan-compose-menu-name")].map(
      (name) => name.textContent,
    ),
  ]);
}

/** Each tool on a server's page: its name and its badge, where it wears one. */
function tools(container: HTMLElement) {
  return [...container.querySelectorAll(".integration-tool")].map((tool) => [
    tool.querySelector(".integration-tool-id")?.textContent,
    tool.querySelector(".integration-tool-badge")?.textContent,
  ]);
}

test("the servers stand under Connected and Not connected, each connected one with its count", async () => {
  const { container } = await opened();

  assert.deepEqual(sections(container), [
    ["Connected", ["Linear", "Vercel"]],
    ["Not connected", ["Mercury"]],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll(".agent-servers-count")].map((count) => count.textContent),
    ["1 tool", "3 tools"],
  );
});

test("pressing a connected server opens its tools in place, each badged only as its server annotated it", async () => {
  const { container } = await opened();

  act(() =>
    [...container.querySelectorAll<HTMLElement>(".agent-servers-row")]
      .find((row) => row.textContent?.includes("Vercel"))
      ?.click(),
  );

  assert.equal(container.querySelector(".agent-servers-page-title")?.textContent, "Vercel");
  assert.deepEqual(tools(container), [
    ["delete_domain", undefined],
    ["delete_project", "Destructive"],
    ["get_deployment", undefined],
  ]);
});

test("a search finds a server and its tools, Enter opens its page filtered to them, and Escape goes back before it closes", async () => {
  const { container, key, type, field } = await opened();

  type("deploy");
  assert.deepEqual(
    [...container.querySelectorAll(".agent-servers-hit .integration-tool-id")].map(
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
    container.querySelector('.agent-servers-row[data-highlighted="true"] .plan-compose-menu-name')
      ?.textContent,
    "Vercel",
  );
  key(" ");

  assert.deepEqual(switched, [[VERCEL]]);
});

test("a pointer's press on a server page's switch leaves the focus in the filter, so Backspace still goes back", async () => {
  const { container, key, switched } = await opened();
  act(() =>
    [...container.querySelectorAll<HTMLElement>(".agent-servers-row")]
      .find((row) => row.textContent?.includes("Vercel"))
      ?.click(),
  );
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

test("pressing a tool opens it in place onto its whole description, the popover open and its filter still hearing the keys; a second press closes it", async () => {
  const { container, key } = await opened();
  act(() =>
    [...container.querySelectorAll<HTMLElement>(".agent-servers-row")]
      .find((row) => row.textContent?.includes("Vercel"))
      ?.click(),
  );
  const head = () =>
    [...container.querySelectorAll<HTMLButtonElement>(".integration-tool-head")].find((button) =>
      button.textContent?.startsWith("delete_project"),
    ) ?? assert.fail("delete_project has its row");

  // Note that the browser moves the focus on a press unless its mousedown is refused, which jsdom does not act out.
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    head().dispatchEvent(press);
    head().click();
  });

  assert.equal(press.defaultPrevented, true);
  assert.notEqual(container.querySelector(".agent-servers-menu"), null);
  assert.equal(head().getAttribute("aria-expanded"), "true");
  assert.equal(
    container.querySelector(".integration-tool-full")?.textContent,
    "Deletes a project.",
  );

  act(() => head().click());
  assert.equal(container.querySelector(".integration-tool-full"), null);

  key("Backspace");
  assert.equal(container.querySelector(".agent-servers-page-title"), null);
});

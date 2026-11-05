// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
import { MCP_CLIENTS_CALL_FAILURE, type McpClientsView } from "@repo/features/mcp-client-view";
import type { McpClient } from "@repo/features/mcp-client-wire";
import { ACT_KIND } from "@repo/host/acts";
import { CLI_INSTALL_OUTCOME } from "@repo/host/contract";
import { HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handState, signedInAs, stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { McpClientsSections } from "./mcp-clients-section.js";

/**
 * mcp-clients-section.test.ts -- Settings › our MCP's connected
 * agents: a revoke that did not finish leaves its row standing with its
 * Disconnect and says so, never that it landed, and one that lands leaves the
 * row saying how long the access the agent already holds lasts; and the
 * command-line tool's install, which only the desktop offers. Synthetic ids
 * and addresses.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
});

const ACCOUNT_ID = "user-dana";
const SERVER_URL = "https://app.test/api/mcp";

const CLAUDE: McpClient = {
  clientId: "client-claude",
  name: "Claude Code",
  redirectUris: ["http://127.0.0.1:51703/callback"],
  allowedAt: Date.parse("2026-11-01T10:00:00Z"),
  lastRefreshedAt: null,
};

/** The words the page's copy fields hold, a command or a line each. */
function copyable(): readonly string[] {
  return [...document.querySelectorAll<HTMLInputElement>("input[readonly]")].map(
    (each) => each.value,
  );
}

/** The page drawn for an account with no agent connected, on a client offering `capabilities`. */
async function drawPage(capabilities: readonly HostCapability[]): Promise<void> {
  handState(
    {},
    {
      account: signedInAs({ id: ACCOUNT_ID, email: "dana@app.test", name: "Dana" }).account,
      run: { ...stateWith({}, {}).run, capabilities },
      [LIVE_READ.MCP_CLIENTS]: { [ACCOUNT_ID]: { rows: { serverUrl: SERVER_URL, clients: [] } } },
    },
  );
  fakeAppPlatform(QUIET_PANEL);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(McpClientsSections))));
  await settle();
}

/** Lets the window's document and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** Presses the button whose words are given within `scope`. */
async function press(words: string, scope: ParentNode = document): Promise<void> {
  const button = [...scope.querySelectorAll("button")].find((each) => each.textContent === words);
  assert.ok(button !== undefined, `${words} is drawn`);
  await act(async () => button.click());
  await settle();
}

/** Chooses `words` in the page's one ⋯, and lets what it asked settle. */
async function choose(words: string): Promise<void> {
  const ellipsis =
    document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("no ⋯");
  act(() => ellipsis.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === words,
  );
  assert.ok(item !== undefined, `${words} is in the ⋯`);
  act(() => item.click());
  await settle();
}

/** The confirm dialog standing over the page. */
function dialog(): HTMLElement {
  const open = document.querySelector<HTMLElement>('[role="alertdialog"]');
  assert.ok(open !== null, "the confirm dialog stands");
  return open;
}

/** The page's words, apart from any dialog over it. */
function pageText(): string {
  return [...document.body.children]
    .filter((each) => each.querySelector('[role="alertdialog"]') === null)
    .map((each) => each.textContent ?? "")
    .join(" ");
}

test("a revoke that did not finish leaves the agent standing with its Disconnect and says so, and one that lands says how long its access lasts", async () => {
  handState(
    {},
    {
      account: signedInAs({ id: ACCOUNT_ID, email: "dana@app.test", name: "Dana" }).account,
      [LIVE_READ.MCP_CLIENTS]: {
        [ACCOUNT_ID]: { rows: { serverUrl: SERVER_URL, clients: [CLAUDE] } },
      },
    },
  );
  const answers: McpClientsView[] = [
    { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED },
    { serverUrl: SERVER_URL, clients: [] },
  ];
  const asked: string[] = [];
  fakeActPort({
    [ACT_KIND.MCP_CLIENTS_REVOKE]: ({ clientId }) => {
      asked.push(clientId);
      const answer = answers.shift();
      assert.ok(answer !== undefined, "the page revokes no more than twice");
      return Promise.resolve(answer);
    },
  });
  // Note that Codex's mark is served under the platform's asset base, which a row may draw.
  fakeAppPlatform(QUIET_PANEL);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(McpClientsSections))));
  await settle();
  assert.ok(pageText().includes("Goes to an app on this computer"), pageText());

  await choose("Disconnect");
  await press("Disconnect agent", dialog());
  await press("Cancel", dialog());
  assert.ok(pageText().includes("Revoking Claude Code didn't finish. Try again."), pageText());
  assert.ok(
    !pageText().includes("Disconnected."),
    "a revoke that did not finish never says it landed",
  );

  await choose("Disconnect");
  await press("Disconnect agent", dialog());
  assert.ok(pageText().includes("Disconnected. Its access ends within 15 minutes."), pageText());
  assert.ok(!pageText().includes("didn't finish"), pageText());
  assert.equal(
    container.querySelector('button[aria-haspopup="menu"]'),
    null,
    "a disconnected agent offers no Disconnect",
  );
  assert.deepEqual(asked, [CLAUDE.clientId, CLAUDE.clientId]);
});

test("the desktop's install says why it failed, then the version installed and the PATH line where the shell lacks ~/.local/bin", async () => {
  const answers = [
    { outcome: CLI_INSTALL_OUTCOME.FAILED, reason: "Vespin CLI has no release yet." },
    { outcome: CLI_INSTALL_OUTCOME.INSTALLED, version: "0.3.0", onPath: false },
  ] as const;
  let asked = 0;
  fakeActPort({
    [ACT_KIND.CLI_INSTALL]: () => Promise.resolve(answers[asked++] ?? assert.fail("asked twice")),
  });
  await drawPage(DESKTOP_CAPABILITIES);

  await press("Install command-line tool");
  assert.ok(pageText().includes("Vespin CLI has no release yet."), pageText());
  assert.ok(!pageText().includes("Installed vespin"), "a failed install never says it landed");

  await press("Install command-line tool");
  assert.ok(pageText().includes("Installed vespin 0.3.0."), pageText());
  assert.ok(!pageText().includes("no release yet"), pageText());
  assert.ok(copyable().includes(`export PATH="$HOME/.local/bin:$PATH"`), copyable().join("\n"));
});

test("a browser tab offers the commands, its install script at the server's origin, and no install", async () => {
  fakeActPort({});
  await drawPage(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.CLI_INSTALL));

  assert.ok(copyable().includes("npm i -g vespin"), copyable().join("\n"));
  assert.ok(
    copyable().includes("curl -fsSL https://app.test/install.sh | sh -s cli"),
    copyable().join("\n"),
  );
  assert.equal(
    [...document.querySelectorAll("button")].some(
      (each) => each.textContent === "Install command-line tool",
    ),
    false,
    "a tab cannot run the install",
  );
});

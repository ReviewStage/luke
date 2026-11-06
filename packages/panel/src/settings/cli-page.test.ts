// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
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
import { onRegistry, writeHandedAppState } from "../testing/copy-feedback.js";
import { CliPage } from "./cli-page.js";

/**
 * cli-page.test.ts -- Settings › CLI: the desktop's Install says why it failed or the version it installed, a browser tab offers the npm install alone, and Sign out everywhere signs the command out. Synthetic ids and addresses.
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
const EMAIL = "dana@app.test";
const SERVER_URL = "https://app.test/api/mcp";

/** The `vespin` command's grant, as the read lists it once the command signed in. */
const VESPIN_CLI: McpClient = {
  clientId: "vespin-cli",
  name: "Vespin CLI",
  redirectUris: ["http://127.0.0.1/callback"],
  allowedAt: Date.parse("2026-11-02T10:00:00Z"),
  lastRefreshedAt: null,
};

/** Lets the window's document and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** The page drawn on a client offering `capabilities`, the account's clients read as `clients`. */
async function drawPage(
  capabilities: readonly HostCapability[],
  clients: readonly McpClient[] = [],
): Promise<void> {
  handState(
    {},
    {
      account: signedInAs({ id: ACCOUNT_ID, email: EMAIL, name: "Dana" }).account,
      run: { ...stateWith({}, {}).run, capabilities },
      [LIVE_READ.MCP_CLIENTS]: { [ACCOUNT_ID]: { rows: { serverUrl: SERVER_URL, clients } } },
    },
  );
  fakeAppPlatform(QUIET_PANEL);
  await writeHandedAppState();
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(CliPage))));
  await settle();
}

/** Presses the button whose words are given within `scope`. */
async function press(words: string, scope: ParentNode = document): Promise<void> {
  const button = [...scope.querySelectorAll("button")].find((each) => each.textContent === words);
  assert.ok(button !== undefined, `${words} is drawn`);
  await act(async () => button.click());
  await settle();
}

/** Whether a button with these words is drawn. */
function drawn(words: string): boolean {
  return [...document.querySelectorAll("button")].some((each) => each.textContent === words);
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

test("the desktop's Install says why it failed, then the version installed, and offers Reinstall", async () => {
  const answers = [
    {
      outcome: CLI_INSTALL_OUTCOME.FAILED,
      reason: "Could not download https://app.test/install.sh.",
    },
    { outcome: CLI_INSTALL_OUTCOME.INSTALLED, version: "0.3.0", onPath: true },
  ] as const;
  let asked = 0;
  fakeActPort({
    [ACT_KIND.CLI_INSTALL]: () => Promise.resolve(answers[asked++] ?? assert.fail("asked twice")),
  });
  await drawPage(DESKTOP_CAPABILITIES);

  await press("Install");
  assert.ok(pageText().includes("Could not download https://app.test/install.sh."), pageText());
  assert.ok(!pageText().includes("Installed"), "a failed install never says it landed");

  await press("Install");
  assert.ok(pageText().includes("Installed · v0.3.0"), pageText());
  assert.ok(!pageText().includes("Could not download"), pageText());
  assert.ok(drawn("Reinstall"), "an installed command offers Reinstall");
});

test("a browser tab offers the npm install and the sign-in to copy, and no Install", async () => {
  fakeActPort({});
  await drawPage(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.CLI_INSTALL));

  assert.ok(pageText().includes("npm i -g vespin"), pageText());
  assert.ok(pageText().includes("vespin login"), pageText());
  assert.equal(drawn("Install"), false, "a tab cannot run the install");
});

test("Sign out everywhere revokes the command's grant and leaves the sign-in to copy", async () => {
  const revoked: string[] = [];
  fakeActPort({
    [ACT_KIND.MCP_CLIENTS_REVOKE]: ({ clientId }) => {
      revoked.push(clientId);
      return Promise.resolve({ serverUrl: SERVER_URL, clients: [] });
    },
  });
  await drawPage(DESKTOP_CAPABILITIES, [VESPIN_CLI]);
  assert.ok(pageText().includes(EMAIL), pageText());
  assert.ok(!pageText().includes("vespin login"), "a signed-in command offers no sign-in");

  await press("Sign out everywhere");
  await press("Sign out everywhere", dialog());
  assert.deepEqual(revoked, [VESPIN_CLI.clientId]);
  assert.equal(drawn("Sign out everywhere"), false, "a signed-out command offers no sign-out");
  assert.ok(pageText().includes("vespin login"), pageText());
});

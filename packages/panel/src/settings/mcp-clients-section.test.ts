// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
import { MCP_CLIENTS_CALL_FAILURE, type McpClientsView } from "@repo/features/mcp-client-view";
import type { McpClient } from "@repo/features/mcp-client-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState, signedInAs } from "../testing/app-state.js";
import { withQueryClient, writeHandedAppState } from "../testing/copy-feedback.js";
import { McpClientsSections } from "./mcp-clients-section.js";

/**
 * mcp-clients-section.test.ts -- Settings › our MCP's connected
 * agents: a revoke that did not finish leaves its row standing with its
 * Disconnect and says so, never that it landed, and one that lands leaves the
 * row saying how long the access the agent already holds lasts; and the
 * `vespin` command, which Settings › CLI signs out, is never listed. Synthetic
 * ids and addresses.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
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

/** The `vespin` command's grant, which the read lists beside the outside agents. */
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
        [ACCOUNT_ID]: { rows: { serverUrl: SERVER_URL, clients: [CLAUDE, VESPIN_CLI] } },
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
  await writeHandedAppState();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(createElement(McpClientsSections))));
  await settle();
  assert.ok(pageText().includes("Goes to an app on this computer"), pageText());
  assert.ok(!pageText().includes("Vespin CLI"), "the command's sign-in is Settings › CLI's");

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
    container.querySelector('button[aria-haspopup="menu"]') === null,
    true,
    "a disconnected agent offers no Disconnect",
  );
  assert.deepEqual(asked, [CLAUDE.clientId, CLAUDE.clientId]);
});

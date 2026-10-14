// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import type { GitHubConnection } from "@sidecar/hosted/github-connection-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { codingAgentsControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import type { Failure } from "../failure-remedy";
import { GitHubConnectProvider } from "../github-connect";
import { OpenSettingsProvider } from "../open-settings";
import type { SettingsLink } from "../settings-views";
import { startFailureNote } from "./coding-agent-model";
import { DraftAgentTab } from "./draft-agent-tab";
import type { AgentDraft } from "./use-coding-agents";

/**
 * A draft agent's first message through the bridge the host answers: a
 * Start GitHub refused offers Connect GitHub in place, which once GitHub is
 * connected and the window is back sends the message again by itself; a
 * connect withdrawn leaves the refusal and its press; any other refusal
 * offers Retry; a server the agent has on whose sign-in expired is offered
 * to reconnect in place. The window's GitHub connection is the test's to
 * change, as the host's read of it would.
 */

/** Where the account's Slack connection stands at the service; every other provider but GitHub is not offered. */
let slack: IntegrationStatus = INTEGRATION_STATUS.CONNECTED;
/** Where GitHub stands for the account, unavailable unless a test offers it. */
let github: IntegrationStatus = INTEGRATION_STATUS.UNAVAILABLE;

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const UNAVAILABLE = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.UNAVAILABLE]),
) as Record<IntegrationProvider, IntegrationStatus>;
/** Every act the tab sent, in order. */
let sent: Act[] = [];

const DRAFT: AgentDraft = {
  id: "draft-1",
  task: "Can you see Slack messages?",
  attachments: [],
  choice: undefined,
  disabledServers: [],
};

const SIGN_IN_REFUSAL = startFailureNote(CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED);

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  sent = [];
  slack = INTEGRATION_STATUS.CONNECTED;
  github = INTEGRATION_STATUS.UNAVAILABLE;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        if (request.kind === ACT_KIND.INTEGRATIONS_STATUS) {
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: {
              integrations: {
                ...UNAVAILABLE,
                [INTEGRATION_PROVIDER.SLACK]: slack,
                [INTEGRATION_PROVIDER.GITHUB]: github,
              },
            },
          });
        }
        if (request.kind === ACT_KIND.INTEGRATIONS_CONNECT) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { opened: true } });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The draft's tab over Starts answered in turn by `answers`, each Start's words written down. */
function mount(answers: (Failure | undefined)[], draft: AgentDraft = DRAFT) {
  const starts: string[] = [];
  const links: SettingsLink[] = [];
  const settings = { integrationsOpened: false };
  const control = codingAgentsControl({
    startTask: (_draftId, task) => {
      starts.push(task);
      return Promise.resolve(answers.shift());
    },
    onOpenIntegrations: () => {
      settings.integrationsOpened = true;
    },
  });
  const github = { connects: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // The window's GitHub connection, drawn again as the host's read of it lands.
  const draw = (connection: GitHubConnection | undefined) =>
    act(() =>
      root.render(
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => links.push(link) },
          createElement(
            GitHubConnectProvider,
            {
              value: {
                connection,
                connect: () => {
                  github.connects += 1;
                },
              },
            },
            createElement(DraftAgentTab, { draft, control }),
          ),
        ),
      ),
    );
  draw({ connected: false, login: null });
  // A press is named by its words; the mark before them carries a title of its own.
  const button = (words: string) =>
    [...container.querySelectorAll("button")].find((each) =>
      [...each.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent === words,
      ),
    );
  return {
    starts,
    links,
    settings,
    github,
    /** GitHub connected, as the host reads it once the window is back from the browser. */
    connected: async () => {
      draw({ connected: true, login: "dean" });
      await settle();
    },
    send: async () => {
      const field = container.querySelector("textarea");
      assert.ok(field, "the draft's box is drawn");
      act(() => {
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      await settle();
    },
    note: () => container.querySelector(".agent-composer-note")?.textContent ?? undefined,
    button,
    press: async (words: string) => {
      const found = button(words);
      assert.ok(found, `a "${words}" button is drawn`);
      act(() => found.click());
      await settle();
    },
  };
}

/** The window coming back from the browser. */
async function windowBack(): Promise<void> {
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
}

test("a Start GitHub refused offers Connect GitHub in place, and once GitHub is connected and the window is back the message is sent again by itself", async () => {
  const tab = mount([SIGN_IN_REFUSAL, undefined]);
  await tab.send();
  assert.match(tab.note() ?? "", /^Connect GitHub to start an agent\./u);
  assert.equal(tab.button("Retry"), undefined, "Retry cannot mend it");

  await tab.press("Connect GitHub");
  assert.equal(tab.github.connects, 1, "the press connects GitHub in the browser");
  assert.ok(tab.button("Waiting for browser…")?.disabled, "the press waits on the browser");
  assert.deepEqual(tab.links, [], "nothing leaves for Settings");
  assert.deepEqual(tab.starts, [DRAFT.task]);

  await windowBack();
  assert.deepEqual(tab.starts, [DRAFT.task], "back without GitHub connected, nothing is sent");
  await tab.connected();
  assert.deepEqual(tab.starts, [DRAFT.task, DRAFT.task]);
  assert.equal(tab.note(), undefined);
});

test("a GitHub connect withdrawn leaves the refusal with its press, and a connect that lands after sends nothing", async () => {
  const tab = mount([SIGN_IN_REFUSAL]);
  await tab.send();

  await tab.press("Connect GitHub");
  await tab.press("Cancel");
  assert.match(tab.note() ?? "", /^Connect GitHub to start an agent\./u);
  assert.ok(tab.button("Connect GitHub"), "the press is offered again");

  await windowBack();
  await tab.connected();
  assert.deepEqual(tab.starts, [DRAFT.task]);
});

test("a refusal a GitHub connect does not mend offers Retry, and no Connect GitHub", async () => {
  const tab = mount([startFailureNote(CODING_AGENT_CALL_FAILURE.UNANSWERED), undefined]);
  await tab.send();
  assert.match(tab.note() ?? "", /could not be started/u);
  assert.equal(tab.button("Connect GitHub"), undefined);

  await tab.press("Retry");
  assert.deepEqual(tab.starts, [DRAFT.task, DRAFT.task]);
  assert.equal(tab.github.connects, 0);
});

test("a server the agent has on whose sign-in expired is offered to reconnect under the box, and one it has off is not", async () => {
  slack = INTEGRATION_STATUS.EXPIRED;
  const tab = mount([]);
  await settle();
  assert.match(tab.note() ?? "", /^Slack's sign-in expired\./u);

  await tab.press("Reconnect Slack");
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.INTEGRATIONS_CONNECT),
    [{ kind: ACT_KIND.INTEGRATIONS_CONNECT, payload: { provider: INTEGRATION_PROVIDER.SLACK } }],
  );
  assert.equal(tab.settings.integrationsOpened, false, "the composer reconnects in place");

  const off = mount([], { ...DRAFT, disabledServers: [INTEGRATION_PROVIDER.SLACK] });
  await settle();
  assert.equal(off.note(), undefined);
});

test("the MCP servers popover draws a row for each server the deployment offers the account, and none for one it does not", async () => {
  const tab = mount([]);
  await settle();
  const servers = document.querySelector<HTMLButtonElement>('button[aria-label="MCP servers"]');
  assert.ok(servers, "the MCP button is drawn");
  act(() => servers.click());
  await settle();

  const rows = [...document.querySelectorAll(".agent-servers-row")].map(
    (row) => row.querySelector(".plan-compose-menu-name")?.textContent,
  );
  assert.deepEqual(rows, ["Slack"]);
  assert.equal(tab.button("Connect"), undefined, "nothing offers a server not offered");
});

test("the MCP popover's GitHub row connects GitHub in place, and the popover stays", async () => {
  github = INTEGRATION_STATUS.DISCONNECTED;
  const tab = mount([]);
  await settle();
  const servers = document.querySelector<HTMLButtonElement>('button[aria-label="MCP servers"]');
  assert.ok(servers, "the MCP button is drawn");
  act(() => servers.click());
  await settle();

  const githubRow = () =>
    [...document.querySelectorAll(".agent-servers-row")].find(
      (row) => row.querySelector(".plan-compose-menu-name")?.textContent === "GitHub",
    ) ?? assert.fail("the popover draws GitHub's row");
  const connect =
    [...githubRow().querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    ) ?? assert.fail("GitHub's row offers Connect");
  act(() => connect.click());
  await settle();

  assert.equal(tab.github.connects, 1);
  assert.deepEqual(tab.links, [], "nothing leaves for Settings");
  assert.ok(githubRow(), "the popover stays");
});

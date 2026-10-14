// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
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
import { installEditorBundle, installEditorLayout, pressInComposer } from "#testing/composer";
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
 * refused Start offers Retry; a server the agent has on whose sign-in
 * expired is offered to reconnect in place; and the MCP popover's GitHub
 * row connects the account's GitHub in place.
 */

/** Where the account's Slack connection stands at the service; every other provider but GitHub is not offered. */
let slack: IntegrationStatus = INTEGRATION_STATUS.CONNECTED;
/** Whether the next Connect the bridge is asked for is refused, as a service that does not answer refuses it. */
let refuseConnect = false;
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

const roots: Root[] = [];

// Set before any tab renders, since the box reads the editor bundle once per window.
installEditorBundle();

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  sent = [];
  refuseConnect = false;
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
        // A Connect stands Slack pending at the service, and a Cancel disconnects it.
        if (request.kind === ACT_KIND.INTEGRATIONS_CONNECT) {
          if (request.payload.provider === INTEGRATION_PROVIDER.SLACK && !refuseConnect) {
            slack = INTEGRATION_STATUS.PENDING;
          }
          return Promise.resolve(
            refuseConnect
              ? { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not now." }
              : { status: ACT_OUTCOME_STATUS.DONE, value: { opened: true } },
          );
        }
        if (request.kind === ACT_KIND.INTEGRATIONS_CANCEL) {
          slack = INTEGRATION_STATUS.DISCONNECTED;
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { status: INTEGRATION_STATUS.DISCONNECTED },
          });
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
  act(() =>
    root.render(
      createElement(
        OpenSettingsProvider,
        { value: (link: SettingsLink) => links.push(link) },
        createElement(
          GitHubConnectProvider,
          {
            value: {
              connection: { connected: false, login: null },
              connect: () => {
                github.connects += 1;
                return Promise.resolve(true);
              },
              disconnect: () => Promise.resolve(false),
            },
          },
          createElement(DraftAgentTab, { draft, control }),
        ),
      ),
    ),
  );
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
    send: async () => {
      pressInComposer(container, "Enter");
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

test("a refused Start offers Retry, which sends the message again", async () => {
  const tab = mount([startFailureNote(CODING_AGENT_CALL_FAILURE.UNANSWERED), undefined]);
  await tab.send();
  assert.match(tab.note() ?? "", /could not be started/u);

  await tab.press("Retry");
  assert.deepEqual(tab.starts, [DRAFT.task, DRAFT.task]);
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

test("a reconnect that could not begin says so under the box, and Reconnect is offered again", async () => {
  slack = INTEGRATION_STATUS.EXPIRED;
  refuseConnect = true;
  const tab = mount([]);
  await settle();

  await tab.press("Reconnect Slack");

  assert.match(tab.note() ?? "", /could not start reconnecting it/u);
  assert.ok(tab.button("Reconnect Slack"));
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

test("the MCP popover waits on a Connect as Settings does, with Reopen and Cancel, and says why one came back without access", async () => {
  slack = INTEGRATION_STATUS.DISCONNECTED;
  const tab = mount([]);
  await settle();
  const servers = document.querySelector<HTMLButtonElement>('button[aria-label="MCP servers"]');
  assert.ok(servers, "the MCP button is drawn");
  act(() => servers.click());
  await settle();
  const slackRow = () => {
    const row = document.querySelector(".agent-servers-row") ?? assert.fail("Slack has a row");
    return {
      words:
        row.querySelector(".agent-servers-problem, .agent-servers-waiting")?.textContent ??
        undefined,
      buttons: [...row.querySelectorAll("button")].map((button) => button.textContent),
    };
  };

  await tab.press("Connect");
  assert.deepEqual(slackRow(), {
    words: "Waiting for Slack in your browser…",
    buttons: ["Reopen", "Cancel"],
  });

  slack = INTEGRATION_STATUS.DISCONNECTED;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  assert.deepEqual(slackRow(), {
    words: "Couldn't connect to Slack: the sign-in came back without access.",
    buttons: ["Try again"],
  });

  await tab.press("Try again");
  await tab.press("Cancel");
  assert.deepEqual(slackRow(), { words: undefined, buttons: ["Connect"] });
});

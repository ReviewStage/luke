// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@luke/features/repository-reach-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { SettingsLink } from "@luke/settings/settings-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  composerEditor,
  installEditorBundle,
  installEditorLayout,
  pressInComposer,
} from "#testing/composer";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { codingAgentsControl } from "#testing/tasks-control";
import { GitHubConnectProvider } from "../github-connect";
import { OpenSettingsProvider } from "../open-settings";
import { startFailureNote } from "./coding-agent-model";
import { DraftAgentTab } from "./draft-agent-tab";
import { type RepositoryRemedyDoors, RepositoryRemedyProvider } from "./repository-remedy";
import type { AgentDraft, CodingAgentsControl } from "./use-coding-agents";

/**
 * A draft agent's first message through the bridge the host answers: a
 * refused Start offers Retry; a Start refused for a repository out of reach
 * says why, naming the repository, and offers the press that mends it; a
 * server the agent has on whose sign-in expired is offered to reconnect in
 * place; and the MCP popover's GitHub row connects the account's GitHub in
 * place.
 */

const TASK_ID = "plan-1";
const RELAY = "Acme/Relay";

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
  prompt: "Can you see Slack messages?",
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
  Object.defineProperty(window, "luke", {
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
function mount(
  answers: (Failure | undefined)[],
  draft: AgentDraft = DRAFT,
  extra: Partial<CodingAgentsControl> = {},
) {
  const starts: string[] = [];
  const links: SettingsLink[] = [];
  const settings = { integrationsOpened: false };
  const control = codingAgentsControl({
    startPrompt: (_draftId, prompt) => {
      starts.push(prompt);
      return Promise.resolve(answers.shift());
    },
    onOpenIntegrations: () => {
      settings.integrationsOpened = true;
    },
    ...extra,
  });
  const github = { connects: 0 };
  /** What each repository remedy's door was asked, in order. */
  const remedies: string[] = [];
  const doors: RepositoryRemedyDoors = {
    openWorkspaceGitHub: (taskId) => remedies.push(`workspace-github:${taskId}`),
    openGitHub: (url) => remedies.push(`github:${url}`),
    chooseRepository: (taskId) => remedies.push(`choose:${taskId}`),
    moveTask: (taskId, workspaceId) => {
      remedies.push(`move:${taskId}:${workspaceId}`);
      return Promise.resolve(true);
    },
  };
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
          createElement(
            RepositoryRemedyProvider,
            { value: doors },
            createElement(DraftAgentTab, { draft, control }),
          ),
        ),
      ),
    ),
  );
  // A press is named by its words, or by the name it gives them (a Retry
  // keeps its words in a span of their own); the mark before them carries a
  // title of its own.
  const button = (words: string) =>
    [...container.querySelectorAll("button")].find(
      (each) =>
        each.getAttribute("aria-label") === words ||
        [...each.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent === words,
        ),
    );
  return {
    starts,
    remedies,
    links,
    settings,
    github,
    send: async () => {
      pressInComposer(container, "Enter");
      await settle();
    },
    note: () => container.querySelector(".agent-composer-note")?.textContent ?? undefined,
    words: () =>
      container.querySelector(".agent-composer-note .failure-note-words")?.textContent ?? undefined,
    draft: () => composerEditor(container).textContent,
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
  const tab = mount([
    startFailureNote({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }, TASK_ID),
    undefined,
  ]);
  await tab.send();
  assert.match(tab.note() ?? "", /could not be started/u);

  await tab.press("Retry");
  assert.deepEqual(tab.starts, [DRAFT.prompt, DRAFT.prompt]);
});

/** A Start refused for the repository out of reach, as the host hears the service say why. */
const unreachable = (unreached: RepositoryUnreached): Failure =>
  startFailureNote(
    { failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE, unreached },
    TASK_ID,
  );

test("a Start refused because the workspace has no GitHub connected names the repository, and Connect GitHub opens the plan's workspace's GitHub with Retry beside it", async () => {
  const tab = mount([
    unreachable({ reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: RELAY }),
    undefined,
  ]);
  await tab.send();

  assert.equal(
    tab.words(),
    "This workspace isn't connected to GitHub, so Luke can't reach Acme/Relay.",
  );
  assert.equal(tab.draft(), DRAFT.prompt, "the words stay in the box");
  await tab.press("Connect GitHub");
  assert.deepEqual(tab.remedies, [`workspace-github:${TASK_ID}`]);
  await tab.press("Retry");
  assert.deepEqual(tab.starts, [DRAFT.prompt, DRAFT.prompt]);
});

test("a Start refused because the workspace's GitHub was removed or suspended offers Reconnect GitHub", async () => {
  const tab = mount([
    unreachable({ reason: REPOSITORY_UNREACHED.CONNECTION_LAPSED, repository: RELAY }),
  ]);
  await tab.send();

  assert.equal(
    tab.words(),
    "This workspace's GitHub connection was removed or suspended, so Luke can't reach Acme/Relay.",
  );
  await tab.press("Reconnect GitHub");
  assert.deepEqual(tab.remedies, [`workspace-github:${TASK_ID}`]);
  assert.ok(tab.button("Retry"));
});

test("a Start refused because the installation was not given the repository opens its settings on GitHub to add it, with Retry beside it", async () => {
  const settingsUrl = "https://github.com/organizations/Acme/settings/installations/7";
  const tab = mount([
    unreachable({ reason: REPOSITORY_UNREACHED.NOT_SELECTED, repository: RELAY, settingsUrl }),
  ]);
  await tab.send();

  assert.equal(tab.words(), "Luke on GitHub doesn't have access to Acme/Relay.");
  await tab.press("Add Acme/Relay to Luke on GitHub");
  assert.deepEqual(tab.remedies, [`github:${settingsUrl}`]);
  assert.ok(tab.button("Retry"));
});

test("a Start refused because the repository is under another account than the workspace's GitHub, or was renamed, transferred, or deleted, offers to choose a repository, and no Retry", async () => {
  const tab = mount([
    unreachable({
      reason: REPOSITORY_UNREACHED.OTHER_OWNER,
      repository: RELAY,
      connectedTo: "octo-org",
    }),
    unreachable({ reason: REPOSITORY_UNREACHED.GONE, repository: RELAY }),
  ]);
  await tab.send();

  assert.equal(
    tab.words(),
    "Acme/Relay isn't under octo-org, the GitHub account this workspace is connected to.",
  );
  assert.equal(tab.button("Retry"), undefined);
  await tab.press("Choose a repository");
  await tab.send();
  assert.equal(tab.words(), "Acme/Relay was renamed, transferred, or deleted on GitHub.");
  await tab.press("Choose a repository");
  assert.deepEqual(tab.remedies, [`choose:${TASK_ID}`, `choose:${TASK_ID}`]);
});

test("a Start refused because the repository's owner is connected to another workspace moves the plan there, and starts again by itself once it moved", async () => {
  const tab = mount([
    unreachable({
      reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE,
      repository: RELAY,
      workspace: { id: "team-1", name: "Acme Team" },
    }),
    undefined,
  ]);
  await tab.send();

  assert.equal(tab.words(), "Acme/Relay is connected to Acme Team, not this workspace.");
  await tab.press("Move task to Acme Team");
  assert.deepEqual(tab.remedies, [`move:${TASK_ID}:team-1`]);
  assert.deepEqual(tab.starts, [DRAFT.prompt, DRAFT.prompt]);
  assert.equal(tab.note(), undefined);
});

test("a Start GitHub did not answer says so and offers Retry alone, and one from a service that gave no reason says the repository is out of reach", async () => {
  const tab = mount([
    startFailureNote({ failure: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED }, TASK_ID),
    startFailureNote({ failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE }, TASK_ID),
  ]);
  await tab.send();

  assert.equal(tab.words(), "GitHub didn't answer. Try again.");
  await tab.press("Retry");
  assert.equal(tab.words(), "Luke can't reach this task's repository on GitHub.");
  assert.ok(tab.button("Retry"));
  assert.deepEqual(tab.remedies, []);
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
    (row) => row.querySelector(".task-compose-menu-name")?.textContent,
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
      (row) => row.querySelector(".task-compose-menu-name")?.textContent === "GitHub",
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

test("a fork's draft names its source and the message over the box, starts on the source's model, sends an empty box as the fork alone, and its × lets the fork go", async () => {
  const SOURCE = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const MESSAGE = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";
  const fork = { agentId: SOURCE, messageId: MESSAGE, opening: "I moved the invite email…" };
  const source: CodingAgentSummary = {
    id: SOURCE,
    planId: TASK_ID,
    model: "openai/gpt-6.1-sol",
    effort: "xhigh",
    title: "Queue the invite email",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  const forks: unknown[] = [];
  let dropped = 0;
  const tab = mount(
    [],
    { ...DRAFT, prompt: "", fork },
    {
      agents: [source],
      startFork: (draftId, forked, words, choice, attachments) => {
        forks.push({ draftId, forked, words, choice, attachments });
        return Promise.resolve(undefined);
      },
      onDropFork: () => {
        dropped += 1;
      },
    },
  );
  await settle();

  const chip = document.querySelector("[data-fork-chip]");
  assert.equal(
    chip?.textContent?.replace(/\s+/gu, " "),
    `Fork ofQueue the invite emailat“${fork.opening}”`,
  );
  assert.equal(
    document.querySelector(".agent-model-chip")?.textContent,
    "GPT 6.1 Sol Extra high",
    "the model chip starts on the source's model and effort",
  );

  await tab.send();
  assert.deepEqual(forks, [
    { draftId: DRAFT.id, forked: fork, words: "", choice: undefined, attachments: [] },
  ]);
  assert.deepEqual(tab.starts, [], "a fork is never started as a prompt");

  await tab.press("Drop the fork");
  assert.equal(dropped, 1);
});

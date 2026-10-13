// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER } from "@sidecar/credentials/snapshot";
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
import { codingAgentsControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import type { Failure } from "../failure-remedy";
import { startFailureNote } from "./coding-agent-model";
import { DraftAgentTab } from "./draft-agent-tab";
import type { AgentDraft } from "./use-coding-agents";

/**
 * A draft agent's first message through the bridge the host answers: a
 * Start GitHub refused offers the sign-in itself, which once it lands sends
 * the message again by itself; a sign-in withdrawn leaves the refusal and
 * its press; any other refusal offers Retry; a server the agent has on
 * whose sign-in expired is offered to reconnect. The sign-ins the bridge is
 * asked for are held until the test answers them.
 */

/** One sign-in the bridge holds, answered when the test chooses. */
interface HeldSignIn {
  request: Act;
  answer: (outcome: ActOutcome) => void;
}

let signIns: HeldSignIn[] = [];
/** Where the account's Slack connection stands at the service; every other provider is not offered. */
let slack: IntegrationStatus = INTEGRATION_STATUS.CONNECTED;

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
  signIns = [];
  sent = [];
  slack = INTEGRATION_STATUS.CONNECTED;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        if (request.kind === ACT_KIND.ACCOUNT_SIGN_IN_AGAIN) {
          return new Promise((answer) => {
            signIns.push({ request, answer });
          });
        }
        if (request.kind === ACT_KIND.INTEGRATIONS_STATUS) {
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { integrations: { ...UNAVAILABLE, [INTEGRATION_PROVIDER.SLACK]: slack } },
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
  const control = codingAgentsControl({
    startTask: (_draftId, task) => {
      starts.push(task);
      return Promise.resolve(answers.shift());
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(DraftAgentTab, { draft, control })));
  // A press is named by its words; the mark before them carries a title of its own.
  const button = (words: string) =>
    [...container.querySelectorAll("button")].find((each) =>
      [...each.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent === words,
      ),
    );
  return {
    starts,
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

/** The newest sign-in the tab asked for, answered with whether a new session landed. */
async function answerSignIn(signedIn: boolean): Promise<void> {
  const held = signIns.at(-1);
  assert.ok(held, "a sign-in was asked for");
  await act(async () => {
    held.answer({ status: ACT_OUTCOME_STATUS.DONE, value: signedIn });
  });
  await settle();
}

test("a Start GitHub refused offers the GitHub sign-in, and once it lands the message is sent again by itself", async () => {
  const tab = mount([SIGN_IN_REFUSAL, undefined]);
  await tab.send();
  assert.match(tab.note() ?? "", /^Sign in with GitHub again to start an agent\./u);
  assert.equal(tab.button("Retry"), undefined, "Retry cannot mend it");

  await tab.press("Sign in with GitHub");
  assert.deepEqual(
    signIns.map(({ request }) => request),
    [{ kind: ACT_KIND.ACCOUNT_SIGN_IN_AGAIN, payload: { provider: ACCOUNT_PROVIDER.GITHUB } }],
  );
  assert.ok(tab.button("Waiting for browser…")?.disabled, "the press waits on the browser");
  assert.deepEqual(tab.starts, [DRAFT.task]);

  await answerSignIn(true);
  assert.deepEqual(tab.starts, [DRAFT.task, DRAFT.task]);
  assert.equal(tab.note(), undefined);
});

test("a GitHub sign-in withdrawn, or one that did not land, leaves the refusal with its press and sends nothing", async () => {
  const tab = mount([SIGN_IN_REFUSAL]);
  await tab.send();

  await tab.press("Sign in with GitHub");
  await tab.press("Cancel");
  assert.ok(sent.some((each) => each.kind === ACT_KIND.ACCOUNT_CANCEL_SIGN_IN));
  assert.match(tab.note() ?? "", /^Sign in with GitHub again to start an agent\./u);
  assert.ok(tab.button("Sign in with GitHub"), "the press is offered again");
  // The withdrawn sign-in's own answer, arriving late, is spent.
  await answerSignIn(true);
  assert.deepEqual(tab.starts, [DRAFT.task]);

  await tab.press("Sign in with GitHub");
  await answerSignIn(false);
  assert.deepEqual(tab.starts, [DRAFT.task]);
  assert.ok(tab.button("Sign in with GitHub"), "the press is offered again");
});

test("a refusal a sign-in does not mend offers Retry, and no sign-in", async () => {
  const tab = mount([startFailureNote(CODING_AGENT_CALL_FAILURE.UNANSWERED), undefined]);
  await tab.send();
  assert.match(tab.note() ?? "", /could not be started/u);
  assert.equal(tab.button("Sign in with GitHub"), undefined);

  await tab.press("Retry");
  assert.deepEqual(tab.starts, [DRAFT.task, DRAFT.task]);
  assert.deepEqual(signIns, []);
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

  const off = mount([], { ...DRAFT, disabledServers: [INTEGRATION_PROVIDER.SLACK] });
  await settle();
  assert.equal(off.button("Reconnect Slack"), undefined);
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

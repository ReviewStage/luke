// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { AutomationDirectory } from "../automation-directory";
import { MemberDirectory } from "../member-directory";
import { AgentRef, agentCardReading, NOTHING_HELD } from "./agent-ref";

/**
 * agent-automation.test.ts -- an agent an automation's run started says so
 * on its card, "Started by" the automation's clock and name, which hang the
 * automation's card and open its page; while the Automations experiment is
 * off, the card says nothing of an automation and the automations are not
 * read. Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

const WORKSPACE = { id: "workspace-acme", name: "Acme", memberCount: 2 };

const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...CHARLES, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
];

const TRIAGE: AutomationSummary = {
  id: "3f0e6f5c-7d1a-4f6e-9a55-000000000001",
  planId: null,
  planName: null,
  workspaceId: WORKSPACE.id,
  name: "Morning Sentry triage",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage Sentry." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: {
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent: {
      id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
      title: "Triage",
      status: CODING_AGENT_STATUS.COMPLETED,
    },
    firedAt: 2,
    settledAt: 3,
  },
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Triage",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  startedBy: CHARLES,
  automationId: TRIAGE.id,
};

let root: Root | undefined;
/** Every workspace whose automations were read, in order. */
let listed: string[] = [];

beforeEach(() => {
  listed = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
          listed.push(request.payload.workspaceId ?? "");
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { automations: [TRIAGE] },
          });
        }
        if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Rests the pointer on `element`, as hovering it does. */
function hover(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
}

/** The cards standing in the window, the first hung first. */
function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".tooltip-card:not([data-leaving])")];
}

/** The agent named in a place of the workspace as Dean reads it, the experiment `on` or off, its card hung, and every automation page opened. */
async function agentCard(on: boolean) {
  const opened: string[] = [];
  const read = agentCardReading(AGENT, "Triage", NOTHING_HELD, false, {
    me: DEAN.userId,
    pullRequests: new Map(),
  });
  const named = createElement(AgentRef, {
    subject: { name: "Triage", read },
    models: [],
    onOpen: () => undefined,
    children: "Triage",
  });
  const place = createElement(MemberDirectory, {
    workspace: WORKSPACE,
    readerId: DEAN.userId,
    children: createElement(AutomationDirectory, {
      workspace: WORKSPACE,
      on,
      wanted: true,
      onOpen: (automationId: string) => opened.push(automationId),
      children: named,
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), place)));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  hover(container.querySelector("[data-agent-ref]") ?? assert.fail("the agent is named"));
  const card = cards()[0] ?? assert.fail("the agent's card hangs");
  return { card, opened };
}

test("an agent an automation started says it was started by the automation, its clock and name, which a press opens the page of", async () => {
  const { card, opened } = await agentCard(true);
  const starter = card.querySelector<HTMLElement>(".actor-line .actor-ref");
  assert.ok(starter, "the card names who started the agent");
  assert.equal(card.querySelector(".actor-line")?.firstChild?.textContent, "Started by ");
  assert.equal(starter.dataset.kind, "automation");
  assert.equal(starter.textContent, "Morning Sentry triage");
  assert.equal(starter.tagName, "BUTTON");

  act(() => starter.click());
  assert.deepEqual(opened, [TRIAGE.id]);
  assert.equal(cards().length, 0, "the press takes the agent's card down");
});

test("the automation's name hangs its card over the agent's: its schedule, whose it is, when it runs next, how its last run went, and Open automation", async () => {
  const { card, opened } = await agentCard(true);
  hover(card.querySelector(".actor-line .actor-ref") ?? assert.fail("the automation is named"));
  const standing = cards();
  assert.equal(standing.length, 2, "the automation's card hangs over the agent's");
  const automation = standing[1]?.querySelector<HTMLElement>("[data-actor-card='automation']");
  assert.ok(automation, "the automation's card");
  assert.equal(automation.querySelector(".card-name")?.textContent, "Morning Sentry triage");
  assert.equal(automation.querySelector(".card-sub")?.textContent, "Weekdays at 9:00 · UTC");
  assert.equal(automation.querySelector(".card-corner")?.textContent, "Acme");
  const notes = [...automation.querySelectorAll(".card-note")].map((note) => note.textContent);
  assert.equal(notes[0], "Not scheduled");
  assert.match(notes[1] ?? "", /^Last ran .+ · Finished$/u);

  const door = automation.querySelector<HTMLButtonElement>("[data-card-choice]");
  assert.equal(door?.textContent, "Open automation");
  act(() => door?.click());
  assert.deepEqual(opened, [TRIAGE.id]);
});

test("with the Automations experiment off, the card says nothing of the automation, names the teammate who started the agent as before, and the automations go unread", async () => {
  const { card } = await agentCard(false);
  const starter = card.querySelector<HTMLElement>(".actor-line .actor-ref");
  assert.equal(starter?.dataset.kind, "person");
  assert.equal(starter?.querySelector(".actor-ref-name")?.textContent, "Charles Pan");
  assert.doesNotMatch(card.textContent ?? "", /Morning Sentry triage/u);
  assert.deepEqual(listed, []);
});

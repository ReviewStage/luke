// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import { LinkWorkspaceProvider } from "@luke/panel/copy-link-item";
import { AgentTab } from "@luke/panel/tasks/agent-tab";
import {
  agentMessagePlace,
  MESSAGE_GONE,
  type MessageReveal,
  MessageRevealProvider,
} from "@luke/panel/tasks/message-links";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { codingAgentsControl } from "@luke/panel/testing/tasks-control";
import { newestToastSays } from "@luke/panel/testing/toast";
import { ToastHost } from "@luke/panel/toast";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";

/**
 * A message of an agent's transcript has a link of its own: Copy link
 * beside its Copy copies it, under the agent's task, and a link to it
 * brings it into view in the agent's tab, lit once, or says it is gone
 * where the transcript no longer holds it. Synthetic agent.
 */

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
};

/** One of the developer's messages. */
function line(id: string, text: string): CodingAgentMessage {
  return { id, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text }] };
}

const MESSAGES: readonly CodingAgentMessage[] = [
  line("task-1", "Add the invite flow."),
  line("msg-7", "Use seven days."),
];

let root: Root | undefined;
let copied: string[] = [];

beforeEach(() => {
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  fakeAppBridge({
    act: (): Promise<ActOutcome> =>
      Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The agent's tab under a task in Acme, its transcript read page by page as `pages`, then to its end; the reveal standing as given, every ask it let go kept. */
async function drawn(
  reveal: MessageReveal | undefined,
  pages: readonly (readonly CodingAgentMessage[])[] = [MESSAGES],
  agent: CodingAgentSummary = AGENT,
  /** A page held until the test lets it land, by its place among `pages`. */
  held?: { readonly page: number; readonly release: Promise<void> },
): Promise<{
  container: HTMLElement;
  revealed: number[];
  redraw: (next: MessageReveal | undefined) => Promise<void>;
}> {
  const revealed: number[] = [];
  const registry = AtomRegistry.make();
  // Note that the transcript ends on a page with nothing on it, as an ended agent's does, and nothing is read past it.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [agent],
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > pages.length + 1) {
        return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      }
      const page = {
        messages: [...(pages[reads - 1] ?? [])],
        cursor: `${reads}:0`,
        status: agent.status,
        title: null,
      };
      return held !== undefined && held.page === reads - 1
        ? held.release.then(() => page)
        : Promise.resolve(page);
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const draw = (asked: MessageReveal | undefined) =>
    act(() =>
      root?.render(
        onRegistry(
          registry,
          createElement(
            LinkWorkspaceProvider,
            { value: "acme" },
            createElement(ToastHost),
            createElement(
              MessageRevealProvider,
              { value: { reveal: asked, onRevealed: (ask: number) => revealed.push(ask) } },
              createElement(AgentTab, {
                agent,
                control,
                shown: true,
                onOpenSubagent: () => undefined,
                onHeld: () => undefined,
              }),
            ),
          ),
        ),
      ),
    );
  const settle = () =>
    act(async () => {
      for (let tick = 0; tick < 24; tick += 1) await Promise.resolve();
    });
  draw(reveal);
  await settle();
  return {
    container,
    revealed,
    redraw: async (next) => {
      draw(next);
      await settle();
    },
  };
}

/** The element drawing the message of this id. */
function messageNamed(container: HTMLElement, id: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>("[data-message-id]")].find(
    (each) => each.dataset.messageId === id,
  );
  assert.ok(found, `the message ${id} is drawn`);
  return found;
}

test("a message offers Copy link beside its Copy, copying its link under the agent's task, and says Link copied", async () => {
  const { container } = await drawn(undefined);

  const copyLink = messageNamed(container, "msg-7").querySelector<HTMLButtonElement>(
    '[aria-label="Copy link"]',
  );
  assert.ok(copyLink, "the message offers Copy link");
  await act(async () => copyLink.click());

  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${AGENT.planId}/agent/${AGENT.id}/message/msg-7`,
  ]);
  assert.equal(newestToastSays(), "Link copied");
});

test("a link to a message brings it into view, lit once, and lets the ask go", async () => {
  const { container, revealed } = await drawn({
    agentId: AGENT.id,
    messageId: "msg-7",
    ask: 3,
  });

  assert.equal(messageNamed(container, "msg-7").hasAttribute("data-message-revealed"), true);
  assert.equal(messageNamed(container, "task-1").hasAttribute("data-message-revealed"), false);
  assert.deepEqual(revealed, [3]);
});

test("a link to a message the transcript no longer holds says so, and lets the ask go", async () => {
  const { revealed } = await drawn({ agentId: AGENT.id, messageId: "msg-gone", ask: 1 });

  assert.equal(newestToastSays(), MESSAGE_GONE);
  assert.deepEqual(revealed, [1]);
});

test("a link to another agent's message is left for that agent's tab", async () => {
  const { revealed } = await drawn({
    agentId: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
    messageId: "msg-7",
    ask: 1,
  });

  assert.deepEqual(revealed, []);
});

test("a link to a message on a later page of a long transcript waits for its page, then brings it into view", async () => {
  const { container, revealed } = await drawn({ agentId: AGENT.id, messageId: "msg-7", ask: 2 }, [
    [line("task-1", "Add the invite flow.")],
    [line("msg-7", "Use seven days.")],
  ]);

  assert.equal(messageNamed(container, "msg-7").hasAttribute("data-message-revealed"), true);
  assert.notEqual(newestToastSays(), MESSAGE_GONE);
  assert.deepEqual(revealed, [2]);
});

test("a link to the plan an agent was handed, its first message, brings the plan's card into view", async () => {
  const { container, revealed } = await drawn(
    { agentId: AGENT.id, messageId: "task-1", ask: 1 },
    [MESSAGES],
    { ...AGENT, brief: CODING_AGENT_BRIEF.PLAN },
  );

  assert.equal(messageNamed(container, "task-1").hasAttribute("data-message-revealed"), true);
  assert.deepEqual(revealed, [1]);
});

test("a line the service has not read back yet has no link of its own", () => {
  const place = agentMessagePlace(AGENT, MESSAGES);

  assert.equal(place("sent-0f0e"), undefined);
  assert.deepEqual(place("msg-7"), {
    kind: LINK_PLACE.MESSAGE,
    planId: AGENT.planId,
    agentId: AGENT.id,
    messageId: "msg-7",
  });
});

test("a link to a message a working agent wrote since its last idle page waits for the next page, rather than calling it gone", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const working = { ...AGENT, status: CODING_AGENT_STATUS.RUNNING };
  const { container, revealed, redraw } = await drawn(
    undefined,
    [[line("task-1", "Add the invite flow.")], [], [line("msg-7", "Use seven days.")]],
    working,
    { page: 2, release: gate },
  );

  await redraw({ agentId: AGENT.id, messageId: "msg-7", ask: 1 });
  const waited = { revealed: [...revealed], toast: newestToastSays() };
  release();
  await redraw({ agentId: AGENT.id, messageId: "msg-7", ask: 1 });

  assert.deepEqual(waited, { revealed: [], toast: undefined });
  assert.equal(messageNamed(container, "msg-7").hasAttribute("data-message-revealed"), true);
  assert.deepEqual(revealed, [1]);
});

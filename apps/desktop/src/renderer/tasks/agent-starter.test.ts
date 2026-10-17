// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON } from "@luke/features/failure-remedy";
import { CALL_KIND } from "@luke/features/turn-rows";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { ACTOR_KIND, SOMEONE_REASON } from "@luke/ui/actor-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool";
import { MemberDirectory } from "../member-directory";
import { AgentRef, agentCardReading, NOTHING_HELD } from "./agent-ref";
import {
  agentActor,
  endLine,
  endLineReason,
  lineSender,
  macOwnerOf,
  teammateStarter,
} from "./coding-agent-model";
import { MacOwnerProvider, TranscriptTool } from "./transcript-blocks";

/**
 * agent-starter.test.ts -- an agent a teammate started says so: its card
 * names them by their disc and name, which hang their own card over the
 * agent's, a command it ran on a Mac says it ran on theirs, and a key its
 * turn failed on is theirs, which the reader is not sent to their own
 * Settings to mend. The reader's own agent reads as before. Synthetic
 * throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const CHARLES_PICTURE = "https://lh3.googleusercontent.com/a/photo-7";

/** The workspace's members as the service's read lists them. */
const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  {
    ...CHARLES,
    email: "charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
    pictureUrl: CHARLES_PICTURE,
  },
];

const WORKSPACE = { id: "workspace-acme", memberCount: MEMBERS.length };

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.FAILED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
  startedBy: CHARLES,
};

const PULL_REQUEST: CodingAgentPullRequest = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." },
        ),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** `element` drawn inside the workspace's members as `readerId` reads them, once the members have answered. */
async function drawn(element: ReactElement, readerId: string | undefined): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const directory = createElement(MemberDirectory, {
    workspace: WORKSPACE,
    readerId,
    children: element,
  });
  act(() => root?.render(onRegistry(AtomRegistry.make(), directory)));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** Rests the pointer on `element`, as hovering it does. */
function hover(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
}

/** The cards standing in the window, the first hung first. */
function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".luke-tooltip-card:not([data-leaving])")];
}

/** The agent named where `readerId` reads it, as the Inbox's thread names it, its card hung once the pointer rests on it, and how many times it was opened. */
async function agentNamed(
  readerId: string | undefined,
  pullRequests: ReadonlyMap<string, CodingAgentPullRequest> = new Map(),
) {
  const opened: string[] = [];
  const read = agentCardReading(AGENT, "Invite flow", NOTHING_HELD, false, {
    me: readerId,
    pullRequests,
  });
  const view = await drawn(
    createElement(AgentRef, {
      subject: { name: "Invite flow", tile: agentActor(AGENT, "Invite flow"), read },
      models: [],
      onOpen: () => opened.push(AGENT.id),
      children: "Invite flow",
    }),
    readerId,
  );
  const ref = view.querySelector("[data-agent-ref]") ?? assert.fail("the agent is named");
  hover(ref);
  const card = cards()[0] ?? assert.fail("a card hangs");
  assert.ok(card.querySelector("[data-tab-card]"), "the agent's card hangs");
  return { card, opened };
}

test("a teammate's agent's card says it was started by them, their disc and name read against the workspace's members, and the reader's own names no starter", async () => {
  assert.equal(teammateStarter(AGENT.startedBy, DEAN.userId), "Charles Pan");
  assert.equal(teammateStarter(AGENT.startedBy, CHARLES.userId), undefined);
  assert.equal(teammateStarter(undefined, DEAN.userId), undefined);
  // With no account id, whose agent it is cannot be told, so nobody is named and the reader's own key keeps its Settings.
  assert.equal(teammateStarter(AGENT.startedBy, undefined), undefined);

  const { card } = await agentNamed(DEAN.userId);
  const line = card.querySelector(".actor-words") ?? assert.fail("the card names its starter");
  const starter = line.querySelector<HTMLElement>(".actor-ref") ?? assert.fail("as an actor");
  assert.equal(line.firstChild?.textContent, "Started by ");
  assert.equal(starter.dataset.kind, "person");
  assert.equal(starter.querySelector(".actor-ref-name")?.textContent, "Charles Pan");
  assert.equal(starter.querySelector("img")?.getAttribute("src"), CHARLES_PICTURE);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const own = await agentNamed(CHARLES.userId);
  assert.doesNotMatch(own.card.textContent ?? "", /Started by/u);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const unknown = await agentNamed(undefined);
  assert.doesNotMatch(unknown.card.textContent ?? "", /Started by/u);
});

test("the starter's name on an agent's card hangs their own card over it, read only, and the agent's card stays standing beneath", async () => {
  const { card } = await agentNamed(DEAN.userId);
  const starter = card.querySelector(".actor-words .actor-ref") ?? assert.fail("the starter");
  assert.equal(starter.tagName, "SPAN", "a person has no page to press through to");

  hover(starter);
  const standing = cards();
  assert.equal(standing.length, 2, "the person's card hangs over the agent's");
  assert.ok(standing[0]?.querySelector("[data-tab-card]"), "the agent's card still stands");
  const person = standing[1]?.querySelector("[data-actor-card='person']");
  assert.ok(person, "the starter's own card hangs");
  assert.match(person.textContent ?? "", /Charles Pan.*charles@example\.com.*Member/u);
  assert.equal(person.querySelector("button"), null);
});

/** Moves the pointer from `from` onto `to`, as the window tells it: out of the one, over the other. */
function move(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}

/** Lets `ms` pass on the faked clock a card waits and lingers on. */
function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Longer than a card waits to show and lingers once left (`--hint-delay`, `CARD_LINGER`). */
const PAST_ANY_WAIT = 1_000;

/** The agent's card and the starter's card over it, the pointer resting on the starter's, each shown past its wait. */
async function stacked() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { card } = await agentNamed(DEAN.userId);
  pass(PAST_ANY_WAIT);
  const control = document.querySelector("[data-agent-ref]") ?? assert.fail("the agent is named");
  move(control, card);
  const starter = card.querySelector(".actor-words .actor-ref") ?? assert.fail("the starter");
  move(card, starter);
  pass(PAST_ANY_WAIT);
  const theirs = cards()[1] ?? assert.fail("the starter's card hangs over the agent's");
  // The pointer crosses the gap between the starter and their card, which stands on neither card.
  const gap = document.body.appendChild(document.createElement("div"));
  move(starter, gap);
  move(gap, theirs);
  return { card, theirs, gap };
}

test("the pointer resting on a starter's card keeps both it and the agent's card beneath standing, however long it rests", async () => {
  try {
    await stacked();
    pass(PAST_ANY_WAIT);
    const standing = cards();
    assert.equal(standing.length, 2, "both cards stand while the pointer rests on the upper");
    assert.ok(standing[0]?.querySelector("[data-tab-card]"), "the agent's card");
    assert.ok(standing[1]?.querySelector("[data-actor-card='person']"), "the starter's card");
  } finally {
    vi.useRealTimers();
  }
});

test("the pointer leaving a starter's card for outside both cards takes both down once they have lingered", async () => {
  try {
    const { theirs } = await stacked();
    const outside = document.body.appendChild(document.createElement("div"));
    move(theirs, outside);
    assert.equal(cards().length, 2, "both linger for the pointer to come back");
    pass(PAST_ANY_WAIT);
    assert.equal(cards().length, 0);
  } finally {
    vi.useRealTimers();
  }
});

test("the pointer going back from a starter's card to the agent's keeps the agent's standing and takes the starter's down once it has lingered", async () => {
  try {
    const { card, theirs, gap } = await stacked();
    move(theirs, gap);
    move(gap, card);
    pass(PAST_ANY_WAIT);
    const standing = cards();
    assert.equal(standing.length, 1);
    assert.ok(standing[0]?.querySelector("[data-tab-card]"), "the agent's card stands");
    const outside = document.body.appendChild(document.createElement("div"));
    move(card, outside);
    pass(PAST_ANY_WAIT);
    assert.equal(cards().length, 0, "and goes once the pointer leaves it in turn");
  } finally {
    vi.useRealTimers();
  }
});

test("the pointer going from a starter's card back onto the agent's own name keeps the agent's card and takes the starter's down once it has lingered", async () => {
  try {
    const { theirs } = await stacked();
    const control = document.querySelector("[data-agent-ref]") ?? assert.fail("the agent's name");
    move(theirs, control);
    pass(PAST_ANY_WAIT);
    const standing = cards();
    assert.equal(standing.length, 1);
    assert.ok(standing[0]?.querySelector("[data-tab-card]"), "the agent's card stands");
  } finally {
    vi.useRealTimers();
  }
});

test("an agent's card wears its tile beside its name and its pull request at the corner where the plan holds one, and offers no Open agent, since the name it hangs from opens the tab", async () => {
  const { card, opened } = await agentNamed(DEAN.userId, new Map([[AGENT.id, PULL_REQUEST]]));
  const tile = card.querySelector<HTMLElement>(".actor-card-head > .actor-mark");
  assert.equal(tile?.dataset.kind, "agent");
  assert.equal(tile?.dataset.size, "card");
  const corner =
    card.querySelector(".luke-hover-card-corner") ?? assert.fail("the head has a corner");
  assert.ok(corner.querySelector("[data-pull-request-mark]"), "the pull request's mark leads it");
  assert.match(corner.textContent ?? "", /^#42 · Failed/u);

  const offers = [...card.querySelectorAll("button")].map((button) => button.textContent ?? "");
  assert.deepEqual(
    offers.filter((words) => words.startsWith("Open")),
    [],
    "the card offers no way to the tab",
  );
  assert.equal(
    card.querySelector(".luke-hover-card-rule")?.outerHTML,
    undefined,
    "nor a rule to stand one under",
  );
  act(() => document.querySelector<HTMLElement>("[data-agent-ref]")?.click());
  assert.deepEqual(opened, [AGENT.id]);
});

test("a key a teammate's agent failed on is named as theirs, with no Settings of the reader's to mend it", () => {
  const failed = (failure: typeof CODING_AGENT_FAILURE.PROVIDER_KEY, starter?: string) =>
    endLine(CODING_AGENT_STATUS.FAILED, failure, undefined, starter);

  assert.equal(
    failed(CODING_AGENT_FAILURE.PROVIDER_KEY, "Charles Pan"),
    "Failed: Charles Pan's API key was refused or can't be read",
  );
  assert.equal(
    endLineReason(CODING_AGENT_FAILURE.PROVIDER_KEY, "Charles Pan"),
    FAILURE_REASON.OTHER,
  );
  assert.match(failed(CODING_AGENT_FAILURE.PROVIDER_KEY) ?? "", /your API key was refused/u);
  assert.equal(endLineReason(CODING_AGENT_FAILURE.PROVIDER_KEY), FAILURE_REASON.API_KEY);
  assert.equal(
    endLine(
      CODING_AGENT_STATUS.FAILED,
      CODING_AGENT_FAILURE.FAST_ON_OWN_KEY,
      undefined,
      "Charles Pan",
    ),
    "Failed: Fast isn't available on Charles Pan's own API key; choose the model with Fast off",
  );
});

/** A Mac command's place, as its row's pill says it, in the transcript of an agent `startedBy` started, as `readerId` reads it. */
async function macPlace(
  startedBy: typeof CHARLES | undefined,
  readerId: string | undefined,
): Promise<HTMLElement> {
  const row = createElement(TranscriptTool, {
    state: TOOL_STATE.OUTPUT_AVAILABLE,
    kind: CALL_KIND.MAC_COMMAND,
    subject: "pnpm test",
    input: { kind: TOOL_BLOCK.COMMAND, text: "pnpm test" },
    output: { kind: TOOL_BLOCK.TEXT, text: "ok" },
    errorText: undefined,
  });
  const view = await drawn(
    createElement(MacOwnerProvider, {
      value: macOwnerOf(startedBy, MEMBERS, readerId),
      children: row,
    }),
    readerId,
  );
  const pill = view.querySelector<HTMLElement>(".rounded.border");
  assert.ok(pill, "the row says where the command ran");
  return pill;
}

test("a command an agent ran on a Mac says whose, by their disc and name: a teammate's, the reader's own, or the reader's where the window cannot tell", async () => {
  const theirs = await macPlace(CHARLES, DEAN.userId);
  assert.equal(theirs.querySelector(".actor-ref .actor-ref-name")?.textContent, "Charles Pan’s");
  assert.equal(theirs.querySelector(".actor-words")?.lastChild?.textContent, " Mac");
  assert.equal(theirs.querySelector(".actor-words")?.firstChild?.textContent, "On ");
  act(() => root?.unmount());

  const yours = await macPlace(CHARLES, CHARLES.userId);
  assert.equal(yours.querySelector(".actor-ref .actor-ref-name")?.textContent, "your");
  assert.equal(yours.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
  act(() => root?.unmount());

  const untold = await macPlace(CHARLES, undefined);
  assert.equal(untold.textContent?.trim(), "On your Mac");
  assert.equal(untold.querySelector(".actor-mark"), null);
});

test("a starter or sender who left keeps their picture and their account's name now, from the read of who left", () => {
  const lee = { userId: "user-lee", name: "Lee Park" };
  const former = [
    {
      userId: "user-lee",
      name: "Lee Chen",
      pictureUrl: "https://lh3.googleusercontent.com/a/photo-7",
    },
  ];
  const left = {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Lee Chen",
    userId: "user-lee",
    pictureUrl: "https://lh3.googleusercontent.com/a/photo-7",
  };

  assert.deepEqual(macOwnerOf(lee, MEMBERS, "user-dean", former), left);
  assert.deepEqual(
    lineSender({ ...lee, kind: CODING_AGENT_SENDER.MEMBER }, "user-dean", MEMBERS, former),
    left,
  );
});

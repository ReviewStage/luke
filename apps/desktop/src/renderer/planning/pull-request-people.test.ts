// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_AUTHOR,
  CODING_AGENT_STATUS,
  type CodingAgentChangesPeople,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
  REVIEW_STATE,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/plans-control";
import { MemberDirectory } from "../member-directory";
import { Tooltip } from "../tooltip";
import { AgentChangesTab, ChangesCard, peopleOf } from "./agent-changes-tab";
import { agentSubject, NOTHING_HELD } from "./agent-ref";

/**
 * pull-request-people.test.ts -- an agent's Changes tab and its card say
 * who its pull request names as every actor is drawn: Luke's own bot as the
 * agent, a linked teammate as the member, anyone else as themself on
 * GitHub, a person's circle or an App's bot's square; each reviewer's face
 * wears where they stand and hangs their card; the reviews that said
 * something fold under their count. Synthetic people throughout.
 */

const CHARLES: WorkspaceMember = {
  userId: "user-charles",
  name: "Charles Pan",
  email: "charles@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};
const WORKSPACE = { id: "workspace-acme", memberCount: 2 };

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const LUKE_BOT = { login: "luke[bot]", bot: true, luke: true };
const CHARLES_ON_GITHUB = { login: "charlespan", bot: false, userId: CHARLES.userId };
const OCTOCAT = { login: "octocat", bot: false };
const DEVIN = { login: "devin-ai-integration[bot]", bot: true };

const PEOPLE: CodingAgentChangesPeople = {
  author: LUKE_BOT,
  reviewers: [
    { by: CHARLES_ON_GITHUB, state: REVIEW_STATE.APPROVED },
    { by: OCTOCAT, state: REVIEW_STATE.REQUESTED },
    { by: DEVIN, state: REVIEW_STATE.COMMENTED },
  ],
  commitAuthors: [LUKE_BOT, CHARLES_ON_GITHUB],
  comments: [
    { by: DEVIN, state: REVIEW_STATE.COMMENTED, excerpt: "Found 1 potential issue.", at: 1_000 },
    { by: CHARLES_ON_GITHUB, state: REVIEW_STATE.APPROVED, excerpt: "Ship it.", at: 2_000 },
  ],
};

const PULL_REQUEST = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 4,
  deletions: 1,
  changedFiles: 1,
};

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act) =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: [CHARLES] }
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

/** Draws `element` inside the workspace's member directory, its reads landed. */
async function draw(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MemberDirectory, {
          workspace: WORKSPACE,
          readerId: "user-dana",
          children: element,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The plan's agents, the one whose pull request it is among them, its changes naming the people given. */
function controlNaming(people: CodingAgentChangesPeople) {
  return codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([[AGENT.id, PULL_REQUEST]]),
    readChanges: () =>
      Promise.resolve({
        pullRequest: {
          url: PULL_REQUEST.url,
          truncated: false,
          files: [
            {
              path: "src/expiry.ts",
              previousPath: null,
              status: CHANGED_FILE_STATUS.MODIFIED,
              additions: 1,
              deletions: 0,
              omitted: null,
              patch: "@@ -1 +1,2 @@\n const a = 1;\n+const b = 2;\n",
            },
          ],
          ...people,
        },
      }),
  });
}

const control = controlNaming(PEOPLE);

/** Rests the pointer on a control, which hangs its card. */
function hover(control: Element): void {
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
}

test("the Changes tab says who opened the pull request, its reviewers by where each stands, and who authored its commits, each the actor they are to the reader", async () => {
  const tab = await draw(
    createElement(AgentChangesTab, {
      agentId: AGENT.id,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
    }),
  );
  const strip =
    tab.querySelector(".changes-people") ?? assert.fail("the people stand under the bar");

  const opener = strip.querySelector(".actor-ref") ?? assert.fail("who opened it is named");
  assert.equal(
    opener.textContent,
    "Expiry job",
    "Luke's own bot is the agent whose pull request it is",
  );
  assert.equal(opener.getAttribute("data-kind"), "agent");

  const reviewers =
    strip.querySelector('[aria-label="Reviewers"]') ?? assert.fail("the reviewers stand");
  const faces = [...reviewers.querySelectorAll<HTMLElement>(".actor-stack-face")];
  assert.deepEqual(
    faces.map((face) => [
      face.getAttribute("aria-label"),
      face.querySelector(".actor-mark")?.getAttribute("data-kind"),
      face.querySelector(".actor-mark")?.getAttribute("data-bot") ?? null,
      face.querySelector("[data-review-state]")?.getAttribute("data-review-state"),
    ]),
    [
      ["Charles Pan · Approved", "person", null, "approved"],
      ["octocat · Review requested", "github", null, "requested"],
      ["devin-ai-integration · Commented", "github", "true", "commented"],
    ],
  );
  hover(faces[1] ?? assert.fail("octocat's face"));
  const card = document.querySelector('.tooltip-card [data-actor-card="github"]');
  assert.match(card?.textContent ?? "", /@octocat.*GitHub user.*Not in this workspace/u);

  const commits =
    strip.querySelector('[aria-label="Commit authors"]') ?? assert.fail("commit authors stand");
  assert.deepEqual(
    [...commits.querySelectorAll(".actor-stack-face")].map((face) =>
      face.getAttribute("aria-label"),
    ),
    ["Expiry job", "Charles Pan"],
  );
});

test("a pull request the agent opened as its developer names them and Luke among the commit authors, and one it opened as the App says why", async () => {
  const strip = async (people: CodingAgentChangesPeople) => {
    const tab = await draw(
      createElement(AgentChangesTab, {
        agentId: AGENT.id,
        control: controlNaming(people),
        shown: true,
        repository: "acme/relay",
        tree: { open: false, onToggle: () => undefined },
      }),
    );
    const found =
      tab.querySelector(".changes-people") ?? assert.fail("the people stand under the bar");
    const opener = found.querySelector(".actor-words") ?? assert.fail("who opened it is named");
    const commits = [
      ...found.querySelectorAll('[aria-label="Commit authors"] .actor-stack-face'),
    ].map((face) => face.getAttribute("aria-label"));
    act(() => root?.unmount());
    document.body.innerHTML = "";
    return {
      opener: opener.querySelector(".actor-ref-name")?.textContent,
      line: opener.textContent ?? "",
      commits,
    };
  };

  const developer = await strip({
    author: CHARLES_ON_GITHUB,
    writtenAs: CODING_AGENT_AUTHOR.DEVELOPER,
    commitAuthors: [CHARLES_ON_GITHUB, LUKE_BOT],
  });
  const unlinked = await strip({
    author: LUKE_BOT,
    writtenAs: CODING_AGENT_AUTHOR.APP_UNLINKED,
    commitAuthors: [LUKE_BOT],
  });

  assert.equal(developer.opener, "Charles Pan");
  assert.doesNotMatch(developer.line, /as the GitHub App/u);
  assert.deepEqual(developer.commits, ["Charles Pan", "Expiry job"]);
  const lapsed = await strip({
    author: LUKE_BOT,
    writtenAs: CODING_AGENT_AUTHOR.DEVELOPER,
    commitAuthors: [CHARLES_ON_GITHUB, LUKE_BOT],
  });
  assert.match(
    lapsed.line,
    /Expiry job as the GitHub App, since its starter's GitHub sign-in could not be used$/u,
  );
  assert.equal(unlinked.opener, "Expiry job");
  assert.match(
    unlinked.line,
    /Expiry job as the GitHub App, since its starter has no GitHub linked$/u,
  );
});

test("the reviews that said something fold under their count, each by its reviewer, where it left them, and the start of its words", async () => {
  const tab = await draw(
    createElement(AgentChangesTab, {
      agentId: AGENT.id,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
    }),
  );
  const folded =
    tab.querySelector<HTMLDetailsElement>("details.changes-comments") ??
    assert.fail("the comments fold");
  assert.equal(folded.open, false);
  assert.equal(folded.querySelector("summary")?.textContent, "Review comments 2");
  assert.deepEqual(
    [...folded.querySelectorAll(".changes-comment")].map((comment) => [
      comment.querySelector(".actor-ref")?.getAttribute("data-kind"),
      comment.querySelector(".actor-ref-name")?.textContent,
      comment.querySelector(".changes-comment-state")?.textContent,
      comment.querySelector(".changes-comment-words")?.textContent,
    ]),
    [
      ["github", "devin-ai-integration", "Commented", "Found 1 potential issue."],
      ["person", "Charles Pan", "Approved", "Ship it."],
    ],
  );
});

test("a Changes card says who opened the pull request and its reviewers once its tab has read them, and neither before", async () => {
  const subject = agentSubject(control, AGENT.id, NOTHING_HELD, false);
  const card = (people: CodingAgentChangesPeople | undefined) =>
    draw(
      createElement(ChangesCard, {
        subject,
        models: [],
        pullRequest: PULL_REQUEST,
        people,
        onOpenAgent: () => undefined,
      }),
    );
  const unread = await card(undefined);
  assert.equal(unread.querySelector(".actor-stack"), null);
  assert.doesNotMatch(unread.textContent ?? "", /Opened by/u);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const read = await card(PEOPLE);
  assert.match(read.textContent ?? "", /Opened by.*Expiry job/u);
  assert.equal(read.querySelectorAll('[aria-label="Reviewers"] .actor-stack-face').length, 3);
});

test("a pull request that changes no file still says who it names and its review comments, over the line saying it changes nothing", async () => {
  const tab = await draw(
    createElement(AgentChangesTab, {
      agentId: AGENT.id,
      control: {
        ...control,
        readChanges: () =>
          Promise.resolve({
            pullRequest: { url: PULL_REQUEST.url, truncated: false, files: [], ...PEOPLE },
          }),
      },
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
    }),
  );
  assert.ok(tab.querySelector(".changes-people"), "the people stand");
  assert.ok(tab.querySelector("details.changes-comments"), "the comments stand");
  assert.match(tab.textContent ?? "", /This pull request changes no files\./u);
});

test("a card says the people its tab read only for the pull request they were read for", () => {
  const held = { url: PULL_REQUEST.url, people: PEOPLE };
  assert.equal(peopleOf(held, PULL_REQUEST), PEOPLE);
  assert.equal(peopleOf(held, { url: "https://github.com/acme/relay/pull/43" }), undefined);
  assert.equal(peopleOf(undefined, PULL_REQUEST), undefined);
});

test("reviewers past the pile's last face are counted, and the count hangs a card naming each with where they stand", async () => {
  const many = Array.from({ length: 6 }, (_, at) => ({
    by: { login: `reviewer${at}`, bot: false },
    state: at === 5 ? REVIEW_STATE.CHANGES_REQUESTED : REVIEW_STATE.APPROVED,
  }));
  const card = await draw(
    createElement(ChangesCard, {
      subject: agentSubject(control, AGENT.id, NOTHING_HELD, false),
      models: [],
      pullRequest: PULL_REQUEST,
      people: { reviewers: many },
      onOpenAgent: () => undefined,
    }),
  );
  const more =
    card.querySelector('[aria-label="Reviewers"] .actor-stack-more') ??
    assert.fail("the rest are counted");
  assert.equal(more.textContent, "+1");
  assert.equal(more.getAttribute("aria-label"), "reviewer5 · Changes requested");
  hover(more);
  const rest = [
    ...document.querySelectorAll('.tooltip-card [data-actor-card="more"] .actor-more-row'),
  ];
  assert.deepEqual(
    rest.map((row) => [
      row.querySelector(".actor-mark")?.getAttribute("data-kind"),
      row.lastElementChild?.textContent,
    ]),
    [["github", "reviewer5 · Changes requested"]],
  );
});

test("the count's card naming many reviewers scrolls within itself and stands, and the window scrolling takes it down", async () => {
  const many = Array.from({ length: 50 }, (_, at) => ({
    by: { login: `reviewer${at}`, bot: false },
    state: REVIEW_STATE.APPROVED,
  }));
  const card = await draw(
    createElement(ChangesCard, {
      subject: agentSubject(control, AGENT.id, NOTHING_HELD, false),
      models: [],
      pullRequest: PULL_REQUEST,
      people: { reviewers: many },
      onOpenAgent: () => undefined,
    }),
  );
  hover(
    card.querySelector('[aria-label="Reviewers"] .actor-stack-more') ??
      assert.fail("the rest are counted"),
  );
  const list = document.querySelector('.tooltip-card [data-actor-card="more"] .actor-more-list');
  assert.equal(list?.children.length, 45);
  act(() => {
    list?.dispatchEvent(new Event("scroll"));
  });
  assert.ok(
    document.querySelector('[data-actor-card="more"]'),
    "scrolling the card's own list leaves it standing",
  );
  act(() => {
    document.dispatchEvent(new Event("scroll"));
  });
  assert.equal(
    document.querySelector('.tooltip-card:not([data-leaving]) [data-actor-card="more"]'),
    null,
    "the window scrolling takes it down",
  );
});

test("the count's card hung from a Changes card that itself hangs over its tab scrolls within itself, and both cards stand", async () => {
  const many = Array.from({ length: 50 }, (_, at) => ({
    by: { login: `reviewer${at}`, bot: false },
    state: REVIEW_STATE.APPROVED,
  }));
  const changesCard = createElement(ChangesCard, {
    subject: agentSubject(control, AGENT.id, NOTHING_HELD, false),
    models: [],
    pullRequest: PULL_REQUEST,
    people: { reviewers: many },
    onOpenAgent: () => undefined,
  });
  const tab = await draw(
    createElement(Tooltip, {
      label: "Changes: Expiry job",
      card: changesCard,
      children: createElement(
        "button",
        { type: "button", "aria-describedby": undefined },
        "Changes: Expiry job",
      ),
    }),
  );
  hover(tab.querySelector("button") ?? assert.fail("the tab stands"));
  hover(
    document.querySelector('.tooltip-card [aria-label="Reviewers"] .actor-stack-more') ??
      assert.fail("the Changes card counts the rest"),
  );
  const list = document.querySelector('.tooltip-card [data-actor-card="more"] .actor-more-list');
  assert.ok(list, "the count's card hangs over the Changes card");
  act(() => {
    list.dispatchEvent(new Event("scroll"));
  });
  assert.ok(document.querySelector('.tooltip-card:not([data-leaving]) [data-actor-card="more"]'));
  assert.ok(document.querySelector(".tooltip-card:not([data-leaving]) [data-tab-card]"));
});

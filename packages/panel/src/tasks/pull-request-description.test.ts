// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentOverviewPullRequest,
  type CodingAgentSummary,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_REFUSAL,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestWriteAnswer,
} from "@luke/features/pull-request-write-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import { GitHubConnectProvider } from "../github-connect.js";
import { MemberDirectory } from "../member-directory.js";
import { announcedAsAlert, mountAnnouncer } from "../testing/announcer.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { installEditorLayout } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { AgentPullRequestTab } from "./agent-pull-request-tab.js";
import { PULL_REQUEST_VIEW } from "./use-side-panel.js";

/**
 * pull-request-description.test.ts -- a pull request's description edited
 * in place from its Pull request tab: a click on GitHub's rendering opens
 * the plan's editor on the Markdown where the member may edit it, and none
 * where they may not; Esc with nothing changed writes nothing; a change is
 * written to GitHub with the words it began from, and the description is
 * drawn again from the read that follows; and where the description changed
 * on GitHub meanwhile, the draft stays, saying so, until Reload, asked
 * first, opens GitHub's words in its place. The editor is the real one, from
 * its bundle; GitHub is the act port's answer. Synthetic pull request.
 */

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

const PAGE = "https://github.com/acme/relay/pull/42";

/** The description as written, as github.com saves one edited on the web. */
const BODY = "## Summary\r\n\r\nExpires invitations after seven days.\r\n";

/** GitHub's rendering of a description, as the overview carries it. */
function htmlOf(body: string): string {
  return body
    .split(/\r?\n\r?\n/u)
    .filter((block) => block.trim() !== "")
    .map((block) =>
      block.startsWith("## ")
        ? `<h2>${block.slice(3).trim()}</h2>`
        : `<p dir="auto">${block.trim()}</p>`,
    )
    .join("");
}

/** The pull request itself, as its overview's first read answers it, its description as GitHub holds it now. */
function pullRequestOf(body: string, canEditDescription: boolean): CodingAgentOverviewPullRequest {
  return {
    number: 42,
    title: "Expire invitations",
    url: PAGE,
    state: PULL_REQUEST_STATE.OPEN,
    body,
    html: htmlOf(body),
    canEditDescription,
    base: "main",
    head: "luke/expiry-job",
    createdAt: 1_000,
    mergedAt: null,
    merge: MERGE_STATE.CLEAN,
    author: { login: "luke-agent[bot]", bot: true },
    requested: [],
  };
}

let root: Root | undefined;
let bundles: SideBundles;
/** The description as GitHub holds it, which each read answers anew and a change GitHub takes moves. */
let onGitHub = BODY;
/** Every change to the pull request the tab asked for, in order. */
let changes: PullRequestActionRequest[] = [];
/** How the service answers the next change asked for. */
let changeAnswer: PullRequestWriteAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
/** What the service waits on before it answers a change, where a test holds it; none answers at once. */
let changeHeld: Promise<void> | undefined;

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({
      planEditor: () => import("../plan-editor/index.js").then((entry) => entry.planEditor),
    }),
  );
  await Effect.runPromise(markdownHtmlParserLanded);
});

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  installEditorLayout();
  onGitHub = BODY;
  changes = [];
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
  changeHeld = undefined;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: ({ request }) => {
      changes.push(request);
      if (
        changeAnswer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE &&
        request.action === PULL_REQUEST_ACTION.EDIT_DESCRIPTION
      ) {
        onGitHub = request.body;
      }
      const answer = changeAnswer;
      return (changeHeld ?? Promise.resolve()).then(() => answer);
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "caretRangeFromPoint");
  Reflect.deleteProperty(document, "elementFromPoint");
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The agent's Pull request tab, its reads answering the description as GitHub holds it, which the member may edit or not. */
async function drawTab(canEditDescription = true): Promise<HTMLElement> {
  const control = codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([
      [
        AGENT.id,
        {
          number: 42,
          title: "Expire invitations",
          url: PAGE,
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 4,
          deletions: 1,
          changedFiles: 1,
        },
      ],
    ]),
    readOverviewPullRequest: () =>
      Promise.resolve({ pullRequest: pullRequestOf(onGitHub, canEditDescription) }),
    readOverviewChecks: () => Promise.resolve({ pullRequest: { checks: [] } }),
    readOverviewConversation: () =>
      Promise.resolve({ pullRequest: { reviewers: [], conversation: [], earlier: 0 } }),
  });
  const tab = createElement(AgentPullRequestTab, {
    agentId: AGENT.id,
    control,
    shown: true,
    repository: "acme/relay",
    tree: { open: false, onToggle: () => undefined },
    view: PULL_REQUEST_VIEW.CONVERSATION,
    onView: () => undefined,
    onActions: () => undefined,
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          bundles,
          createElement(GitHubConnectProvider, {
            value: {
              connection: undefined,
              connect: () => Promise.resolve(false),
              disconnect: () => Promise.resolve(false),
            },
            children: createElement(MemberDirectory, {
              workspace: { id: "workspace-acme", memberCount: 2 },
              readerId: "user-dana",
              children: tab,
            }),
          }),
        ),
      ),
    ),
  );
  await settle();
  return container;
}

/** The Description section of the tab. */
function description(container: HTMLElement): HTMLElement {
  return (
    container.querySelector<HTMLElement>('section[aria-label="Description"]') ??
    assert.fail("the description is drawn")
  );
}

/**
 * A click on the description's drawn words, as a member's on them, landing
 * `at` characters into them. Note that the page the browser would lay out
 * is answered here, since jsdom lays nothing out: the point lands on the
 * words clicked, and on no element of the editor's.
 */
async function clickWords(container: HTMLElement, words: string, at = 0): Promise<void> {
  const target =
    [...description(container).querySelectorAll("p")].find((each) => each.textContent === words) ??
    assert.fail(`${words} are drawn`);
  const text = target.firstChild ?? assert.fail("the words are a text node");
  Object.defineProperty(document, "caretRangeFromPoint", {
    configurable: true,
    value: () => {
      const range = document.createRange();
      range.setStart(text, at);
      return range;
    },
  });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 4, clientY: 4 }));
  });
  await settle();
}

/** The description's open editor; none while it is drawn. */
function editorIn(container: HTMLElement): TiptapEditorHTMLElement | null {
  return description(container).querySelector<TiptapEditorHTMLElement>(".ProseMirror");
}

/** A key pressed in the open editor. */
async function press(element: HTMLElement, key: string): Promise<void> {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Words typed at the end of the open editor's text, as its own input inserts them. */
function typeAtEnd(element: TiptapEditorHTMLElement, words: string): void {
  const editor = element.editor ?? assert.fail("the editor is running");
  act(() => {
    editor.commands.focus("end");
    editor.view.dispatch(editor.state.tr.insertText(words));
  });
}

/** The button of the given words, wherever it is drawn. */
function button(within: ParentNode, words: string): HTMLButtonElement {
  return (
    [...within.querySelectorAll("button")].find((each) => each.textContent === words) ??
    assert.fail(`${words} is offered`)
  );
}

test("a click on the description opens the editor on its Markdown, and Esc with nothing changed writes nothing and draws it again", async () => {
  const container = await drawTab();

  await clickWords(
    container,
    "Expires invitations after seven days.",
    "Expires invitations after ".length,
  );
  const editor = editorIn(container) ?? assert.fail("the editor opens in the description's place");
  assert.equal(editor.getAttribute("aria-label"), "Description");
  assert.match(editor.textContent ?? "", /Expires invitations after seven days\./u);
  const { state } = editor.editor ?? assert.fail("the editor is running");
  assert.equal(
    state.doc.textBetween(state.selection.from, state.selection.from + "seven".length),
    "seven",
    "the caret stands where the click landed",
  );

  await press(editor, "Escape");

  assert.deepEqual(changes, []);
  assert.equal(editorIn(container), null, "the editor closes");
  assert.match(description(container).textContent ?? "", /Expires invitations after seven days\./u);
});

test("an edit is written to GitHub with the words it began from, line endings kept, and the description is drawn again from the read after it", async () => {
  const container = await drawTab();
  await clickWords(container, "Expires invitations after seven days.");
  const editor = editorIn(container) ?? assert.fail("the editor opens");

  typeAtEnd(editor, " Accepted ones stay.");
  await press(editor, "Escape");

  assert.deepEqual(changes, [
    {
      action: PULL_REQUEST_ACTION.EDIT_DESCRIPTION,
      body: "## Summary\r\n\r\nExpires invitations after seven days. Accepted ones stay.\r\n",
      expectedBody: BODY,
    },
  ]);
  assert.equal(editorIn(container), null, "the editor closes once the read lands");
  assert.ok(
    [...description(container).querySelectorAll("p")].some(
      (each) => each.textContent === "Expires invitations after seven days. Accepted ones stay.",
    ),
    "GitHub's rendering of the new words is drawn",
  );
});

test("a description changed on GitHub keeps the draft open and says so, and Reload, asked first, opens GitHub's words in its place", async () => {
  mountAnnouncer();
  const container = await drawTab();
  await clickWords(container, "Expires invitations after seven days.");
  const editor = editorIn(container) ?? assert.fail("the editor opens");
  changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "The description changed on GitHub since you opened it.",
    reason: PULL_REQUEST_REFUSAL.DESCRIPTION_CHANGED,
  };
  onGitHub = "## Summary\r\n\r\nExpires invitations after a week.\r\n";

  typeAtEnd(editor, " Mine.");
  await press(editor, "Escape");

  const kept = editorIn(container) ?? assert.fail("the editor stays open");
  assert.match(kept.textContent ?? "", /seven days\. Mine\./u, "the draft stays");
  const alert =
    description(container).querySelector(".plan-editor-note") ?? assert.fail("a refusal is said");
  assert.match(alert.textContent ?? "", /changed on GitHub/u);
  assert.match(announcedAsAlert(), /changed on GitHub/u, "and announced as an alert");

  act(() => button(alert, "Reload").click());
  await settle();
  assert.match(
    kept.textContent ?? "",
    /Mine\./u,
    "nothing is dropped before the question is answered",
  );
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("Reload asks first");
  act(() => button(question, "Reload").click());
  await settle();
  await settle();

  const reloaded = editorIn(container) ?? assert.fail("the editor opens again");
  assert.match(reloaded.textContent ?? "", /after a week\./u, "GitHub's words stand");
  assert.doesNotMatch(reloaded.textContent ?? "", /Mine\./u, "the draft is dropped");
  assert.equal(changes.length, 1, "Reload writes nothing");
});

test("a member who may not edit the description gets no editor", async () => {
  const container = await drawTab(false);

  await clickWords(container, "Expires invitations after seven days.");

  assert.equal(editorIn(container), null);
  assert.equal(
    description(container).querySelector('[role="group"]'),
    null,
    "nothing takes the keyboard to open it",
  );
});

test("a description saved with mixed line endings, its words typed and taken out again, writes nothing", async () => {
  onGitHub = "## Summary\r\n\r\nExpires invitations after seven days.\n";
  const container = await drawTab();
  await clickWords(container, "Expires invitations after seven days.");
  const element = editorIn(container) ?? assert.fail("the editor opens");
  const editor = element.editor ?? assert.fail("the editor is running");

  typeAtEnd(element, " Mine.");
  act(() => {
    const end = editor.state.selection.from;
    editor.view.dispatch(editor.state.tr.delete(end - " Mine.".length, end));
  });
  await press(element, "Escape");

  assert.deepEqual(changes, []);
  assert.equal(editorIn(container), null);
});

test("leaving while an edit is on its way to GitHub writes it once, and holds no draft once GitHub took it", async () => {
  const container = await drawTab();
  await clickWords(container, "Expires invitations after seven days.");
  const editor = editorIn(container) ?? assert.fail("the editor opens");
  const { promise, resolve } = Promise.withResolvers<void>();
  changeHeld = promise;

  typeAtEnd(editor, " Accepted ones stay.");
  await press(editor, "Escape");
  act(() => root?.unmount());
  root = undefined;
  resolve();
  await settle();

  assert.equal(changes.length, 1, "the edit is written once");
  changeHeld = undefined;
  const again = await drawTab();
  assert.equal(editorIn(again), null, "no refused draft opens again");
  assert.match(description(again).textContent ?? "", /Accepted ones stay\./u);
});

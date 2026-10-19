import assert from "node:assert/strict";
import {
  CONVERSATION_ENTRY,
  type ConversationEntry,
  DIFF_SIDE,
  REVIEW_STATE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { ANCHOR_KIND, anchorIn } from "./pull-request-anchors.js";

/**
 * A link on GitHub to one of a pull request's own comments names the thread
 * or the entry its tab read, by the fragment GitHub writes; any other link
 * names nothing, and opens on GitHub. Synthetic people throughout.
 */

const PAGE = "https://github.com/acme/relay/pull/42";
const DANA = { login: "dana", bot: false };

const THREAD: ReviewThread = {
  id: "PRRT_kwDOone",
  path: "src/invite.ts",
  line: 13,
  startLine: null,
  originalLine: 13,
  originalStartLine: null,
  side: DIFF_SIDE.RIGHT,
  startSide: null,
  diffHunk: "",
  resolved: false,
  outdated: false,
  comments: [
    { by: DANA, html: null, body: "Why once?", at: 1, url: `${PAGE}#discussion_r101` },
    { by: DANA, html: null, body: "Never mind.", at: 2, url: `${PAGE}#discussion_r102` },
  ],
  more: 0,
};

const REVIEW: ConversationEntry = {
  kind: CONVERSATION_ENTRY.REVIEW,
  by: DANA,
  state: REVIEW_STATE.COMMENTED,
  html: null,
  body: "",
  at: 1,
  url: `${PAGE}#pullrequestreview-7`,
  threads: [THREAD],
};

const COMMENT: ConversationEntry = {
  kind: CONVERSATION_ENTRY.COMMENT,
  by: DANA,
  html: null,
  body: "Ship it.",
  at: 3,
  url: `${PAGE}#issuecomment-9`,
};

const CONVERSATION = [REVIEW, COMMENT];

test("a line comment's link, on the page or under its Files tab, names its thread, a reply's as its first comment's does", () => {
  for (const href of [
    `${PAGE}#discussion_r101`,
    `${PAGE}#discussion_r102`,
    `${PAGE}/files#r102`,
    "https://github.com/ACME/Relay/pull/42#discussion_r101",
  ]) {
    assert.deepEqual(
      anchorIn(href, PAGE, CONVERSATION),
      { kind: ANCHOR_KIND.THREAD, thread: THREAD },
      href,
    );
  }
});

test("a comment's and a review's links name their entries", () => {
  assert.deepEqual(anchorIn(`${PAGE}#issuecomment-9`, PAGE, CONVERSATION), {
    kind: ANCHOR_KIND.ENTRY,
    entry: COMMENT,
  });
  assert.deepEqual(anchorIn(`${PAGE}#pullrequestreview-7`, PAGE, CONVERSATION), {
    kind: ANCHOR_KIND.ENTRY,
    entry: REVIEW,
  });
});

test("a link to another pull request, to the page alone, or to a comment the read did not reach names nothing", () => {
  for (const href of [
    "https://github.com/acme/relay/pull/43#issuecomment-9",
    "https://github.com/acme/other/pull/42#issuecomment-9",
    PAGE,
    `${PAGE}#issuecomment-10`,
    `${PAGE}#discussion_r999`,
    `${PAGE}#diff-abc123`,
    `${PAGE}/commits#issuecomment-9x`,
    "https://example.com/acme/relay/pull/42#issuecomment-9",
    "not a link",
  ]) {
    assert.equal(anchorIn(href, PAGE, CONVERSATION), undefined, href);
  }
});

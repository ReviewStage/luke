import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { CONVERSATION_ENTRY_SPEAKER } from "./conversation-rows";
import {
  type ConversationSearchOutcome,
  ConversationSearchResults,
  conversationSearchGroups,
  searchConversation,
} from "./conversation-search";
import {
  CONVERSATION_MESSAGE_ATTRIBUTE,
  CONVERSATION_SEARCH_ROW,
  type ConversationSearchEntry,
  type ConversationSearchRow,
  ConversationTurns,
  conversationSearchEntries,
  type RowVoice,
} from "./conversation-turns";
import {
  FIXTURE_BRIEFING,
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  fixtureBriefingTurns,
  fixtureConversationTurns,
} from "./conversation-turns.fixtures";

const GROUPS = fixtureConversationTurns();

const ENTRIES = conversationSearchEntries(GROUPS);

/** How many times one fixed attribute or class the renderer stamps appears; a structural count, never a phrase. */
function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

function found(outcome: ConversationSearchOutcome | undefined): ConversationSearchOutcome {
  assert.ok(outcome, "the query is a search");
  return outcome;
}

function turns(search?: { tokens: readonly string[]; landed: string | undefined }): string {
  return renderToStaticMarkup(
    createElement(ConversationTurns, {
      groups: GROUPS,
      roster: FIXTURE_ROSTER,
      now: FIXTURE_NOW,
      ...(search ? { search } : undefined),
    }),
  );
}

test("the corpus is the words the thread draws as bubbles, drawn as their rows draw them, in the thread's order", () => {
  const ask = ENTRIES.find((entry) => entry.words === "Is the fixture session still waiting?");
  assert.ok(ask);
  assert.equal(ask.voice.label, "You");
  assert.equal(ask.row, CONVERSATION_SEARCH_ROW.BUBBLE);
  // The developer's ask copies and is never rated, as in the thread.
  assert.equal(ask.copy, true);
  assert.equal(ask.rated, undefined);
  const reply = ENTRIES.find((entry) => entry.words === "It is holding on a permission prompt.");
  assert.ok(reply);
  assert.equal(reply.voice.label, "Luke");
  assert.equal(reply.row, CONVERSATION_SEARCH_ROW.BUBBLE);
  // Luke's reply copies and carries the thread's rating of it, drafted against the ask it answered.
  assert.equal(reply.copy, true);
  assert.equal(reply.rated?.view.message.id, reply.messageId);
  assert.equal(reply.rated?.words, reply.words);
  assert.equal(reply.rated?.ask, ask.words);
  // An observed session's briefing folds as the brain's proposal, not words
  // said, so it is not searched; words on his own judgment are named for
  // the face they stand under.
  assert.equal(
    ENTRIES.find((entry) =>
      entry.words.includes("The fixture session is waiting on a permission prompt."),
    ),
    undefined,
  );
  const own = ENTRIES.find(
    (entry) =>
      entry.words === "The meeting ended, so I answered the fixture session's question myself.",
  );
  assert.ok(own);
  assert.equal(own.voice.label, "Luke, on his own judgment");
  assert.equal(own.row, CONVERSATION_SEARCH_ROW.OWN);
  // Words on his own judgment carry no copy, and a rating with no ask, as in the thread.
  assert.equal(own.copy, false);
  assert.equal(own.rated?.view.message.id, own.messageId);
  assert.equal(own.rated?.ask, undefined);
  // His thinking folds away and is not words said, so it is not searched.
  assert.ok(ENTRIES.every((entry) => !entry.words.includes("read its tail before answering")));
  // The order is the thread's own, and no row is entered twice.
  const instants = ENTRIES.map((entry) => entry.at);
  assert.deepEqual(
    instants,
    [...instants].sort((first, second) => first - second),
  );
  assert.equal(new Set(ENTRIES.map((entry) => entry.key)).size, ENTRIES.length);
});

test("a message that briefs and writes the same words is two results, drawn as the thread's two rows, never one bubble of both", () => {
  const groups = fixtureBriefingTurns();
  const entries = conversationSearchEntries(groups);
  assert.equal(entries.length, 2);
  const [bubble, own] = entries;
  assert.ok(bubble && own);
  // The briefing is Luke's bubble, copying as his bubbles do; the note is his
  // words under his own face, copying nothing; each carries its words once.
  assert.equal(bubble.row, CONVERSATION_SEARCH_ROW.BUBBLE);
  assert.equal(bubble.voice.label, "Luke");
  assert.equal(bubble.words, FIXTURE_BRIEFING);
  assert.equal(bubble.copy, true);
  assert.equal(own.row, CONVERSATION_SEARCH_ROW.OWN);
  assert.equal(own.voice.label, "Luke, on his own judgment");
  assert.equal(own.words, FIXTURE_BRIEFING);
  assert.equal(own.copy, false);
  // Both anchor the one message a landing seeks, under keys of their own; the
  // rating stands on the message's last words, as the thread puts it.
  assert.equal(bubble.messageId, own.messageId);
  assert.notEqual(bubble.key, own.key);
  assert.equal(bubble.rated, undefined);
  assert.equal(own.rated?.view.message.id, own.messageId);
  assert.equal(own.rated?.words, FIXTURE_BRIEFING);
  // The thread draws the same two rows in the same order.
  const thread = renderToStaticMarkup(
    createElement(ConversationTurns, { groups, roster: FIXTURE_ROSTER, now: FIXTURE_NOW }),
  );
  const drawnBubble = thread.indexOf('class="conversation-bubble"');
  const drawnOwn = thread.indexOf('class="conversation-action-body"');
  assert.ok(drawnBubble >= 0 && drawnOwn > drawnBubble);
  assert.equal(count(thread, 'class="conversation-more-button"'), 1);
  // A query the words answer finds both rows, and the results draw each once,
  // with the words in it once.
  const search = found(searchConversation(entries, "reviews"));
  assert.equal(search.matched, 2);
  const results = renderToStaticMarkup(
    createElement(ConversationSearchResults, { search, now: FIXTURE_NOW, onOpen: () => undefined }),
  );
  assert.equal(count(results, 'class="conversation-entry"'), 2);
  assert.equal(count(results, 'class="conversation-bubble"'), 1);
  assert.equal(count(results, 'class="conversation-action-body"'), 1);
  assert.equal(count(results, "The transcript search PR has every check green."), 2);
  assert.equal(count(results, 'class="conversation-more-button"'), 1);
});

test("every entry names a message whose rows wear the anchor a landing seeks, and every anchored message is an entry", () => {
  const markup = turns();
  const anchored = new Set(
    [...markup.matchAll(new RegExp(`${CONVERSATION_MESSAGE_ATTRIBUTE}="([^"]+)"`, "g"))].map(
      (match) => match[1],
    ),
  );
  assert.ok(anchored.size > 0);
  assert.deepEqual(new Set(ENTRIES.map((entry) => entry.messageId)), anchored);
});

test("every word of the query must land in one message's words, case-blind; a blank query is no search", () => {
  assert.equal(searchConversation(ENTRIES, ""), undefined);
  assert.equal(searchConversation(ENTRIES, "   "), undefined);
  const both = found(searchConversation(ENTRIES, "FIXTURE session"));
  assert.deepEqual(both.tokens, ["fixture", "session"]);
  assert.ok(both.matched >= 2);
  assert.equal(both.hits.length, both.matched);
  assert.equal(both.searched, ENTRIES.length);
  assert.ok(both.hits.every((hit) => /fixture/i.test(hit.words) && /session/i.test(hit.words)));
  // Words narrow: the two-word query keeps no more than either word alone.
  assert.ok(both.matched <= found(searchConversation(ENTRIES, "session")).matched);
  const none = found(searchConversation(ENTRIES, "zeta"));
  assert.equal(none.matched, 0);
  assert.deepEqual(none.hits, []);
  assert.equal(none.searched, ENTRIES.length);
});

test("the matches stand under the thread's dates: an hour's silence opens a group, groups newest first, the thread's order within", () => {
  const HOUR = 60 * 60_000;
  const row: ConversationSearchRow = CONVERSATION_SEARCH_ROW.BUBBLE;
  const voice: RowVoice = { speaker: CONVERSATION_ENTRY_SPEAKER.YOU, label: "You" };
  const at = (offset: number): ConversationSearchEntry => ({
    key: `m${offset}`,
    messageId: `m${offset}`,
    row,
    voice,
    at: offset,
    words: "words",
    copy: true,
    rated: undefined,
  });
  const hits = [at(0), at(30 * 60_000), at(2 * HOUR), at(2 * HOUR + 10 * 60_000), at(4 * HOUR)];
  const groups = conversationSearchGroups(hits);
  assert.deepEqual(
    groups.map((group) => group.map((entry) => entry.at)),
    [[4 * HOUR], [2 * HOUR, 2 * HOUR + 10 * 60_000], [0, 30 * 60_000]],
  );
  // Exactly an hour is a silence; a moment under it is not.
  assert.equal(conversationSearchGroups([at(0), at(HOUR)]).length, 2);
  assert.equal(conversationSearchGroups([at(0), at(HOUR - 1)]).length, 1);
  assert.deepEqual(conversationSearchGroups([]), []);
  // What the search answers carries the same groups.
  const search = found(searchConversation(ENTRIES, "session"));
  assert.deepEqual(search.groups.flat().length, search.matched);
  assert.deepEqual(conversationSearchGroups(search.hits), search.groups);
});

test("results are the thread's own rows under its own dates, each with one press over it and the match marked, and the row's own copy and rating", () => {
  const search = found(searchConversation(ENTRIES, "session"));
  const markup = renderToStaticMarkup(
    createElement(ConversationSearchResults, { search, now: FIXTURE_NOW, onOpen: () => undefined }),
  );
  assert.equal(count(markup, 'class="conversation-entry"'), search.matched);
  assert.equal(count(markup, 'class="conversation-words-press"'), search.matched);
  assert.equal(count(markup, 'class="conversation-break"'), search.groups.length);
  assert.ok(markup.includes('<mark class="row-match">session</mark>'));
  // The copy and the ellipsis stand exactly where the thread's rows have them.
  const copying = search.hits.filter((hit) => hit.copy).length;
  const rated = search.hits.filter((hit) => hit.rated !== undefined).length;
  assert.ok(copying > 0 && rated > 0);
  assert.equal(count(markup, 'class="conversation-copy"'), copying);
  assert.equal(count(markup, 'class="conversation-more-button"'), rated);
  // The press stands first under the words' own ground — the bubble, or the own-judgment body — and nowhere else.
  const pressed =
    count(
      markup,
      '<span class="conversation-bubble"><button type="button" class="conversation-words-press"',
    ) +
    count(
      markup,
      '<span class="conversation-action-body"><button type="button" class="conversation-words-press"',
    );
  assert.equal(pressed, search.matched);
  // No result wears the anchor the landing seeks: standing in the thread's
  // place at the moment of the press, it must not be what the seek finds.
  assert.equal(count(markup, CONVERSATION_MESSAGE_ATTRIBUTE), 0);
  // The rows stand in the groups' order, each under its own stamp.
  const stamped = [...markup.matchAll(/class="conversation-time" dateTime="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    stamped,
    search.groups.flatMap((group) => group.map((entry) => new Date(entry.at).toISOString())),
  );
  // The fixtures were all said today, in the dates' own words, once per group.
  assert.equal(count(markup, "<strong>Today</strong>"), search.groups.length);
  const empty = renderToStaticMarkup(
    createElement(ConversationSearchResults, {
      search: found(searchConversation(ENTRIES, "zeta")),
      now: FIXTURE_NOW,
      onOpen: () => undefined,
    }),
  );
  assert.ok(empty.includes("No messages match"));
  assert.equal(count(empty, 'class="conversation-entry"'), 0);
});

test("a standing search marks its words in the bubbles, and only the landed message's rows say so", () => {
  const search = found(searchConversation(ENTRIES, "session"));
  const [first] = search.hits;
  assert.ok(first);
  const marked = turns({ tokens: search.tokens, landed: first.messageId });
  assert.ok(count(marked, '<mark class="row-match">') >= search.matched);
  assert.ok(count(marked, 'data-search-landed="true"') >= 1);
  // The landing is worn by the rows of the message the result named, and by no other.
  const landedAnchors = [
    ...marked.matchAll(
      new RegExp(`${CONVERSATION_MESSAGE_ATTRIBUTE}="([^"]+)" data-search-landed="true"`, "g"),
    ),
  ].map((match) => match[1]);
  assert.ok(landedAnchors.length >= 1);
  assert.ok(landedAnchors.every((id) => id === first.messageId));
  // Marks are the search's alone: a search with no landing marks and lands nothing more.
  const unlanded = turns({ tokens: search.tokens, landed: undefined });
  assert.equal(count(unlanded, "data-search-landed"), 0);
  assert.equal(count(unlanded, "<mark"), count(marked, "<mark"));
  const plain = turns();
  assert.equal(count(plain, "<mark"), 0);
  assert.equal(count(plain, "data-search-landed"), 0);
});

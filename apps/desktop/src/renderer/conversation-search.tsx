import { CloseIcon, SearchIcon } from "@sidecar/panel";
import { Fragment, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import { ConversationTimeBreak } from "./conversation-rows";
import { opensConversationTimeBreak } from "./conversation-time-break";
import {
  CONVERSATION_MESSAGE_ATTRIBUTE,
  type ConversationSearchEntry,
  ConversationSearchHitRow,
} from "./conversation-turns";
import { drawnVisibly, focusSeek } from "./focus-seek";
import { matchesTokens, searchTokens } from "./session-model";

/**
 * Searching the Conversation thread, and a transcript the tab turns to.
 *
 * The thread grows past what anyone scrolls back through, so the tab bar
 * carries the same magnifier the other two tabs do, opening the same pill at
 * the head of the thread. An agent's transcript page is drawn through the
 * same turn renderer, so it searches through the same pieces: the same pill
 * under its header, the same results in the transcript's place, the same
 * landing, worded for a transcript. The corpus is the words the thread draws as
 * bubbles — the developer's asks, Luke's replies and briefings, his words on
 * his own judgment, and what his voice read aloud — one entry per row of
 * words, so a message that briefs in a bubble and writes the same under his
 * face is two results as it is two rows, composed by the turn renderer from
 * the very branches that draw them
 * (`conversationSearchEntries` in `conversation-turns.tsx`), so a search can
 * neither find words the thread does not show nor miss words it does. What
 * the thread folds away (his thinking, an observed chat's lines) and what it
 * draws as a row rather than words (a tool call) is not searched.
 *
 * Results are the matching messages drawn as the thread draws them — the
 * same bubbles on the same sides, the query's words marked — under the
 * thread's own dates: a run of matches with no hour's silence between them
 * is one group, dated once at its head, oldest to newest as the thread
 * reads; and the groups stand newest first, since what was said last is what
 * a search most often looks for. Pressing a row is the search answered the
 * way a browser's find answers it — the thread comes back with every match
 * marked in its bubble, and the message the row named is scrolled to the
 * middle of the view with its marks lit brighter than the rest. The query
 * stays in the field; a caret placed back in it brings the results back. The
 * search is read-only over words the record already holds: nothing is
 * written, and no model runs.
 */

/**
 * What a search reads: the Conversation thread, or the one transcript the
 * tab's third page draws. The field and its magnifier are worded by it, so a
 * reader on a transcript is never told they are searching the Conversation.
 */
export const CONVERSATION_SEARCH_SUBJECT = {
  CONVERSATION: "conversation",
  TRANSCRIPT: "transcript",
} as const;

export type ConversationSearchSubject =
  (typeof CONVERSATION_SEARCH_SUBJECT)[keyof typeof CONVERSATION_SEARCH_SUBJECT];

/** What the field and its magnifier are for, in the words the pages themselves use. */
function searchLabel(subject: ConversationSearchSubject): string {
  return `Search ${subject}`;
}

/**
 * How the search field is found from outside the component, the way the
 * other two are: the magnifier and Command-F are answered at the app level,
 * and the field they land in is here.
 */
export const CONVERSATION_SEARCH_INPUT_ID = "conversation-search-input";

/** One run of matches with no hour's silence between them, oldest to newest as the thread reads. */
export type ConversationSearchGroup = readonly ConversationSearchEntry[];

/** What became of the query, reported so no narrowing is ever silent. */
export interface ConversationSearchOutcome {
  /** The query's words, lowercased — what each message was actually read against, and what the bubbles mark. */
  readonly tokens: readonly string[];
  /** The rows the query kept, in the thread's own order. */
  readonly hits: readonly ConversationSearchEntry[];
  /** The same rows under the thread's dates, newest group first; the first of the first is what Enter lands on. */
  readonly groups: readonly ConversationSearchGroup[];
  /** How many rows the query kept. */
  readonly matched: number;
  /** How many rows the query was read against: every one with words. */
  readonly searched: number;
}

/**
 * The matches under the thread's own dates: a match an hour or more after
 * the one before it opens a new group, on the thread's own rule for setting
 * a date over a line, and each group keeps the thread's order within it. The
 * groups come back newest first.
 */
export function conversationSearchGroups(
  hits: readonly ConversationSearchEntry[],
): readonly ConversationSearchGroup[] {
  const groups: ConversationSearchEntry[][] = [];
  let previousAt: number | undefined;
  for (const hit of hits) {
    const standing = groups.at(-1);
    if (standing === undefined || opensConversationTimeBreak(previousAt, hit.at))
      groups.push([hit]);
    else standing.push(hit);
    previousAt = hit.at;
  }
  return groups.reverse();
}

/**
 * The query read over the thread: every word must land somewhere in a
 * message's words, on the same reading the session list and the settings
 * give a query, so the three searches cannot disagree about what a word is
 * or what finding one means. A blank query is no search at all.
 */
export function searchConversation(
  entries: readonly ConversationSearchEntry[],
  query: string,
): ConversationSearchOutcome | undefined {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return undefined;
  const hits = entries.filter((entry) => matchesTokens([entry.words], tokens));
  return {
    tokens,
    hits,
    groups: conversationSearchGroups(hits),
    matched: hits.length,
    searched: entries.length,
  };
}

/**
 * What brackets the landing's scroll, for a caller that must tell it from
 * the reader's own: `before` runs ahead of the scroll, and `after` one frame
 * later, since the scroll event a scroll raises is dispatched in the next
 * rendering step ahead of that step's animation frames — by which point the
 * landing has said all it will, whether or not it moved anything.
 */
export interface LandingBracket {
  readonly before: () => void;
  readonly after: () => void;
}

/**
 * Takes the thread to the message a pressed result named, waiting out the
 * swap from the results back to the thread — the same frame-by-frame seek the
 * settings search's landing needs, because the rows are not drawn until React
 * has answered. The message's first row is found by the anchor it wears and
 * brought to the middle of the view, the way a browser's find brings a match;
 * only the thread scrolls, since the root clips rather than scrolls. A message
 * the thread is no longer drawing is given up on quietly.
 */
export function landOnConversationMessage(messageId: string, bracket?: LandingBracket): () => void {
  return focusSeek({
    find: () =>
      document.querySelector<HTMLElement>(`[${CONVERSATION_MESSAGE_ATTRIBUTE}="${messageId}"]`),
    ready: drawnVisibly,
    act: (element) => {
      bracket?.before();
      element.scrollIntoView({ block: "center", inline: "nearest" });
      if (bracket) requestAnimationFrame(bracket.after);
    },
  });
}

/**
 * The button that opens the search field, beside the tab bar in the spot the
 * other two tabs' magnifiers take: each tab's search is opened from the same
 * place. It stays lit while the field is open, so the control and its effect
 * cannot be read apart.
 */
export function ConversationSearchButton({
  open,
  subject = CONVERSATION_SEARCH_SUBJECT.CONVERSATION,
  onToggle,
}: {
  open: boolean;
  /** What the field it opens reads, which words the button. */
  subject?: ConversationSearchSubject;
  onToggle: () => void;
}): React.JSX.Element {
  const label = searchLabel(subject);
  return (
    <button
      type="button"
      className="search-button"
      data-active={String(open)}
      aria-expanded={open}
      aria-label={label}
      aria-keyshortcuts="Meta+F"
      title={`${label} (⌘F)`}
      onClick={onToggle}
    >
      <SearchIcon />
    </button>
  );
}

/**
 * The search field: the sessions list's own pill, worn by class rather than
 * copied, at the head of the thread. The count is the pill's honesty about
 * how far the query narrowed the messages with words in them.
 *
 * Escape unwinds one layer at a time, the way it does everywhere else in the
 * panel: a held query is cleared first, and only an empty field closes the
 * search — both stopped here, so neither press falls through and closes the
 * panel behind the field. Enter lands on the first result, the way a find
 * field's Enter goes to the first match, and leaves the field as a pressed
 * row would, so the caret placed back in it is what brings the results back.
 */
export function ConversationSearch({
  query,
  search,
  subject = CONVERSATION_SEARCH_SUBJECT.CONVERSATION,
  onQueryChange,
  onEnter,
  onClose,
  onEngagedChange,
}: {
  query: string;
  search?: ConversationSearchOutcome | undefined;
  /** What the field reads, which words its label and placeholder. */
  subject?: ConversationSearchSubject;
  onQueryChange: (query: string) => void;
  /** Enter over a standing search: the first result pressed by the keyboard. */
  onEnter: () => void;
  /** The field's own way out — Escape on an empty query — which also clears. */
  onClose: () => void;
  /**
   * Reports someone being part-way through a search, which holds the panel
   * open against the pointer wandering off — the same hold a half-typed ask
   * has, for the same reason: the caret is the signal that hands are here.
   */
  onEngagedChange: (engaged: boolean) => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const field = useRef<HTMLInputElement | null>(null);
  const label = searchLabel(subject);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only by design — the keyboard already lands in the field by tabbing, and the click handler only places the caret.
    <search
      className="session-search conversation-search"
      // The whole pill is the field: a press on its padding or its count is
      // someone reaching for the caret, so the caret is what they get.
      onClick={() => field.current?.focus()}
    >
      <SearchIcon />
      <input
        ref={field}
        id={CONVERSATION_SEARCH_INPUT_ID}
        className="session-search-input"
        aria-label={label}
        placeholder={`${label}…`}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={() => {
          // The panel can be showing without its window being key, and a
          // field that cannot be typed into is worse than no field.
          tell(ACT_KIND.WINDOW_FOCUS_PANEL);
          onEngagedChange(true);
        }}
        onBlur={() => onEngagedChange(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            if (search === undefined || search.matched === 0) return;
            event.preventDefault();
            onEnter();
            event.currentTarget.blur();
            return;
          }
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (query.length > 0) onQueryChange("");
          else onClose();
        }}
      />
      {search ? (
        <span className="session-search-count" aria-live="polite">
          {search.matched === 0 ? "No matches" : `${search.matched} of ${search.searched}`}
        </span>
      ) : null}
      {search ? (
        <button
          type="button"
          className="session-search-clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={(event) => {
            // The pill's own click would re-place the caret after this — let
            // it: a cleared field with the caret in it is ready for the next
            // question, which is what pressing clear asks for.
            event.stopPropagation();
            onQueryChange("");
            field.current?.focus();
          }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </search>
  );
}

/**
 * What a query left: the matching messages drawn as the thread draws them,
 * copy and rating included, under the thread's own dates — one date over
 * each run of matches with no hour's silence inside it, the newest run first
 * and the thread's order within — on the thread's own scroller and pull, so
 * the stamps sit in the same column they do in the thread. Pressing a row
 * takes the thread to that message. An emptied search says so rather than
 * going blank.
 */
export function ConversationSearchResults({
  search,
  now,
  onOpen,
  onOfferRatingFeedback,
}: {
  search: ConversationSearchOutcome;
  /** The instant the dates are read against, on the thread's own terms. */
  now: number;
  /** A pressed row, which lands the thread on the message. */
  onOpen: (entry: ConversationSearchEntry) => void;
  /** Opens the feedback composer on the draft a thumbs down offers, as the thread's rows do; absent where none can be offered. */
  onOfferRatingFeedback?: (draft: string) => void;
}): React.JSX.Element {
  if (search.matched === 0) {
    return (
      <div className="empty-state">
        <strong>No messages match</strong>
      </div>
    );
  }
  return (
    <div className="conversation-thread">
      <div className="conversation-scroll conversation-search-scroll">
        <div className="conversation-pull">
          <ol className="conversation-list conversation-search-results">
            {search.groups.map((group) => {
              const [first] = group;
              if (first === undefined) return null;
              return (
                <Fragment key={first.key}>
                  <ConversationTimeBreak recordedAt={first.at} now={now} />
                  {group.map((entry) => (
                    <ConversationSearchHitRow
                      key={entry.key}
                      entry={entry}
                      tokens={search.tokens}
                      onOpen={onOpen}
                      {...(onOfferRatingFeedback ? { onOfferRatingFeedback } : undefined)}
                    />
                  ))}
                </Fragment>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

import {
  ChevronIcon,
  CloseIcon,
  DownloadIcon,
  MegaphoneIcon,
  PowerIcon,
  SearchIcon,
  UserIcon,
} from "@sidecar/panel";
import {
  APP_SETTING_SCHEMA,
  type SettingsRowsInput,
  settingFieldForGuideId,
  settingGuideEntries,
  settingIdVisible,
} from "@sidecar/settings";
import { Fragment, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { tell } from "./act";
import { drawnVisibly, focusSeek } from "./focus-seek";
import { ERRAND_TARGET_ATTRIBUTE } from "./luke-errand";
import { matchesTokens, searchTokens } from "./session-model";
import { Highlighted } from "./session-search";
import { type ConnectionVisibility, offeredConnections } from "./settings/connection-schema";
import {
  defaultProjectRowId,
  SETTINGS_SEARCH_ANCHOR_ATTRIBUTE,
  SETTINGS_SEARCH_ROW,
} from "./settings-anchors";
import {
  SETTINGS_SUBVIEW_LIST,
  SETTINGS_VIEW,
  type SettingsSubview,
  type SettingsView,
} from "./settings-views";

/**
 * Searching the Settings tab.
 *
 * The pages hold more rows than anyone remembers the address of, so the tab
 * bar carries a magnifier that opens a search field pinned at the head of
 * whichever settings page is showing — the search reads across every page
 * wherever it is opened from. The corpus is everything the pages currently
 * offer: the stored
 * settings come from the same guide entries the voice conversation is handed
 * — one description of each setting, so the search and Luke's own account of
 * himself cannot drift apart — and each says for itself whether its row is
 * drawn, so nothing here restates a condition a page branches on. The rows
 * that are not settings (a permission, a key, a shortcut, the ways out) are
 * declared here, gated by the same conditions that draw them. A row the pages
 * are not drawing right now is not offered, because a result that leads to a
 * page without its row is a promise the page cannot keep.
 *
 * Results read the way macOS System Settings reads them: grouped under the
 * page that holds them, the page's own row leading with its glyph, the rows
 * nested beneath it. Pressing the page opens it; pressing a row opens its
 * page and takes the view to the row itself, by the anchor the row wears.
 * The search is read-only over names and descriptions the build already
 * fixed — a query narrows what is offered and never widens what can be done.
 */

/** What the field is for, in the words the pages themselves use. */
const SEARCH_PLACEHOLDER = "Search settings…";

/**
 * How the search field is found from outside the component, the way the
 * session list's is: the magnifier is answered at the app level, where the
 * page it may have to turn lives, and the field it lands in is here.
 */
export const SETTINGS_SEARCH_INPUT_ID = "settings-search-input";

/** One row a query can find, and where pressing it leads. */
export interface SettingsSearchEntry {
  /**
   * The row's own id: a setting's schema id, a provider's, or a member of
   * `SETTINGS_SEARCH_ROW`. It is what the landing seeks — as the anchor the
   * row wears, or the errand mark its control already carries.
   */
  id: string;
  /** The row's own name, which is what the result draws. */
  label: string;
  /** The page the row is drawn on, which is where the result leads. */
  page: SettingsView;
  /** The small mark the row itself wears, for a result to wear too. */
  icon?: React.ReactNode;
  /** Every line the query is read against: the label, and words about it. */
  haystack: readonly string[];
}

/**
 * What the pages must answer before the corpus can say what they hold: the one
 * record the rows themselves are drawn from. The settings' own half is the
 * schema's — each entry says whether its row is drawn right now, judged from
 * this same record — so nothing here restates a condition a page branches on.
 */
export type SettingsSearchInput = SettingsRowsInput;

/**
 * The page named the way a group's head says it. `SETTINGS_PAGE_LABEL` words
 * the guide's by-hand paths mid-sentence; a head stands alone, so the front
 * page takes its name capitalized — though its rows are drawn headless, at
 * the top of the results, because a search made from the front page needs no
 * row saying where the front page is.
 */
const RESULT_PAGE_WORD = {
  [SETTINGS_VIEW.ROOT]: "Front page",
  [SETTINGS_VIEW.VOICE]: "Voice",
  [SETTINGS_VIEW.APPEARANCE]: "Appearance",
  [SETTINGS_VIEW.SHORTCUTS]: "Keyboard shortcuts",
  [SETTINGS_VIEW.CONNECTIONS]: "Connections",
} satisfies Record<SettingsView, string>;

/** The pages in the order the front page offers them, which orders results. */
const PAGE_ORDER: readonly SettingsView[] = [SETTINGS_VIEW.ROOT, ...SETTINGS_SUBVIEW_LIST];

/** The words every shortcut row can be found by, beside its own name. */
const SHORTCUT_WORDS = "keyboard shortcut hotkey key chord record remove delete none";

/**
 * The rows that are neither stored settings nor connections, each gated by the
 * condition that draws it. Declared as one table so a row added to a page has
 * one place to become findable — the same rule the guide states for its facts.
 * Every connection is `CONNECTION_SCHEMA`'s to declare, so nothing here
 * restates one.
 */
function fixedEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const entries: (SettingsSearchEntry | undefined)[] = [
    {
      id: SETTINGS_SEARCH_ROW.UPDATES,
      label: "Updates",
      page: SETTINGS_VIEW.ROOT,
      icon: <DownloadIcon />,
      haystack: ["Updates", "version release download check for updates"],
    },
    {
      id: SETTINGS_SEARCH_ROW.CHANGELOG,
      label: "Changelog",
      page: SETTINGS_VIEW.ROOT,
      icon: <DownloadIcon />,
      haystack: ["Changelog", "release notes version history what's new what changed"],
    },
    {
      id: SETTINGS_SEARCH_ROW.FEEDBACK,
      label: "Feedback",
      page: SETTINGS_VIEW.ROOT,
      icon: <MegaphoneIcon />,
      haystack: ["Feedback", "send feedback submit a prompt bug idea founders"],
    },
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.SIGN_OUT,
          label: "Sign out",
          page: SETTINGS_VIEW.ROOT,
          icon: <UserIcon />,
          haystack: ["Sign out", "account sign out log out"],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.DELETE_ACCOUNT,
          label: "Delete account",
          page: SETTINGS_VIEW.ROOT,
          icon: <UserIcon />,
          haystack: ["Delete account", "account erase remove"],
        }
      : undefined,
    {
      id: SETTINGS_SEARCH_ROW.QUIT,
      label: "Quit Luke",
      page: SETTINGS_VIEW.ROOT,
      icon: <PowerIcon />,
      haystack: ["Quit Luke", "quit exit close the app"],
    },
    // The Voice page's permission row, drawn once there is a voice to reach.
    input.settings.voiceAvailable
      ? {
          id: SETTINGS_SEARCH_ROW.MICROPHONE,
          label: "Microphone",
          page: SETTINGS_VIEW.VOICE,
          haystack: ["Microphone", "permission access allow privacy system settings"],
        }
      : undefined,
    // The three keys, which are rows but not stored settings: what each is
    // set to lives with the registrar, and the rows are always drawn.
    {
      id: SETTINGS_SEARCH_ROW.TALK_KEY,
      label: "Talk to Luke",
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: ["Talk to Luke", SHORTCUT_WORDS, "talk speak hold microphone push to talk"],
    },
    {
      id: SETTINGS_SEARCH_ROW.ASK_KEY,
      label: "Ask Luke",
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: ["Ask Luke", SHORTCUT_WORDS, "ask type composer summon"],
    },
    {
      id: SETTINGS_SEARCH_ROW.STOP_KEY,
      label: "Stop Luke",
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: ["Stop Luke", SHORTCUT_WORDS, "stop interrupt quiet cut off a reply"],
    },
    // One entry per provider drawing a Default project row, named for its
    // provider so the results can be told apart, each landing on its own row.
    ...input.workspaceProviders.flatMap((provider): SettingsSearchEntry[] => {
      const id = defaultProjectRowId(provider.id);
      if (!id || !provider.offersProjects) return [];
      return [
        {
          id,
          label: `${provider.name} default project`,
          page: SETTINGS_VIEW.CONNECTIONS,
          haystack: [`${provider.name} default project`, "workspace creation ask each time"],
        },
      ];
    }),
  ];
  return entries.filter((entry): entry is SettingsSearchEntry => entry !== undefined);
}

/**
 * Every connection the pages are offering right now, read from the one table
 * that declares them: its id is the anchor its row already wears, its name is
 * the name the row draws, and its own `offered` is the condition that draws it
 * — so a connection can neither be found where it is not drawn nor go missing
 * from the search when it is.
 */
function connectionEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const visibility: ConnectionVisibility = {
    settings: input.settings,
    accountDrawn: input.accountDrawn,
    supersetInstalled: input.superset.installed,
    workspaceProjects: input.workspaceProviders
      .filter((provider) => provider.offersProjects)
      .map((provider) => ({ id: provider.id, name: provider.name })),
  };
  return offeredConnections(visibility).map((spec) => ({
    id: spec.id,
    label: spec.name(visibility),
    page: spec.page,
    ...(spec.mark ? { icon: spec.mark } : undefined),
    haystack: [spec.name(visibility), ...spec.haystack],
  }));
}

/**
 * Everything a query can find right now, ordered by page the way the front
 * page orders them — the stored settings first within a page, then the rows
 * that are not settings. Each entry carries the page's own name in its
 * haystack, so a page's name finds everything the page holds.
 */
export function settingsSearchEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const guided = settingGuideEntries(input.settings).flatMap((setting): SettingsSearchEntry[] => {
    const field = settingFieldForGuideId(setting.id);
    if (!field) return [];
    if (!settingIdVisible(setting.id, input)) return [];
    return [
      {
        id: setting.id,
        label: setting.label,
        page: APP_SETTING_SCHEMA[field].page,
        haystack: [setting.label, setting.description],
      },
    ];
  });
  const fixed = [...connectionEntries(input), ...fixedEntries(input)];
  return PAGE_ORDER.flatMap((page) => [
    ...guided.filter((entry) => entry.page === page),
    ...fixed.filter((entry) => entry.page === page),
  ]).map((entry) => ({
    ...entry,
    haystack: [...entry.haystack, RESULT_PAGE_WORD[entry.page]],
  }));
}

/** One page's matches: the page that heads the group, and the rows under it. */
export interface SettingsSearchGroup {
  page: SettingsView;
  items: readonly SettingsSearchEntry[];
}

/** What became of the query, reported so no narrowing is ever silent. */
export interface SettingsSearchOutcome {
  /** The query's words, lowercased — what each entry was actually read against. */
  tokens: readonly string[];
  /** The kept rows grouped under their pages, in the front page's own order. */
  groups: readonly SettingsSearchGroup[];
  /** How many rows the query kept, across every group. */
  matched: number;
  /** How many rows the query was read against: everything offered. */
  searched: number;
}

/**
 * The query read over the corpus: every word must land somewhere in an
 * entry's haystack, on the same reading the session list gives a query, so
 * the two searches cannot disagree about what a word is. A blank query is no
 * search at all. The kept rows come back grouped by page, because that is
 * how the results are drawn.
 */
export function searchSettings(
  entries: readonly SettingsSearchEntry[],
  query: string,
): SettingsSearchOutcome | undefined {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return undefined;
  const kept = entries.filter((entry) => matchesTokens(entry.haystack, tokens));
  const groups = PAGE_ORDER.flatMap((page): SettingsSearchGroup[] => {
    const items = kept.filter((entry) => entry.page === page);
    return items.length > 0 ? [{ page, items }] : [];
  });
  return { tokens, groups, matched: kept.length, searched: entries.length };
}

/** Whether the landing can hold the keyboard, or only be scrolled into view. */
const FOCUSABLE = "button, select, input, textarea, [tabindex]";

/**
 * Takes the view to the row a pressed result named, waiting out the page swap
 * the press asked for — the same frame-by-frame seek the session search field
 * needs, because the row is not drawn until React has answered. The row is
 * found by the anchor it wears, or by the errand mark its control already
 * carries, and is scrolled to the top of the view — the scroller's own scroll
 * padding keeps it clear of a pinned header — with a control also taking the
 * keyboard, without a second scroll of its own. It lands after the page's own
 * header focus on purpose: the result named a row, so the row is where the
 * view belongs. A row the page is not drawing is given up on quietly.
 */
export function landOnSettingsRow(id: string): () => void {
  return focusSeek({
    find: () =>
      document.querySelector<HTMLElement>(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${id}"]`) ??
      document.querySelector<HTMLElement>(`[${ERRAND_TARGET_ATTRIBUTE}="${id}"]`),
    ready: drawnVisibly,
    act: (element) => {
      element.scrollIntoView({ block: "start" });
      if (element.matches(FOCUSABLE)) element.focus({ preventScroll: true });
    },
  });
}

/**
 * The button that opens the search field, beside the tab bar the way the
 * session list's is beside the options button: the same magnifier, answering
 * for the other tab. It stays lit while the field is open, so the control
 * and its effect cannot be read apart.
 */
export function SettingsSearchButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="search-button"
      data-active={String(open)}
      aria-expanded={open}
      aria-label="Search settings"
      aria-keyshortcuts="Meta+F"
      title="Search settings (⌘F)"
      onClick={onToggle}
    >
      <SearchIcon />
    </button>
  );
}

/**
 * The search field: the sessions list's own pill, worn by class rather than
 * copied, pinned at the head of whichever page it was opened over so a
 * scrolled page keeps the field in hand — the same standing the session
 * list's pill has above its scroller. The count is the pill's honesty about
 * how far the query narrowed what the pages offer.
 *
 * Escape unwinds one layer at a time, the way it does everywhere else in the
 * panel: a held query is cleared first, and only an empty field closes the
 * search — both stopped here, so neither press falls through and closes the
 * panel behind the field.
 */
export function SettingsSearch({
  query,
  search,
  onQueryChange,
  onClose,
  onEngagedChange,
}: {
  query: string;
  search?: SettingsSearchOutcome | undefined;
  onQueryChange: (query: string) => void;
  /** The field's own way out — Escape on an empty query — which also clears. */
  onClose: () => void;
  /**
   * Reports someone being part-way through a search, which holds the panel
   * open against the pointer wandering off — the same hold a half-typed ask
   * has, for the same reason: the caret is the signal that hands are here.
   */
  onEngagedChange: (engaged: boolean) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  return (
    <div className="settings-search-stand">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only by design — the keyboard already lands in the field by tabbing, and the click handler only places the caret. */}
      <search
        className="session-search settings-search"
        // The whole pill is the field: a press on its padding or its count is
        // someone reaching for the caret, so the caret is what they get.
        onClick={() => field.current?.focus()}
      >
        <SearchIcon />
        <input
          ref={field}
          id={SETTINGS_SEARCH_INPUT_ID}
          className="session-search-input"
          aria-label="Search settings"
          placeholder={SEARCH_PLACEHOLDER}
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
    </div>
  );
}

/**
 * What a query left, read the way macOS System Settings reads it: each page
 * that holds a match leads its group — glyph, name, and the chevron that
 * promises a page — with the kept rows nested beneath it, each saying why it
 * matched. The front page's rows stand headless at the top, because the
 * front page is home rather than a destination worth naming. An emptied
 * search says so rather than going blank — there is no filter hiding matches
 * here, so there is nothing to offer but the words.
 */
export function SettingsSearchResults({
  search,
  pageIcon,
  onOpenPage,
  onOpen,
}: {
  search: SettingsSearchOutcome;
  /** The page's own glyph, from the same table the front page's rows draw. */
  pageIcon: (page: SettingsSubview) => React.JSX.Element;
  /** A pressed group head, which opens the page itself. */
  onOpenPage: (page: SettingsSubview) => void;
  /** A pressed row, which opens the page and lands on the row. */
  onOpen: (entry: SettingsSearchEntry) => void;
}): React.JSX.Element {
  if (search.matched === 0) {
    return (
      <div className="empty-state">
        <strong>No settings match</strong>
      </div>
    );
  }
  return (
    <section className="settings-section settings-index">
      {search.groups.map((group) => {
        // The front page heads nothing; every other page is one a row opens.
        const head = SETTINGS_SUBVIEW_LIST.find((candidate) => candidate === group.page);
        return (
          <Fragment key={group.page}>
            {head ? (
              <button type="button" className="settings-nav" onClick={() => onOpenPage(head)}>
                <span className="settings-nav-mark" aria-hidden="true">
                  {pageIcon(head)}
                </span>
                <span className="settings-copy">
                  <strong>
                    <Highlighted text={RESULT_PAGE_WORD[head]} tokens={search.tokens} />
                  </strong>
                </span>
                <ChevronIcon />
              </button>
            ) : null}
            {group.items.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className="settings-nav settings-result"
                data-nested={String(group.page !== SETTINGS_VIEW.ROOT)}
                onClick={() => onOpen(entry)}
              >
                {entry.icon ? (
                  <span className="settings-result-mark" aria-hidden="true">
                    {entry.icon}
                  </span>
                ) : null}
                <span className="settings-copy">
                  <strong>
                    <Highlighted text={entry.label} tokens={search.tokens} />
                  </strong>
                </span>
              </button>
            ))}
          </Fragment>
        );
      })}
    </section>
  );
}

import { PRODUCT_SEARCH_SURFACE, PRODUCT_SURFACE_EVENT } from "@luke/features/analytics";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import {
  APP_SETTING_SCHEMA,
  describedSettings,
  EXPERIMENTS,
  type SettingsRowsInput,
  settingFieldForId,
  settingIdVisible,
} from "@luke/settings";
import {
  EXPERIMENT_ANCHOR,
  SETTINGS_SEARCH_ANCHOR_ATTRIBUTE,
  SETTINGS_SEARCH_ROW,
} from "@luke/settings/settings-anchors";
import {
  SETTINGS_PAGE_LIST,
  SETTINGS_SECTION,
  SETTINGS_VIEW,
  type SettingsView,
} from "@luke/settings/settings-views";
import { CloseIcon, SearchIcon } from "@luke/ui";
import { integrationLines } from "@luke/ui/integration-search";
import { matchesTokens, searchTokens } from "@luke/ui/search-tokens";
import { useEffect, useRef } from "react";
import { APP_COMMAND, APP_SHORTCUTS, shownShortcutGroups } from "#shared/shortcuts";
import { useAppCommand } from "./app-commands";
import { drawnVisibly, focusSeek } from "./focus-seek";
import { focusSearchField, Highlighted } from "./search-field";
import { settingsPageOf } from "./settings/pages";
import { Shortcut } from "./shortcut";
import { commandKeyshortcuts } from "./tooltip";

/**
 * Searching the Settings tab.
 *
 * The pages hold more rows than anyone remembers the address of, so the
 * settings sidebar carries a search field above its list of pages, the way
 * macOS System Settings and an editor's settings do: typing turns the list
 * into the rows the query found, and clearing it turns the list back. The
 * search reads across every page wherever it is made from. The corpus is
 * everything the pages currently offer: the stored settings come from the same
 * descriptions their rows are drawn from — one description of each setting, so
 * the search and the row cannot drift apart — and each says for itself whether
 * its row is drawn, so nothing here restates a condition a page branches on.
 * The rows that are not settings (a permission, a shortcut, the ways out) are
 * declared here, gated by the same conditions that draw them. A row the pages
 * are not drawing right now is not offered, because a result that leads to a
 * page without its row is a promise the page cannot keep.
 *
 * Results read the way macOS System Settings reads them: grouped under the
 * name of the page that holds them. Pressing one opens its page and takes
 * the view to the row itself, by the anchor the row wears.
 * The search is read-only over names and descriptions the build already
 * fixed — a query narrows what is offered and never widens what can be done.
 */

/** How the search field is found by the seek that lands Command-F's caret in it. */
const SETTINGS_SEARCH_INPUT_ID = "settings-search-input";

/** One row a query can find, and where pressing it leads. */
export interface SettingsSearchEntry {
  /**
   * The row's own id: a setting's schema id, or a member of
   * `SETTINGS_SEARCH_ROW`. It is what the landing seeks — as the anchor the
   * row wears.
   */
  id: string;
  /** The row's own name, which is what the result draws. */
  label: string;
  /** The page the row is drawn on, which is where the result leads. */
  page: SettingsView;
  /** Every line the query is read against: the label, and words about it. */
  haystack: readonly string[];
}

/**
 * What the pages must answer before the corpus can say what they hold: the one
 * record the rows themselves are drawn from. The settings' own half is the
 * schema's — each entry says whether its row is drawn right now, judged from
 * this same record — so nothing here restates a condition a page branches on.
 * Beside it, the workspace the Workspace page shows, absent while it draws none.
 * An integration's tools are not here: the Integrations page's own filter
 * finds them (`settings/integrations-page.tsx`).
 */
export type SettingsSearchInput = SettingsRowsInput & {
  workspace?: Workspace | undefined;
};

/**
 * The page named the way a group's head says it: the names the sidebar's own
 * list of pages uses, so a result's group and the row it opens agree. The
 * command palette names a setting's page beside it in the same words.
 */
export function resultPageWord(page: SettingsView): string {
  return settingsPageOf(page).title;
}

/** The words every shortcut row can be found by, beside its own name. */
const SHORTCUT_WORDS = "keyboard shortcut hotkey key chord record remove delete none";

/** The words every integration's row can be found by, beside its own name. */
const INTEGRATION_WORDS = "connect disconnect integration mcp";

/** The words every experiment's row answers to beside its own name, the ones other apps call the same page by. */
const EXPERIMENT_WORDS = "experiment preview beta labs early try";

/** The words every window shortcut answers to, which change nothing and so offer no removal. */
const WINDOW_SHORTCUT_WORDS = "keyboard shortcut key chord";

/**
 * The rows that are not stored settings, each gated by the condition that
 * draws it. Declared as one table so a row added to a page has one place to
 * become findable.
 */
function fixedEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const entries: (SettingsSearchEntry | undefined)[] = [
    {
      id: SETTINGS_SEARCH_ROW.UPDATES,
      label: "Updates",
      page: SETTINGS_VIEW.ABOUT,
      haystack: ["Updates", "version release download check for updates build commit development"],
    },
    {
      id: SETTINGS_SEARCH_ROW.CHANGELOG,
      label: "Changelog",
      page: SETTINGS_VIEW.ABOUT,
      haystack: ["Changelog", "release notes version history what's new what changed"],
    },
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.SIGN_OUT,
          label: "Sign out",
          page: SETTINGS_VIEW.ACCOUNT,
          haystack: ["Sign out", "account sign out log out"],
        }
      : undefined,
    // Each experiment's row on Experimental, drawn once an account is signed in: found by its name and what it brings.
    ...EXPERIMENTS.map((entry) =>
      input.accountDrawn
        ? {
            id: EXPERIMENT_ANCHOR[entry.key],
            label: entry.name,
            page: SETTINGS_VIEW.EXPERIMENTAL,
            haystack: [entry.name, entry.detail, EXPERIMENT_WORDS],
          }
        : undefined,
    ),
    // Each integration's row on its page, drawn once an account is signed in and anchored by its provider.
    ...INTEGRATION_PROVIDER_LIST.map((provider) =>
      input.accountDrawn
        ? {
            id: provider,
            label: INTEGRATION_NAME[provider],
            page: SETTINGS_VIEW.INTEGRATIONS,
            haystack: [...integrationLines(provider), INTEGRATION_WORDS],
          }
        : undefined,
    ),
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.DELETE_ACCOUNT,
          label: "Delete account",
          page: SETTINGS_VIEW.ACCOUNT,
          haystack: ["Delete account", "account erase remove"],
        }
      : undefined,
    // The Voice page's permission row, drawn once there is a voice to reach.
    input.settings.voiceAvailable
      ? {
          id: SETTINGS_SEARCH_ROW.MICROPHONE,
          label: "Microphone",
          page: SETTINGS_VIEW.VOICE,
          haystack: ["Microphone", "permission access allow privacy system settings"],
        }
      : undefined,
    // The two keys, which are rows but not stored settings: what each is
    // set to lives with the registrar, and the rows are always drawn.
    {
      id: SETTINGS_SEARCH_ROW.TALK_KEY,
      label: "Talk to Luke",
      page: SETTINGS_VIEW.VOICE,
      haystack: ["Talk to Luke", SHORTCUT_WORDS, "talk speak hold microphone hold to talk"],
    },
    {
      id: SETTINGS_SEARCH_ROW.STOP_KEY,
      label: "Stop Luke",
      page: SETTINGS_VIEW.VOICE,
      haystack: ["Stop Luke", SHORTCUT_WORDS, "stop interrupt quiet cut off a reply"],
    },
    // The account's plan template, which is the account's on the service: drawn once an account is signed in.
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.PLAN_TEMPLATE,
          label: "Plan template",
          page: SETTINGS_VIEW.PLAN_TEMPLATE,
          haystack: [
            "Plan template",
            "new task plan starter document markdown sections headings default",
          ],
        }
      : undefined,
    // The coding agents' default, which is the account's on the service: drawn once an account is signed in.
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.CODING_AGENT_MODEL,
          label: "Model",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: ["Model", "default model coding agent claude gpt start"],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.CODING_AGENT_EFFORT,
          label: "Effort",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: ["Effort", "default effort coding agent reasoning low medium high max"],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.CODING_AGENT_FAST,
          label: "Fast",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: ["Fast", "coding agent fast version speed quick model"],
        }
      : undefined,
    // The account's own provider keys, which are the account's on the service: drawn once an account is signed in.
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.API_KEY_ANTHROPIC,
          label: "Anthropic API key",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: [
            "Anthropic API key",
            "api keys byok own key claude billing provider credential",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.API_KEY_OPENAI,
          label: "OpenAI API key",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: [
            "OpenAI API key",
            "api keys byok own key gpt codex billing provider credential",
          ],
        }
      : undefined,
    // The Workspace page's groups, as it draws them for the workspace it
    // shows: the invite only where the reader may invite, and the leave
    // only where the reader may leave.
    input.workspace
      ? {
          id: SETTINGS_SECTION.MEMBERS,
          label: "Members",
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: ["Members", "people team remove role"],
        }
      : undefined,
    input.workspace !== undefined && managesWorkspace(input.workspace)
      ? {
          id: SETTINGS_SECTION.INVITATIONS,
          label: "Invitations",
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: ["Invitations", "invite people add teammate link pending"],
        }
      : undefined,
    input.workspace !== undefined && input.workspace.role !== WORKSPACE_ROLE.OWNER
      ? {
          id: SETTINGS_SECTION.LEAVE,
          label: `Leave ${input.workspace.name}`,
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: [`Leave ${input.workspace.name}`, "leave quit exit workspace"],
        }
      : undefined,
    input.workspace
      ? {
          id: SETTINGS_SECTION.GITHUB_REPOSITORIES,
          label: "Integrations",
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: [
            "Integrations",
            "GitHub Linear issues repositories connect choose manage disconnect organization",
          ],
        }
      : undefined,
    // The window's own chords, fixed rather than chosen, listed below them; a gated feature's only while its experiment is on.
    ...shownShortcutGroups(input.settings.experiments).flatMap((group) =>
      group.commands.map((command) => ({
        id: command,
        label: APP_SHORTCUTS[command].label,
        page: SETTINGS_VIEW.SHORTCUTS,
        haystack: [APP_SHORTCUTS[command].label, WINDOW_SHORTCUT_WORDS, group.title],
      })),
    ),
  ];
  return entries.filter((entry): entry is SettingsSearchEntry => entry !== undefined);
}

/**
 * Everything a query can find right now, ordered by page the way the front
 * page orders them — the stored settings first within a page, then the rows
 * that are not settings. Each entry carries the page's own name in its
 * haystack, so a page's name finds everything the page holds.
 */
export function settingsSearchEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const described = describedSettings(input.settings).flatMap((setting): SettingsSearchEntry[] => {
    const field = settingFieldForId(setting.id);
    if (!field) return [];
    if (!settingIdVisible(setting.id, input)) return [];
    // A choice is found by what it offers as well as by its name, so "dark"
    // finds the theme its row no longer has to describe.
    const offered = APP_SETTING_SCHEMA[field].control?.options(input) ?? [];
    return [
      {
        id: setting.id,
        label: setting.label,
        page: APP_SETTING_SCHEMA[field].page,
        haystack: [
          setting.label,
          ...(setting.detail === undefined ? [] : [setting.detail]),
          ...offered.map((option) => option.label),
        ],
      },
    ];
  });
  const fixed = fixedEntries(input);
  return SETTINGS_PAGE_LIST.flatMap((page) => [
    ...described.filter((entry) => entry.page === page),
    ...fixed.filter((entry) => entry.page === page),
  ]).map((entry) => ({
    ...entry,
    haystack: [...entry.haystack, resultPageWord(entry.page)],
  }));
}

/** One page's matches: the page that heads the group, and the rows under it. */
interface SettingsSearchGroup {
  page: SettingsView;
  items: readonly SettingsSearchEntry[];
}

/** What became of the query, reported so no narrowing is ever silent. */
export interface SettingsSearchOutcome {
  /** The query's words, lowercased — what each entry was actually read against. */
  tokens: readonly string[];
  /** The kept rows grouped under their pages, in the Settings sidebar's own order. */
  groups: readonly SettingsSearchGroup[];
  /** How many rows the query kept, across every group. */
  matched: number;
}

/**
 * The query read over the corpus: every word must land somewhere in an
 * entry's haystack. A blank query is no search at all. The kept rows come
 * back grouped by page, because that is how the results are drawn.
 */
export function searchSettings(
  entries: readonly SettingsSearchEntry[],
  query: string,
): SettingsSearchOutcome | undefined {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return undefined;
  const kept = entries.filter((entry) => matchesTokens(entry.haystack, tokens));
  const groups = SETTINGS_PAGE_LIST.flatMap((page): SettingsSearchGroup[] => {
    const items = kept.filter((entry) => entry.page === page);
    return items.length > 0 ? [{ page, items }] : [];
  });
  return { tokens, groups, matched: kept.length };
}

/** Whether the landing can hold the keyboard, or only be scrolled into view. */
const FOCUSABLE = "button, select, input, textarea, [tabindex]";

/**
 * What a landed row wears for the stylesheet to ring it once, so the eye finds
 * the row the view just moved to. The ring is a one-shot animation in
 * `settings.css`; the attribute stays until the row is landed on again.
 */
const SETTINGS_SEARCH_LANDED_ATTRIBUTE = "data-search-landed";

/**
 * Takes the view to the row a pressed result named, waiting out the page swap
 * the press asked for — the same frame-by-frame seek the session search field
 * needs, because the row is not drawn until React has answered. The row is
 * found by the anchor it wears, and is scrolled to the top of the view — the
 * scroller's own scroll padding keeps it clear of a pinned header — with a
 * control also taking the keyboard, without a second scroll of its own, and
 * the row ringed for a moment. It lands after the page's own header focus on
 * purpose: the result named a row, so the row is where the view belongs. A
 * row the page is not drawing is given up on quietly.
 */
export function landOnSettingsRow(id: string): () => void {
  return focusSeek({
    find: () =>
      document.querySelector<HTMLElement>(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${id}"]`),
    ready: drawnVisibly,
    act: (element) => {
      element.scrollIntoView({ block: "start" });
      // A row with one control anchors the control itself, which takes the
      // keyboard; a row of several anchors the row and takes none, since
      // choosing among its buttons is not the landing's to do.
      if (element.matches(FOCUSABLE)) element.focus({ preventScroll: true });
      // Note that the attribute comes off and back on across a style flush,
      // because an animation only restarts when its rule is matched afresh,
      // and a row landed on twice should ring twice.
      element.removeAttribute(SETTINGS_SEARCH_LANDED_ATTRIBUTE);
      element.getBoundingClientRect();
      element.setAttribute(SETTINGS_SEARCH_LANDED_ATTRIBUTE, "");
    },
  });
}

/**
 * The search field at the head of the settings sidebar: a magnifier, the
 * field, and a clear button while a query stands. It stays drawn and keeps its
 * height whatever is typed, so neither the list under it nor the page beside
 * it moves as the query changes.
 *
 * Settings opens with the caret here, so the first keys typed search. A caret
 * the window already put somewhere, a row a link or the palette landed on,
 * keeps it. That caret is not counted as a search opened, because nobody
 * asked for it, and it holds no layer of its own: Escape in the field it left
 * untouched leaves Settings in one press, as it would with the caret nowhere.
 *
 * Otherwise Escape unwinds one layer at a time, the way it does everywhere
 * else in the window: a held query is cleared first, and only an empty field
 * lets go of the caret — both stopped here, so neither press falls through
 * and turns the page or the tab behind the field. Return opens the first result, so a
 * query someone is sure of needs no pointer. Command-F lands here unless the
 * page beside it has a search of its own, as Integrations does, which is
 * the nearer question; the chord is printed in whichever field it lands in.
 */
export function SettingsSearchField({
  query,
  onQueryChange,
  onSubmit,
  find = true,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  /** Return pressed in the field: the first result is the answer. */
  onSubmit: () => void;
  /** Whether Command-F lands here: not while the page shows a search of its own. */
  find?: boolean;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  // Whether the caret stands where Settings put it as it opened, untouched since.
  const placed = useRef(false);
  useAppCommand(
    APP_COMMAND.FIND,
    find
      ? () => {
          placed.current = false;
          focusSearchField(SETTINGS_SEARCH_INPUT_ID);
        }
      : undefined,
  );
  useEffect(
    () =>
      focusSeek({
        find: () => field.current,
        act: (input) => {
          // Note that a caret already in the window keeps it, because a link
          // or a palette result that landed on a row put it there on purpose.
          const held = document.activeElement;
          if (held !== null && held !== document.body) return;
          placed.current = true;
          input.focus({ preventScroll: true });
        },
      }),
    [],
  );
  return (
    <search className="settings-search">
      {/* The label is the whole well, so a press on the magnifier or the
          padding lands the caret the way a press on the text would. */}
      <label className="settings-search-well field-well">
        <SearchIcon />
        <input
          ref={field}
          id={SETTINGS_SEARCH_INPUT_ID}
          className="settings-search-input"
          aria-label="Search settings"
          aria-keyshortcuts={find ? commandKeyshortcuts(APP_COMMAND.FIND) : undefined}
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            placed.current = false;
            onQueryChange(event.target.value);
          }}
          onFocus={() => {
            if (placed.current) return;
            window.luke.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SEARCH_OPEN, {
              search_surface: PRODUCT_SEARCH_SURFACE.SETTINGS,
            });
          }}
          onBlur={() => {
            placed.current = false;
          }}
          onKeyDown={(event) => {
            // The caret Settings placed on its own holds no layer, so its
            // Escape falls through to the window and leaves Settings, unless
            // an input method is spending the press on its candidates.
            const untouched = placed.current && query.length === 0;
            if (event.key === "Escape" && untouched && !event.nativeEvent.isComposing) return;
            // Note that an Escape is stopped even mid-composition, because the
            // input method spends that press dismissing its candidates, and
            // the window's own Escape would turn the page behind the field.
            if (event.key === "Escape") event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              onSubmit();
              return;
            }
            if (event.key !== "Escape") return;
            if (query.length > 0) onQueryChange("");
            else field.current?.blur();
          }}
        />
        {/* The chord that lands here is printed in the empty field, the way
            a Mac search field says it, and gives way to the caret. */}
        {query.length > 0 ? (
          <button
            type="button"
            className="icon-button settings-search-clear"
            aria-label="Clear search"
            onClick={() => {
              // A cleared field keeps the caret, ready for the next question.
              onQueryChange("");
              field.current?.focus();
            }}
          >
            <CloseIcon />
          </button>
        ) : find ? (
          <Shortcut
            chord={APP_SHORTCUTS[APP_COMMAND.FIND].chord}
            className="settings-search-shortcut"
          />
        ) : null}
      </label>
    </search>
  );
}

/**
 * What a query left, in the sidebar where the list of pages was: each page
 * that holds a match names itself as a heading, the way the sidebar's other
 * lists are headed, with the kept rows beneath it, each marking why it
 * matched. The row last opened stays marked, the way a list marks the page
 * it opened. An emptied search says so quietly rather than going blank.
 */
export function SettingsSearchResults({
  search,
  opened,
  onOpen,
}: {
  search: SettingsSearchOutcome;
  /** The id of the result last pressed, absent until one is. */
  opened?: string | undefined;
  /** A pressed row, which opens its page and lands on the row. */
  onOpen: (entry: SettingsSearchEntry) => void;
}): React.JSX.Element {
  if (search.matched === 0) {
    return (
      <p className="sidebar-note" role="status">
        No results
      </p>
    );
  }
  return (
    <div className="settings-search-results">
      {search.groups.map((group) => (
        <section key={group.page} aria-label={resultPageWord(group.page)}>
          <h2 className="section-heading">{resultPageWord(group.page)}</h2>
          <ul>
            {group.items.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="sidebar-item"
                  aria-current={entry.id === opened ? "location" : undefined}
                  onClick={() => onOpen(entry)}
                >
                  <span className="settings-search-result">
                    <Highlighted text={entry.label} tokens={search.tokens} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

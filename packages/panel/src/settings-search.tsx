import { PRODUCT_SEARCH_SURFACE, PRODUCT_SURFACE_EVENT } from "@luke/features/analytics";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { noMatchWords, TERM } from "@luke/features/words";
import { managesWorkspace } from "@luke/features/workspace-role";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import {
  APP_SETTING_SCHEMA,
  describedSettings,
  EXPERIMENTS,
  HOST_CAPABILITY,
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
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  CHAPTERS_GROUP_TITLE,
  CHAPTERS_KEYS,
  CHAPTERS_SHORTCUTS,
  FILES_CHANGED_GROUP_TITLE,
  FILES_CHANGED_KEYS_LISTED,
  FILES_CHANGED_SHORTCUTS,
  IN_CONTEXT_KEY,
  IN_CONTEXT_SHORTCUTS,
  type InContextKey,
  inContextShown,
  shortcutLabel,
  shownShortcutGroups,
  WRITING_ACTIONS_LISTED,
  WRITING_GROUP_TITLE,
  WRITING_KEYS_IN_CONTEXT,
  WRITING_SHORTCUTS,
  type WritingShortcut,
} from "@luke/settings/shortcuts";
import {
  commandKeyshortcuts,
  GAP,
  GroupHeader,
  LAYOUT_ELEMENT,
  NAV_CURRENT,
  NavItem,
  NOTE_LINE_LOOK,
  NoteLine,
  SearchField,
  Shortcut,
  Stack,
} from "@luke/ui";
import { integrationLines } from "@luke/ui/integration-search";
import { land } from "@luke/ui/landed";
import { searchHit } from "@luke/ui/search-score";
import { type MatchRange, searchTokens } from "@luke/ui/search-tokens";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { useEffect, useRef } from "react";
import { useAppCommand } from "./app-commands.js";
import { appPlatform } from "./app-platform.js";
import { drawnVisibly, focusSeek } from "./focus-seek.js";
import { focusSearchField, Highlighted } from "./search-field.js";
import { MAC_REPOSITORIES, settingsPageOf, WORKSPACE_CONNECTIONS } from "./settings/pages.js";
import { settingsPageShown } from "./settings/settings-rows.js";

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

/**
 * What an empty search says, the words module's miss line and then what to try,
 * because a miss that only says it missed leaves the reader nothing to do.
 */
const SETTINGS_NO_MATCH_WORDS = `${noMatchWords(TERM.RESULT)}. Try a page's name, such as Voice, or fewer words.`;

/** The words every integration's row can be found by, beside its own name. */
const INTEGRATION_WORDS = "connect disconnect integration mcp";

/** The words every experiment's row answers to beside its own name, the ones other apps call the same page by. */
const EXPERIMENT_WORDS = "experiment preview beta labs early try";

/** The words every window shortcut answers to, which change nothing and so offer no removal. */
const WINDOW_SHORTCUT_WORDS = "keyboard shortcut key chord";

/** The words the one Escape row answers to besides, which stands for every layer the key steps back from. */
const ESCAPE_WORDS = "escape esc exit leave back";

/** The words every writing chord and Markdown rule answers to besides. */
const WRITING_WORDS = "format formatting markdown editor text";

/** A key that answers in place, as the Keyboard shortcuts page lists it under `group`. */
function inContextEntry(key: InContextKey, group: string): SettingsSearchEntry {
  const { label } = IN_CONTEXT_SHORTCUTS[key];
  const leaving = key === IN_CONTEXT_KEY.STEP_BACK ? ESCAPE_WORDS : "";
  return {
    id: key,
    label,
    page: SETTINGS_VIEW.SHORTCUTS,
    haystack: [label, WINDOW_SHORTCUT_WORDS, group, leaving],
  };
}

/**
 * The rows that are not stored settings, each gated by the condition that
 * draws it. Declared as one table so a row added to a page has one place to
 * become findable.
 */
function fixedEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const entries: (SettingsSearchEntry | undefined)[] = [
    input.capabilities.includes(HOST_CAPABILITY.UPDATES)
      ? {
          id: SETTINGS_SEARCH_ROW.UPDATES,
          label: "Updates",
          page: SETTINGS_VIEW.ABOUT,
          haystack: [
            "Updates",
            "version release download check for updates build commit development",
          ],
        }
      : undefined,
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
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.GITHUB_ACCESS,
          label: "GitHub personal access token",
          page: SETTINGS_VIEW.ACCOUNT,
          haystack: ["GitHub personal access token", "classic token PAT add manage"],
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
    // The Voice page's permission row, drawn once there is a voice to reach and a microphone to ask for.
    input.settings.voiceAvailable && input.capabilities.includes(HOST_CAPABILITY.MICROPHONE)
      ? {
          id: SETTINGS_SEARCH_ROW.MICROPHONE,
          label: "Microphone",
          page: SETTINGS_VIEW.VOICE,
          haystack: ["Microphone", "permission access allow privacy system settings"],
        }
      : undefined,
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
    // What the workspace's agents remember, which is the workspace's on the service: drawn once an account is signed in.
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.MEMORY,
          label: "Memory",
          page: SETTINGS_VIEW.MEMORY,
          haystack: ["Memory", "remember recall forget facts conventions shared memory"],
        }
      : undefined,
    // The coding agents' default, which is the account's on the service: drawn once an account is signed in.
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.CODING_AGENT_MODEL,
          label: "Default model",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: ["Default model", "model coding agent claude gpt start"],
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
    // The chapters model, which is the account's on the service: drawn once an account is signed in.
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.CHAPTERS_MODEL,
          label: "Chapters model",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: [
            "Chapters model",
            "pull request chapters generate claude haiku sonnet opus review",
          ],
        }
      : undefined,
    // The harnesses' rows, each holding the account's plan and API key for it on the service: drawn once an account is signed in.
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.API_KEY_ANTHROPIC,
          label: "Claude",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: [
            "Claude",
            "claude code anthropic api key byok own key claude plan subscription setup-token max pro billing provider credential",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.API_KEY_OPENAI,
          label: "Codex",
          page: SETTINGS_VIEW.CODING_AGENTS,
          haystack: [
            "Codex",
            "openai api key byok own key gpt chatgpt plan subscription billing provider credential voice call dictation dictate",
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
          label: WORKSPACE_CONNECTIONS,
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: [
            WORKSPACE_CONNECTIONS,
            "integrations GitHub Linear issues repositories connect choose manage disconnect organization",
          ],
        }
      : undefined,
    // Where each repository is cloned on this Mac, drawn on the Workspace page only where the app can run a terminal there.
    input.workspace && input.capabilities.includes(HOST_CAPABILITY.MAC_TERMINAL)
      ? {
          id: SETTINGS_SECTION.MAC_REPOSITORIES,
          label: MAC_REPOSITORIES,
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: [
            MAC_REPOSITORIES,
            "repository repositories clone folder checkout git command run checks terminal path",
          ],
        }
      : undefined,
    // The workspace's name, which an owner or an admin changes on the identity row, but not the account's first workspace, which its owner's account name names.
    input.workspace !== undefined &&
    managesWorkspace(input.workspace) &&
    input.workspace.personal !== true
      ? {
          id: SETTINGS_SEARCH_ROW.WORKSPACE_RENAME,
          label: "Rename workspace",
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: ["Rename workspace", "rename name change workspace photo"],
        }
      : undefined,
    // The Skills page's one standing row, drawn once the page has the workspace it lists the skills of: the skills themselves are read from the service and listed under it.
    input.workspace
      ? {
          id: SETTINGS_SEARCH_ROW.ADD_SKILL,
          label: "Add a skill",
          page: SETTINGS_VIEW.SKILLS,
          haystack: [
            "Add a skill",
            "skills skill install import github repository SKILL.md instructions agents",
          ],
        }
      : undefined,
    // The window's own chords, fixed rather than chosen, listed below them; a gated feature's only while its experiment is on.
    ...shownShortcutGroups(input.settings.experiments, input.capabilities).flatMap((group) => [
      ...group.commands.map((command) => ({
        id: command,
        label: shortcutLabel(command, input.settings.experiments),
        page: SETTINGS_VIEW.SHORTCUTS,
        haystack: [
          shortcutLabel(command, input.settings.experiments),
          WINDOW_SHORTCUT_WORDS,
          group.title,
        ],
      })),
      ...group.keys.map((key) => inContextEntry(key, group.title)),
    ]),
    // The writing chords and Markdown rules, listed under the window's, found by the rule typed too.
    ...WRITING_ACTIONS_LISTED.map((action) => {
      const { label, markdown }: WritingShortcut = WRITING_SHORTCUTS[action];
      return {
        id: action,
        label,
        page: SETTINGS_VIEW.SHORTCUTS,
        haystack: [
          label,
          WINDOW_SHORTCUT_WORDS,
          WRITING_GROUP_TITLE,
          WRITING_WORDS,
          markdown ?? "",
        ],
      };
    }),
    // A link's ⌘K and the @ list's keys, after the writing chords.
    ...WRITING_KEYS_IN_CONTEXT.filter((key) => inContextShown(key, input.capabilities)).map((key) =>
      inContextEntry(key, WRITING_GROUP_TITLE),
    ),
    // Files changed's own keys, listed under Writing.
    ...FILES_CHANGED_KEYS_LISTED.map((key) => ({
      id: key,
      label: FILES_CHANGED_SHORTCUTS[key].label,
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: [
        FILES_CHANGED_SHORTCUTS[key].label,
        WINDOW_SHORTCUT_WORDS,
        FILES_CHANGED_GROUP_TITLE,
      ],
    })),
    // Chapters' own keys, after Files changed's.
    ...CHAPTERS_KEYS.map((key) => ({
      id: key,
      label: CHAPTERS_SHORTCUTS[key].label,
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: [CHAPTERS_SHORTCUTS[key].label, WINDOW_SHORTCUT_WORDS, CHAPTERS_GROUP_TITLE],
    })),
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
  const pages = SETTINGS_PAGE_LIST.filter((page) =>
    settingsPageShown(page, input.capabilities, input.settings.experiments),
  );
  return pages
    .flatMap((page) => [
      ...described.filter((entry) => entry.page === page),
      ...fixed.filter((entry) => entry.page === page),
    ])
    .map((entry) => ({
      ...entry,
      haystack: [...entry.haystack, resultPageWord(entry.page)],
    }));
}

/** A row a query found, with the stretches of its name that say why. */
export interface SettingsSearchResult extends SettingsSearchEntry {
  marks: readonly MatchRange[];
}

/** One page's matches: the page that heads the group, and the rows under it, best first. */
interface SettingsSearchGroup {
  page: SettingsView;
  items: readonly SettingsSearchResult[];
}

/** What became of the query, reported so no narrowing is ever silent. */
export interface SettingsSearchOutcome {
  /** The kept rows grouped under their pages, in the Settings sidebar's own order. */
  groups: readonly SettingsSearchGroup[];
  /** How many rows the query kept, across every group. */
  matched: number;
}

/**
 * The query read over the corpus by the one tiered scorer (`searchHit`), the
 * way ⌘K reads its rows: every word must land somewhere in an entry, its
 * name first and the words it is known by after, and a row whose name is the
 * query or begins with it ranks above one whose words are scattered, a row
 * found only by what its name does not say last. Letters typed in order
 * find nothing, so "thm" is not Theme. A blank query is no search at all.
 * The kept rows come back grouped by page, because that is how the results
 * are drawn, each page's rows best first and equals in the corpus's order.
 */
export function searchSettings(
  entries: readonly SettingsSearchEntry[],
  query: string,
): SettingsSearchOutcome | undefined {
  if (searchTokens(query).length === 0) return undefined;
  const kept = entries.flatMap((entry): { entry: SettingsSearchResult; score: number }[] => {
    const hit = searchHit({ label: entry.label, keywords: entry.haystack }, query);
    return hit === undefined ? [] : [{ entry: { ...entry, marks: hit.label }, score: hit.score }];
  });
  const groups = SETTINGS_PAGE_LIST.flatMap((page): SettingsSearchGroup[] => {
    const items = kept
      .filter(({ entry }) => entry.page === page)
      .sort((a, b) => b.score - a.score)
      .map(({ entry }) => entry);
    return items.length > 0 ? [{ page, items }] : [];
  });
  return { groups, matched: kept.length };
}

/** Whether the landing can hold the keyboard, or only be scrolled into view. */
const FOCUSABLE = "button, select, input, textarea, [tabindex]";

/**
 * Takes the view to the row a pressed result named, waiting out the page swap
 * the press asked for — the same frame-by-frame seek the session search field
 * needs, because the row is not drawn until React has answered. The row is
 * found by the anchor it wears, and is scrolled to the top of the view — the
 * scroller's own scroll padding keeps it clear of a pinned header — with a
 * control also taking the keyboard, without a second scroll of its own, and
 * the row lit for a moment, as every place landed on is (`land`), once more
 * each time it is landed on. It lands after the page's own header focus on
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
      land(element);
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
  onFind,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  /** Return pressed in the field: the first result is the answer. */
  onSubmit: () => void;
  /** Whether Command-F lands here: not while the page shows a search of its own. */
  find?: boolean;
  /** Shows the field before Command-F lands in it, where it stands hidden, as a narrow room hides the page list behind a page. */
  onFind?: (() => void) | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  // Whether the caret stands where Settings put it as it opened, untouched since.
  const [placed, setPlaced, placedNow] = useStateWithRef(false);
  useAppCommand(
    APP_COMMAND.FIND,
    find
      ? () => {
          setPlaced(false);
          if (onFind === undefined) focusSearchField(SETTINGS_SEARCH_INPUT_ID);
          else {
            onFind();
            // Note that the field waits to be shown, because a hidden one refuses the caret.
            focusSearchField(
              SETTINGS_SEARCH_INPUT_ID,
              (field) => field.closest("[hidden]") === null,
            );
          }
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
          setPlaced(true);
          input.focus({ preventScroll: true });
        },
      }),
    [setPlaced],
  );
  // The caret Settings placed on its own holds no layer, so its Escape is
  // left to fall through to the window and leave Settings.
  const untouched = placed && query.length === 0;
  return (
    <search
      className="settings-search mb-section-gap flex-none"
      onFocus={(event) => {
        if (event.target !== field.current || placedNow()) return;
        appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SEARCH_OPEN, {
          search_surface: PRODUCT_SEARCH_SURFACE.SETTINGS,
        });
      }}
      onBlur={(event) => {
        if (event.target === field.current) setPlaced(false);
      }}
      onKeyDown={(event) => {
        // Note that an Escape is stopped even mid-composition, because the
        // input method spends that press dismissing its candidates, and the
        // window's own Escape would turn the page behind the field.
        if (event.key === "Escape" && event.nativeEvent.isComposing) event.stopPropagation();
      }}
    >
      <SearchField
        ref={field}
        id={SETTINGS_SEARCH_INPUT_ID}
        label="Search settings"
        placeholder="Search"
        keyShortcuts={find ? commandKeyshortcuts(APP_COMMAND.FIND) : undefined}
        shortcut={find ? <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.FIND].chord} /> : undefined}
        value={query}
        onChange={(next) => {
          setPlaced(false);
          onQueryChange(next);
        }}
        onClear={() => onQueryChange("")}
        onEnter={onSubmit}
        onEscape={
          untouched
            ? undefined
            : () => {
                if (query.length > 0) onQueryChange("");
                else field.current?.blur();
              }
        }
      />
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
      <NoteLine look={NOTE_LINE_LOOK.ROWS} status>
        {SETTINGS_NO_MATCH_WORDS}
      </NoteLine>
    );
  }
  return (
    <div className="settings-search-results flex flex-col gap-section-gap">
      {search.groups.map((group) => (
        <section key={group.page} aria-label={resultPageWord(group.page)}>
          <GroupHeader label={resultPageWord(group.page)}>
            <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW}>
              {group.items.map((entry) => (
                <li key={entry.id}>
                  <NavItem
                    current={entry.id === opened ? NAV_CURRENT.LOCATION : undefined}
                    roving
                    onClick={() => onOpen(entry)}
                  >
                    <Highlighted text={entry.label} ranges={entry.marks} />
                  </NavItem>
                </li>
              ))}
            </Stack>
          </GroupHeader>
        </section>
      ))}
    </div>
  );
}

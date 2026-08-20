import { PROVIDER_ID } from "@sidecar/core";
import { useRef } from "react";
import type { AppSettings } from "../shared/contracts";
import { CREDENTIAL_SOURCE, VOICE_SOURCE } from "../shared/contracts";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDER_ID,
  VOICE_CREDENTIAL_PROVIDER,
} from "../shared/credential-providers";
import { GOOGLE_CALENDAR_NAME } from "../shared/google-calendar";
import {
  APP_SETTING_ID,
  type AppSettingId,
  isAppSettingId,
  SETTING_PAGE,
  settingGuideEntries,
} from "../shared/settings-schema";
import { workspaceAgentModels } from "../shared/workspace-agents";
import { FOCUS_FRAME_LIMIT } from "./credential-entry";
import { cssCustomProperties } from "./css-custom-properties";
import { ERRAND_TARGET_ATTRIBUTE, type ErrandTarget } from "./luke-errand";
import { searchTokens } from "./session-model";
import { Highlighted } from "./session-search";
import { ChevronIcon, CloseIcon, SearchIcon } from "./settings-icons";
import { SETTINGS_VIEW, type SettingsView } from "./settings-views";

/**
 * Searching the Settings tab.
 *
 * The pages hold more rows than anyone remembers the address of, so the front
 * page carries a field that finds a row wherever it is drawn. The corpus is
 * everything the pages currently offer: the stored settings come from the same
 * guide entries the voice conversation is handed — one description of each
 * setting, so the search and Luke's own account of himself cannot drift apart
 * — and the rows that are not settings (a permission, a key, a shortcut, the
 * ways out) are declared here, gated by the same conditions that draw them.
 * A row the pages are not drawing right now is not offered, because a result
 * that leads to a page without its row is a promise the page cannot keep.
 *
 * A result names its row and the page that holds it; pressing one opens that
 * page. The search is read-only over names and descriptions the build already
 * fixed — a query narrows what is offered and never widens what can be done.
 */

/** What the field is for, in the words the pages themselves use. */
const SEARCH_PLACEHOLDER = "Search settings…";

/** One row a query can find, and where pressing it leads. */
export interface SettingsSearchEntry {
  /** The row's own name, which is what the result draws. */
  label: string;
  /** The page the row is drawn on, which is where the result leads. */
  page: SettingsView;
  /**
   * The row's control, named by the same mark a spoken errand lands on, so a
   * pressed result can hand the keyboard to the very control it named. A row
   * whose control carries no mark is opened by page alone.
   */
  target?: ErrandTarget;
  /** Every line the query is read against: the label, and words about it. */
  haystack: readonly string[];
}

/** What the pages must answer before the corpus can say what they hold. */
export interface SettingsSearchInput {
  settings: AppSettings;
  /**
   * Whether the voice controls stand on the Voice page: voice available and
   * the microphone granted. Until both, that page holds only the way in.
   */
  voiceControlsDrawn: boolean;
  /** Whether the Account section stands at the foot of the front page. */
  accountDrawn: boolean;
  /** The Superset row is drawn while installed; its agent row needs more. */
  superset: { installed: boolean; connected: boolean; agentsOffered: boolean };
  /** Whether any provider offers projects, which draws a Default project row. */
  defaultProjectOffered: boolean;
}

/**
 * Whether a stored setting's row is currently drawn, for the settings whose
 * rows are conditional. A setting absent here is always drawn on its page.
 * These restate the conditions the pages themselves branch on — the one drift
 * this module accepts, stated per setting so a changed condition has one line
 * to change here.
 */
const conductorAgentRowDrawn = (input: SettingsSearchInput): boolean =>
  input.settings.credentialSources[CREDENTIAL_PROVIDER_ID.CONDUCTOR] !== CREDENTIAL_SOURCE.NONE &&
  workspaceAgentModels(PROVIDER_ID.CONDUCTOR).length > 0;

const voiceControlRowDrawn = (input: SettingsSearchInput): boolean => input.voiceControlsDrawn;

const SETTING_ROW_DRAWN = {
  // The What Luke runs on section stands only over a signed-in account.
  [APP_SETTING_ID.VOICE_SOURCE]: (input: SettingsSearchInput) => input.accountDrawn,
  // The voice controls exist only once there is a voice to control.
  [APP_SETTING_ID.VOICE]: voiceControlRowDrawn,
  [APP_SETTING_ID.VOICE_SPEED]: voiceControlRowDrawn,
  [APP_SETTING_ID.VOICE_CAPTIONS]: voiceControlRowDrawn,
  [APP_SETTING_ID.DUCK_OTHER_MEDIA]: voiceControlRowDrawn,
  [APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE]: voiceControlRowDrawn,
  // The quiet rides the calendar block, and appears with its first account.
  [APP_SETTING_ID.QUIET_DURING_MEETINGS]: (input) =>
    input.settings.calendarSignInAvailable && input.settings.calendarAccounts.length > 0,
  // The Conductor agent rows belong to a connected provider the build
  // documents a model table for.
  [APP_SETTING_ID.WORKSPACE_AGENT_MODEL]: conductorAgentRowDrawn,
  [APP_SETTING_ID.WORKSPACE_AGENT_EFFORT]: conductorAgentRowDrawn,
  // The Superset agent row stands under a connected Superset with agents.
  [APP_SETTING_ID.SUPERSET_AGENT]: (input: SettingsSearchInput) =>
    input.superset.connected && input.superset.agentsOffered,
} satisfies Partial<Record<AppSettingId, (input: SettingsSearchInput) => boolean>>;

/** Whether a setting's row is drawn; a setting the table leaves out always is. */
function settingRowDrawn(id: AppSettingId, input: SettingsSearchInput): boolean {
  if (!Object.hasOwn(SETTING_ROW_DRAWN, id)) return true;
  // SAFETY: hasOwn narrows the id to the table's own keys.
  return SETTING_ROW_DRAWN[id as keyof typeof SETTING_ROW_DRAWN](input);
}

/**
 * The page named the way a result says it aloud. `SETTINGS_PAGE_LABEL` words
 * the guide's by-hand paths mid-sentence; a result's breadcrumb stands alone,
 * so the front page takes its name capitalized.
 */
const RESULT_PAGE_WORD = {
  [SETTINGS_VIEW.ROOT]: "Front page",
  [SETTINGS_VIEW.VOICE]: "Voice",
  [SETTINGS_VIEW.APPEARANCE]: "Appearance",
  [SETTINGS_VIEW.SHORTCUTS]: "Keyboard shortcuts",
  [SETTINGS_VIEW.CONNECTIONS]: "Connections",
} satisfies Record<SettingsView, string>;

/** The pages in the order the front page offers them, which orders results. */
const PAGE_ORDER: readonly SettingsView[] = [
  SETTINGS_VIEW.ROOT,
  SETTINGS_VIEW.VOICE,
  SETTINGS_VIEW.APPEARANCE,
  SETTINGS_VIEW.SHORTCUTS,
  SETTINGS_VIEW.CONNECTIONS,
];

/** The words every shortcut row can be found by, beside its own name. */
const SHORTCUT_WORDS = "keyboard shortcut hotkey key chord record";

/** The words every key row can be found by, beside its provider's name. */
const KEY_WORDS = "API key credential connect cloud agent";

/**
 * The rows that are not stored settings, each gated by the condition that
 * draws it. Declared as one table so a row added to a page has one place to
 * become findable — the same rule the guide states for its facts.
 */
function fixedEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const entries: (SettingsSearchEntry | undefined)[] = [
    // The front page, in the order its sections stand. The key row is drawn
    // only while the key half of What Luke runs on is the live one; on the
    // account, the section's own entry is what a key-shaped query finds,
    // because its toggle is where a key is begun from there.
    input.accountDrawn && input.settings.voiceSource === VOICE_SOURCE.KEY
      ? {
          label: `${VOICE_CREDENTIAL_PROVIDER.displayName} API key`,
          page: SETTINGS_VIEW.ROOT,
          haystack: [
            `${VOICE_CREDENTIAL_PROVIDER.displayName} API key`,
            "credential connect voice unmetered what luke runs on",
          ],
        }
      : undefined,
    {
      label: "Updates",
      page: SETTINGS_VIEW.ROOT,
      haystack: ["Updates", "version release download check for updates"],
    },
    {
      label: "Feedback",
      page: SETTINGS_VIEW.ROOT,
      haystack: ["Feedback", "send feedback submit a prompt bug idea founders"],
    },
    input.accountDrawn
      ? {
          label: "Sign out",
          page: SETTINGS_VIEW.ROOT,
          haystack: ["Sign out", "account sign out log out"],
        }
      : undefined,
    input.accountDrawn
      ? {
          label: "Delete account",
          page: SETTINGS_VIEW.ROOT,
          haystack: ["Delete account", "account erase remove"],
        }
      : undefined,
    {
      label: "Quit Luke",
      page: SETTINGS_VIEW.ROOT,
      haystack: ["Quit Luke", "quit exit close the app"],
    },
    // The Voice page's permission row, drawn once there is a voice to reach.
    input.settings.voiceAvailable
      ? {
          label: "Microphone",
          page: SETTINGS_VIEW.VOICE,
          haystack: ["Microphone", "permission access allow privacy system settings"],
        }
      : undefined,
    // The three keys, which are rows but not stored settings: what each is
    // set to lives with the registrar, and the rows are always drawn.
    {
      label: "Talk to Luke",
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: ["Talk to Luke", SHORTCUT_WORDS, "talk speak hold microphone push to talk"],
    },
    {
      label: "Ask Luke",
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: ["Ask Luke", SHORTCUT_WORDS, "ask type composer summon"],
    },
    {
      label: "Stop Luke",
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: ["Stop Luke", SHORTCUT_WORDS, "stop interrupt quiet cut off a reply"],
    },
    // Every agent key row, whether or not a key is stored: the list is how
    // you learn which services Luke can watch at all, and so how you find one.
    ...CLOUD_AGENT_PROVIDER_LIST.map((provider) => ({
      label: provider.displayName,
      page: SETTINGS_VIEW.CONNECTIONS,
      haystack: [
        provider.displayName,
        KEY_WORDS,
        ...(provider.keyFormat ? [provider.keyFormat.label] : []),
      ],
    })),
    // The one provider observed through its own CLI's login rather than a key.
    {
      label: "Codex",
      page: SETTINGS_VIEW.CONNECTIONS,
      haystack: ["Codex", "cloud tasks CLI login connect"],
    },
    input.settings.linearSignInAvailable
      ? {
          label: "Linear",
          page: SETTINGS_VIEW.CONNECTIONS,
          haystack: ["Linear", "issues issue tracker sign in connect integration"],
        }
      : undefined,
    input.superset.installed
      ? {
          label: "Superset",
          page: SETTINGS_VIEW.CONNECTIONS,
          haystack: ["Superset", "workspaces sign in connect integration"],
        }
      : undefined,
    input.settings.calendarSignInAvailable
      ? {
          label: GOOGLE_CALENDAR_NAME,
          page: SETTINGS_VIEW.CONNECTIONS,
          haystack: [GOOGLE_CALENDAR_NAME, "meetings account sign in connect integration"],
        }
      : undefined,
    input.defaultProjectOffered
      ? {
          label: "Default project",
          page: SETTINGS_VIEW.CONNECTIONS,
          haystack: ["Default project", "workspace creation ask each time"],
        }
      : undefined,
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
  const guided = settingGuideEntries(input.settings).flatMap((setting): SettingsSearchEntry[] => {
    // The guide's ids are the schema's own; one that is not names no page.
    if (!isAppSettingId(setting.id)) return [];
    if (!settingRowDrawn(setting.id, input)) return [];
    return [
      {
        label: setting.label,
        page: SETTING_PAGE[setting.id],
        target: setting.id,
        haystack: [setting.label, setting.description],
      },
    ];
  });
  const fixed = fixedEntries(input);
  return PAGE_ORDER.flatMap((page) => [
    ...guided.filter((entry) => entry.page === page),
    ...fixed.filter((entry) => entry.page === page),
  ]).map((entry) => ({
    ...entry,
    haystack: [...entry.haystack, RESULT_PAGE_WORD[entry.page]],
  }));
}

/** What became of the query, reported so no narrowing is ever silent. */
export interface SettingsSearchOutcome {
  /** The query's words, lowercased — what each entry was actually read against. */
  tokens: readonly string[];
  /** The entries the query kept, in the corpus's own page order. */
  results: readonly SettingsSearchEntry[];
  /** How many entries the query was read against: everything offered. */
  searched: number;
}

/**
 * The query read over the corpus: every word must land somewhere in an
 * entry's haystack, on the same reading the session list gives a query, so
 * the two searches cannot disagree about what a word is. A blank query is no
 * search at all.
 */
export function searchSettings(
  entries: readonly SettingsSearchEntry[],
  query: string,
): SettingsSearchOutcome | undefined {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return undefined;
  const results = entries.filter((entry) => {
    const lines = entry.haystack.map((line) => line.toLowerCase());
    return tokens.every((token) => lines.some((line) => line.includes(token)));
  });
  return { tokens, results, searched: entries.length };
}

/**
 * Hands the keyboard to the control a pressed result named, waiting out the
 * page swap the press asked for — the same frame-by-frame seek the session
 * search field needs, because the control is not drawn until React has
 * answered. It lands after the page's own header focus on purpose: the result
 * named a row, so the row is where the keyboard belongs. A control the page
 * is not drawing — or a row whose control carries no mark — is given up on
 * quietly, leaving the keyboard on the page's own back button.
 */
export function focusSettingsControl(target: ErrandTarget): () => void {
  let frame = 0;
  let frames = 0;
  const take = () => {
    const element = document.querySelector(`[${ERRAND_TARGET_ATTRIBUTE}="${target}"]`);
    if (element instanceof HTMLElement && element.checkVisibility({ opacityProperty: true })) {
      element.focus();
      return;
    }
    if (frames++ > FOCUS_FRAME_LIMIT) return;
    frame = requestAnimationFrame(take);
  };
  take();
  return () => cancelAnimationFrame(frame);
}

/**
 * The search field: the sessions list's own pill, worn by class rather than
 * copied, standing at the head of the front page. It is always drawn there —
 * the front page is the index, and an index is where finding starts — so it
 * needs no button to open it and no closed state to return to. The count is
 * the pill's honesty about how far the query narrowed what the pages offer.
 *
 * Escape unwinds one layer at a time: a held query is cleared first, and only
 * an empty field lets go of the caret — both stopped here, so neither press
 * falls through and turns the tab under the field.
 */
export function SettingsSearch({
  query,
  search,
  onQueryChange,
  onEngagedChange,
}: {
  query: string;
  search?: SettingsSearchOutcome | undefined;
  onQueryChange: (query: string) => void;
  /**
   * Reports someone being part-way through a search, which holds the panel
   * open against the pointer wandering off — the same hold a half-typed ask
   * has, for the same reason: the caret is the signal that hands are here.
   */
  onEngagedChange: (engaged: boolean) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only by design — the keyboard already lands in the field by tabbing, and the click handler only places the caret.
    <search
      className="session-search settings-search"
      style={cssCustomProperties({ "--row-index": 0 })}
      // The whole pill is the field: a press on its padding or its count is
      // someone reaching for the caret, so the caret is what they get.
      onClick={() => field.current?.focus()}
    >
      <SearchIcon />
      <input
        ref={field}
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
          window.sidecar.focusPanel();
          onEngagedChange(true);
        }}
        onBlur={() => onEngagedChange(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (query.length > 0) onQueryChange("");
          else field.current?.blur();
        }}
      />
      {search ? (
        <span className="session-search-count" aria-live="polite">
          {search.results.length === 0
            ? "No matches"
            : `${search.results.length} of ${search.searched}`}
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
 * What a query left, one row per found setting: its name with the query's
 * words marked where they landed, and the page that holds it. The rows wear
 * the front page's own nav dress, because a result is a nav row with a
 * sharper destination. An emptied search says so rather than going blank —
 * there is no filter hiding matches here, so there is nothing to offer but
 * the words.
 */
export function SettingsSearchResults({
  search,
  onOpen,
}: {
  search: SettingsSearchOutcome;
  onOpen: (entry: SettingsSearchEntry) => void;
}): React.JSX.Element {
  if (search.results.length === 0) {
    return (
      <div className="empty-state" style={cssCustomProperties({ "--row-index": 1 })}>
        <strong>No settings match</strong>
      </div>
    );
  }
  return (
    <section
      className="settings-section settings-index"
      style={cssCustomProperties({ "--row-index": 1 })}
    >
      {search.results.map((entry) => (
        <button
          type="button"
          key={entry.label}
          className="settings-nav"
          onClick={() => onOpen(entry)}
        >
          <span className="settings-copy">
            <strong>
              <Highlighted text={entry.label} tokens={search.tokens} />
            </strong>
            <small>{RESULT_PAGE_WORD[entry.page]}</small>
          </span>
          <ChevronIcon />
        </button>
      ))}
    </section>
  );
}

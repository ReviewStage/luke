import { GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_NAME } from "@sidecar/calendar/vocabulary";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDER_ID,
  VOICE_CREDENTIAL_PROVIDER,
} from "@sidecar/credentials";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  PROVIDER_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProviderId,
  workspaceAgentModels,
} from "@sidecar/session";
import {
  APP_SETTING_ID,
  type AppSettingId,
  isAppSettingId,
  SETTING_PAGE,
  settingGuideEntries,
} from "@sidecar/settings";
import { Fragment, useRef } from "react";
import { APPLE_CALENDAR_ID, APPLE_CALENDAR_NAME } from "#shared/apple-calendar";
import { CREDENTIAL_SOURCE } from "#shared/wire/account";
import type { AppSettings } from "#shared/wire/settings";
import { VOICE_SOURCE } from "#shared/wire/settings";
import { FOCUS_FRAME_LIMIT } from "./credential-entry";
import { ERRAND_TARGET_ATTRIBUTE } from "./luke-errand";
import { ProviderMark } from "./provider-marks";
import { searchTokens } from "./session-model";
import { Highlighted } from "./session-search";
import {
  ChevronIcon,
  CloseIcon,
  DownloadIcon,
  LukeIcon,
  MegaphoneIcon,
  PlugIcon,
  PowerIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
} from "./settings-icons";
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
 * himself cannot drift apart — and the rows that are not settings (a
 * permission, a key, a shortcut, the ways out) are declared here, gated by
 * the same conditions that draw them. A row the pages are not drawing right
 * now is not offered, because a result that leads to a page without its row
 * is a promise the page cannot keep.
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

/**
 * How a row says a pressed result may land on it. The settings' own controls
 * already wear their errand marks, so the anchor exists for the rows that are
 * not settings — a credential line, a shortcut, a section's one row — and the
 * landing looks for either.
 */
export const SETTINGS_SEARCH_ANCHOR_ATTRIBUTE = "data-search-anchor";

/** What a row spreads onto itself to be somewhere a pressed result lands. */
export function searchAnchorProps(id: string) {
  return { [SETTINGS_SEARCH_ANCHOR_ATTRIBUTE]: id } satisfies Record<string, string>;
}

/**
 * The ids of the searchable rows that are not stored settings, shared with
 * the panel so the entry and the anchor its row wears cannot drift apart.
 * Rows that already have an id of their own — a provider's, the calendar's —
 * anchor by that id instead.
 */
export const SETTINGS_SEARCH_ROW = {
  UPDATES: "updates",
  CHANGELOG: "changelog",
  FEEDBACK: "feedback",
  SIGN_OUT: "sign-out",
  DELETE_ACCOUNT: "delete-account",
  QUIT: "quit",
  MICROPHONE: "microphone",
  TALK_KEY: "talk-key",
  ASK_KEY: "ask-key",
  STOP_KEY: "stop-key",
  CODEX_CLOUD: "codex-cloud",
} as const;

/**
 * Each provider's Default project row, by the provider it belongs to: several
 * providers draw one, so a shared id would land a press on whichever row
 * happens to stand first. A literal table rather than a composed string, and
 * deliberately only the providers that create workspaces today — a provider
 * it does not name draws its row unfound rather than mislanding a press, and
 * widening it is one line beside the capability that widened.
 */
const DEFAULT_PROJECT_ROW_ID = {
  [PROVIDER_ID.CONDUCTOR]: "default-project-conductor",
  [CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID]: "default-project-conductor-local",
  [PROVIDER_ID.CODEX]: "default-project-codex",
  [PROVIDER_ID.CURSOR]: "default-project-cursor",
  [SUPERSET_WORKSPACE_PROVIDER_ID]: "default-project-superset",
} as const satisfies Partial<Record<WorkspaceProviderId, string>>;

/** The anchor a provider's Default project row wears, if the table names it. */
export function defaultProjectRowId(providerId: WorkspaceProviderId): string | undefined {
  if (!Object.hasOwn(DEFAULT_PROJECT_ROW_ID, providerId)) return undefined;
  // SAFETY: hasOwn narrows the id to the table's own keys.
  return DEFAULT_PROJECT_ROW_ID[providerId as keyof typeof DEFAULT_PROJECT_ROW_ID];
}

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
  icon?: React.JSX.Element;
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
  /** The providers currently offering projects, each drawing a Default project row. */
  workspaceProjects: readonly { id: WorkspaceProviderId; name: string }[];
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
  // The quiet rides the calendar block, and appears with its first
  // connection — a Google account, or this Mac's own Calendar.
  [APP_SETTING_ID.QUIET_DURING_MEETINGS]: (input) =>
    (input.settings.calendarSignInAvailable && input.settings.calendarAccounts.length > 0) ||
    input.settings.appleCalendar !== undefined,
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

/**
 * The two front-page settings wear their sections' own glyphs, because the
 * headless front-page group has no head to carry one for them.
 */
const ROOT_SETTING_ICON = {
  [APP_SETTING_ID.VOICE_SOURCE]: <LukeIcon />,
  [APP_SETTING_ID.SHARE_USAGE_DATA]: <ShieldIcon />,
} satisfies Partial<Record<AppSettingId, React.JSX.Element>>;

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
          // The row is a provider credential's, so it anchors by provider id.
          id: VOICE_CREDENTIAL_PROVIDER.id,
          label: `${VOICE_CREDENTIAL_PROVIDER.displayName} API key`,
          page: SETTINGS_VIEW.ROOT,
          icon: <ProviderMark providerId={VOICE_CREDENTIAL_PROVIDER.id} />,
          haystack: [
            `${VOICE_CREDENTIAL_PROVIDER.displayName} API key`,
            "credential connect voice unmetered what luke runs on",
          ],
        }
      : undefined,
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
    // Every agent key row, whether or not a key is stored: the list is how
    // you learn which services Luke can watch at all, and so how you find one.
    ...CLOUD_AGENT_PROVIDER_LIST.map((provider) => ({
      id: provider.id,
      label: provider.displayName,
      page: SETTINGS_VIEW.CONNECTIONS,
      icon: <ProviderMark providerId={provider.id} />,
      haystack: [
        provider.displayName,
        KEY_WORDS,
        ...(provider.keyFormat ? [provider.keyFormat.label] : []),
      ],
    })),
    // The one provider observed through its own CLI's login rather than a key.
    {
      id: SETTINGS_SEARCH_ROW.CODEX_CLOUD,
      label: "Codex",
      page: SETTINGS_VIEW.CONNECTIONS,
      icon: <ProviderMark providerId={PROVIDER_ID.CODEX} />,
      haystack: ["Codex", "cloud tasks CLI login connect"],
    },
    input.settings.linearSignInAvailable
      ? {
          id: CREDENTIAL_PROVIDER_ID.LINEAR,
          label: "Linear",
          page: SETTINGS_VIEW.CONNECTIONS,
          icon: <ProviderMark providerId={CREDENTIAL_PROVIDER_ID.LINEAR} />,
          haystack: ["Linear", "issues issue tracker sign in connect integration"],
        }
      : undefined,
    input.superset.installed
      ? {
          id: SUPERSET_WORKSPACE_PROVIDER_ID,
          label: "Superset",
          page: SETTINGS_VIEW.CONNECTIONS,
          icon: <PlugIcon />,
          haystack: ["Superset", "workspaces sign in connect integration"],
        }
      : undefined,
    // Drawn only while local Conductor is actually detected — the block stands
    // on the same repositories its row offers, so it is searchable exactly when
    // it is on screen.
    input.workspaceProjects.some(
      (provider) => provider.id === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
    )
      ? {
          id: CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
          label: "Conductor (local)",
          page: SETTINGS_VIEW.CONNECTIONS,
          icon: <ProviderMark providerId={CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID} />,
          haystack: ["Conductor local", "workspaces create this Mac no key integration"],
        }
      : undefined,
    input.settings.appleCalendarAvailable
      ? {
          id: APPLE_CALENDAR_ID,
          label: APPLE_CALENDAR_NAME,
          page: SETTINGS_VIEW.CONNECTIONS,
          icon: <ProviderMark providerId={APPLE_CALENDAR_ID} />,
          haystack: [APPLE_CALENDAR_NAME, "meetings Mac calendar connect integration"],
        }
      : undefined,
    input.settings.calendarSignInAvailable
      ? {
          id: GOOGLE_CALENDAR_ID,
          label: GOOGLE_CALENDAR_NAME,
          page: SETTINGS_VIEW.CONNECTIONS,
          icon: <ProviderMark providerId={GOOGLE_CALENDAR_ID} />,
          haystack: [GOOGLE_CALENDAR_NAME, "meetings account sign in connect integration"],
        }
      : undefined,
    // One entry per provider drawing a Default project row, named for its
    // provider so the results can be told apart, each landing on its own row.
    ...input.workspaceProjects.flatMap((provider): SettingsSearchEntry[] => {
      const id = defaultProjectRowId(provider.id);
      if (!id) return [];
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
    const icon = Object.hasOwn(ROOT_SETTING_ICON, setting.id)
      ? // SAFETY: hasOwn narrows the id to the table's own keys.
        ROOT_SETTING_ICON[setting.id as keyof typeof ROOT_SETTING_ICON]
      : undefined;
    return [
      {
        id: setting.id,
        label: setting.label,
        page: SETTING_PAGE[setting.id],
        ...(icon ? { icon } : undefined),
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
  const kept = entries.filter((entry) => {
    const lines = entry.haystack.map((line) => line.toLowerCase());
    return tokens.every((token) => lines.some((line) => line.includes(token)));
  });
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
  let frame = 0;
  let frames = 0;
  const take = () => {
    const element =
      document.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${id}"]`) ??
      document.querySelector(`[${ERRAND_TARGET_ATTRIBUTE}="${id}"]`);
    if (element instanceof HTMLElement && element.checkVisibility({ opacityProperty: true })) {
      element.scrollIntoView({ block: "start" });
      if (element.matches(FOCUSABLE)) element.focus({ preventScroll: true });
      return;
    }
    if (frames++ > FOCUS_FRAME_LIMIT) return;
    frame = requestAnimationFrame(take);
  };
  take();
  return () => cancelAnimationFrame(frame);
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
            window.sidecar.focusPanel();
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

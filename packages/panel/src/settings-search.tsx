import { PRODUCT_SEARCH_SURFACE, PRODUCT_SURFACE_EVENT } from "@repo/features/analytics";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER_LIST } from "@repo/features/integration-wire";
import { noMatchWords, TERM } from "@repo/features/words";
import { managesWorkspace } from "@repo/features/workspace-role";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import {
  APP_SETTING_SCHEMA,
  describedSettings,
  EXPERIMENTS,
  HOST_CAPABILITY,
  type SettingsRowsInput,
  settingFieldForId,
  settingIdVisible,
} from "@repo/settings";
import {
  EXPERIMENT_ANCHOR,
  SETTINGS_SEARCH_ANCHOR_ATTRIBUTE,
  SETTINGS_SEARCH_ROW,
} from "@repo/settings/settings-anchors";
import {
  SETTINGS_PAGE_LIST,
  SETTINGS_SECTION,
  SETTINGS_VIEW,
  type SettingsView,
} from "@repo/settings/settings-views";
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
} from "@repo/settings/shortcuts";
import {
  commandKeyshortcuts,
  GAP,
  LAYOUT_ELEMENT,
  NAV_CURRENT,
  NavItem,
  NOTE_LINE_LOOK,
  NoteLine,
  ProviderMark,
  ROVING_ORIENTATION,
  rovingStep,
  SearchField,
  Shortcut,
  Stack,
  useComboboxField,
} from "@repo/ui";
import { integrationLines } from "@repo/ui/integration-search";
import { land } from "@repo/ui/landed";
import { searchHit } from "@repo/ui/search-score";
import { type MatchRange, searchTokens } from "@repo/ui/search-tokens";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useStateWithRef } from "@repo/ui/use-state-with-ref";
import { useEffect, useRef } from "react";
import { useAppCommand } from "./app-commands.js";
import { appPlatform } from "./app-platform.js";
import { coarsePointerNow } from "./coarse-pointer.js";
import { drawnVisibly, focusSeek } from "./focus-seek.js";
import { focusSearchField, Highlighted } from "./search-field.js";
import { settingsPageOf, WORKSPACE_CONNECTIONS } from "./settings/pages.js";
import { experimentPages, settingsPageShown } from "./settings/settings-rows.js";

const LEAVE_WORD = "Leave";

const SETTINGS_SEARCH_INPUT_ID = "settings-search-input";

export interface SettingsSearchEntry {
  id: string;
  label: string;
  replayMaskedFrom?: number;
  page: SettingsView;
  haystack: readonly string[];
}

export type SettingsSearchInput = SettingsRowsInput & {
  workspace?: Workspace | undefined;
};

export function resultPageWord(page: SettingsView): string {
  return settingsPageOf(page).title;
}

const SETTINGS_NO_MATCH_WORDS = `${noMatchWords(TERM.RESULT)}. Try a page's name, such as Appearance, or fewer words.`;

const INTEGRATION_WORDS = "connect disconnect integration";

const EXPERIMENT_WORDS = "experiment preview beta labs early try";

const WINDOW_SHORTCUT_WORDS = "keyboard shortcut key chord";

const ESCAPE_WORDS = "escape esc exit leave back";

const WRITING_WORDS = "format formatting markdown editor text";

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
    ...EXPERIMENTS.map((entry) =>
      input.accountDrawn
        ? {
            id: EXPERIMENT_ANCHOR[entry.key],
            label: entry.name,
            page: SETTINGS_VIEW.EXPERIMENTAL,
            haystack: [
              entry.name,
              entry.detail,
              ...experimentPages(entry.key).map(resultPageWord),
              EXPERIMENT_WORDS,
            ],
          }
        : undefined,
    ),
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
          id: SETTINGS_SEARCH_ROW.MCP_CLIENTS,
          label: "Connected agents",
          page: SETTINGS_VIEW.MCP,
          haystack: [
            "Connected agents",
            "mcp server clients oauth allowed agents with access revoke disconnect external outside",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.MCP_CONNECT,
          label: "Connect an agent",
          page: SETTINGS_VIEW.MCP,
          haystack: [
            "Connect an agent",
            "mcp server url address claude code codex cursor vs code chatgpt connector external outside",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.CLI_INSTALL,
          label: "Install the vespin command",
          page: SETTINGS_VIEW.CLI,
          haystack: [
            "Install the vespin command",
            "cli command-line tool terminal shell npm path reinstall",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.CLI_SIGN_IN,
          label: "Sign in from your terminal",
          page: SETTINGS_VIEW.CLI,
          haystack: [
            "Sign in from your terminal",
            "cli command-line tool vespin login sign out everywhere logout",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.DELETE_ACCOUNT,
          label: "Delete account",
          page: SETTINGS_VIEW.ACCOUNT,
          haystack: ["Delete account", "account erase remove"],
        }
      : undefined,
    input.capabilities.includes(HOST_CAPABILITY.MICROPHONE)
      ? {
          id: SETTINGS_SEARCH_ROW.MICROPHONE,
          label: "Microphone",
          page: SETTINGS_VIEW.THIS_MAC,
          haystack: [
            "Microphone",
            "permission access allow privacy system settings dictation dictate",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.MEMORY,
          label: "Memory",
          page: SETTINGS_VIEW.MEMORY,
          haystack: ["Memory", "remember recall forget facts conventions shared memory"],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.AGENT_MODEL,
          label: "Default model",
          page: SETTINGS_VIEW.AGENTS,
          haystack: ["Default model", "model agent claude gpt start"],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.AGENT_EFFORT,
          label: "Effort",
          page: SETTINGS_VIEW.AGENTS,
          haystack: ["Effort", "default effort agent reasoning low medium high max"],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.AGENT_FAST,
          label: "Fast",
          page: SETTINGS_VIEW.AGENTS,
          haystack: ["Fast", "agent fast version speed quick model"],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.API_KEY_ANTHROPIC,
          label: "Claude",
          page: SETTINGS_VIEW.AGENTS,
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
          page: SETTINGS_VIEW.AGENTS,
          haystack: [
            "Codex",
            "openai api key byok own key gpt chatgpt plan subscription billing provider credential dictation dictate",
          ],
        }
      : undefined,
    input.accountDrawn
      ? {
          id: SETTINGS_SEARCH_ROW.ADD_HOSTS,
          label: "Add hosts",
          page: SETTINGS_VIEW.HOSTS,
          haystack: ["Add hosts", "machine host server linux mac install vespin-host"],
        }
      : undefined,
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
          label: `${LEAVE_WORD} ${input.workspace.name}`,
          replayMaskedFrom: LEAVE_WORD.length + 1,
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
            "integrations GitHub repositories connect choose manage disconnect organization",
          ],
        }
      : undefined,
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
    input.workspace?.role === WORKSPACE_ROLE.OWNER
      ? {
          id: SETTINGS_SEARCH_ROW.WORKSPACE_SLUG,
          label: "Workspace link",
          page: SETTINGS_VIEW.WORKSPACE,
          haystack: ["Workspace link", "Change slug link address url workspace"],
        }
      : undefined,
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
    ...WRITING_KEYS_IN_CONTEXT.filter((key) => inContextShown(key, input.capabilities)).map((key) =>
      inContextEntry(key, WRITING_GROUP_TITLE),
    ),
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
    ...CHAPTERS_KEYS.map((key) => ({
      id: key,
      label: CHAPTERS_SHORTCUTS[key].label,
      page: SETTINGS_VIEW.SHORTCUTS,
      haystack: [CHAPTERS_SHORTCUTS[key].label, WINDOW_SHORTCUT_WORDS, CHAPTERS_GROUP_TITLE],
    })),
  ];
  return entries.filter((entry): entry is SettingsSearchEntry => entry !== undefined);
}

export function settingsSearchEntries(input: SettingsSearchInput): readonly SettingsSearchEntry[] {
  const described = describedSettings(input.settings).flatMap((setting): SettingsSearchEntry[] => {
    const field = settingFieldForId(setting.id);
    if (!field) return [];
    if (!settingIdVisible(setting.id, input)) return [];
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

export interface SettingsSearchCorpus {
  pages: readonly SettingsView[];
  entries: readonly SettingsSearchEntry[];
}

export function settingsSearchCorpus(input: SettingsSearchInput): SettingsSearchCorpus {
  return {
    pages: SETTINGS_PAGE_LIST.filter((page) =>
      settingsPageShown(page, input.capabilities, input.settings.experiments),
    ),
    entries: settingsSearchEntries(input),
  };
}

export interface SettingsSearchResult extends SettingsSearchEntry {
  marks: readonly MatchRange[];
}

interface SettingsSearchGroup {
  page: SettingsView;
  marks: readonly MatchRange[] | undefined;
  items: readonly SettingsSearchResult[];
}

export interface SettingsSearchOutcome {
  groups: readonly SettingsSearchGroup[];
  matched: number;
}

export function searchSettings(
  corpus: SettingsSearchCorpus,
  query: string,
): SettingsSearchOutcome | undefined {
  if (searchTokens(query).length === 0) return undefined;
  const kept = corpus.entries.flatMap((entry): { entry: SettingsSearchResult; score: number }[] => {
    const hit = searchHit({ label: entry.label, keywords: entry.haystack }, query);
    return hit === undefined ? [] : [{ entry: { ...entry, marks: hit.label }, score: hit.score }];
  });
  const scored = corpus.pages.flatMap((page): { group: SettingsSearchGroup; score: number }[] => {
    const named = searchHit({ label: resultPageWord(page) }, query);
    const held = kept.filter(({ entry }) => entry.page === page).sort((a, b) => b.score - a.score);
    const score = Math.max(named?.score ?? -Infinity, held[0]?.score ?? -Infinity);
    if (score === -Infinity) return [];
    const group = { page, marks: named?.label, items: held.map(({ entry }) => entry) };
    return [{ group, score }];
  });
  const groups = scored.sort((a, b) => b.score - a.score).map(({ group }) => group);
  const pagesNamed = groups.filter((group) => group.marks !== undefined).length;
  return { groups, matched: kept.length + pagesNamed };
}

export interface SettingsSearchStop {
  page: SettingsView;
  entry?: SettingsSearchResult | undefined;
}

export function settingsSearchStops(search: SettingsSearchOutcome): readonly SettingsSearchStop[] {
  return search.groups.flatMap((group) => [
    { page: group.page },
    ...group.items.map((entry) => ({ page: group.page, entry })),
  ]);
}

export function bestSettingsStop(search: SettingsSearchOutcome): number {
  const first = search.groups[0];
  return first === undefined || first.marks !== undefined || first.items.length === 0 ? 0 : 1;
}

const FOCUSABLE = "button, select, input, textarea, [tabindex]";

export function landOnSettingsRow(id: string, keyboard = true): () => void {
  return focusSeek({
    find: () =>
      document.querySelector<HTMLElement>(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${id}"]`),
    ready: drawnVisibly,
    act: (element) => {
      element.scrollIntoView({ block: "start" });
      if (keyboard && element.matches(FOCUSABLE)) element.focus({ preventScroll: true });
      land(element);
    },
  });
}

export interface SettingsSearchSteering {
  count: number;
  active: number;
  listId: string;
  activeId: string | undefined;
  onStep: (index: number) => void;
  onChoose: (index: number) => void;
}

export function SettingsSearchField({
  query,
  onQueryChange,
  results,
  find = true,
  onFind,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  results: SettingsSearchSteering;
  find?: boolean;
  onFind?: (() => void) | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const [placed, setPlaced, placedNow] = useStateWithRef(false);
  useAppCommand(
    APP_COMMAND.FIND,
    find
      ? () => {
          setPlaced(false);
          if (onFind === undefined) focusSearchField(SETTINGS_SEARCH_INPUT_ID);
          else {
            onFind();
            focusSearchField(
              SETTINGS_SEARCH_INPUT_ID,
              (field) => field.closest("[hidden]") === null,
            );
          }
        }
      : undefined,
  );
  useEffect(() => {
    if (coarsePointerNow()) return undefined;
    return focusSeek({
      find: () => field.current,
      act: (input) => {
        const held = document.activeElement;
        if (held !== null && held !== document.body) return;
        setPlaced(true);
        input.focus({ preventScroll: true });
      },
    });
  }, [setPlaced]);
  const untouched = placed && query.length === 0;
  const steering = useComboboxField({
    open: results.count > 0,
    active: results.active,
    count: results.count,
    controls: results.listId,
    activeId: results.activeId,
    onActiveChange: results.onStep,
    onChoose: results.onChoose,
    onEscape: () => onQueryChange(""),
    onKey: (event) => {
      if (event.key === "Tab" && results.count > 0) {
        if (event.metaKey || event.altKey || event.ctrlKey) return;
        event.preventDefault();
        const toward = event.shiftKey ? "ArrowUp" : "ArrowDown";
        const to = rovingStep(toward, ROVING_ORIENTATION.VERTICAL, results.active, results.count);
        if (to !== undefined) results.onStep(to);
        return;
      }
      if (event.key !== "Escape" || untouched) return;
      event.stopPropagation();
      if (query.length > 0) onQueryChange("");
      else field.current?.blur();
    },
  });
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
        combobox={steering}
      />
    </search>
  );
}

function rangesWithin(ranges: readonly MatchRange[], from: number, to: number): MatchRange[] {
  return ranges
    .filter((range) => range.end > from && range.start < to)
    .map((range) => ({
      start: Math.max(range.start, from) - from,
      end: Math.min(range.end, to) - from,
    }));
}

function ResultLabel({ entry }: { entry: SettingsSearchResult }): React.JSX.Element {
  const from = entry.replayMaskedFrom;
  if (from === undefined) return <Highlighted text={entry.label} ranges={entry.marks} />;
  const end = entry.label.length;
  return (
    <>
      <Highlighted text={entry.label.slice(0, from)} ranges={rangesWithin(entry.marks, 0, from)} />
      <ReplayMask>
        <Highlighted text={entry.label.slice(from)} ranges={rangesWithin(entry.marks, from, end)} />
      </ReplayMask>
    </>
  );
}

function resultIcon(entry: SettingsSearchResult): React.JSX.Element | undefined {
  if (entry.page !== SETTINGS_VIEW.INTEGRATIONS) return undefined;
  const provider = INTEGRATION_PROVIDER_LIST.find((each) => each === entry.id);
  return provider === undefined ? undefined : <ProviderMark provider={provider} />;
}

export function settingsSearchStopId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

export function SettingsSearchResults({
  search,
  listId,
  active,
  shown,
  onOpen,
}: {
  search: SettingsSearchOutcome;
  listId: string;
  active: number;
  shown: SettingsView;
  onOpen: (index: number) => void;
}): React.JSX.Element {
  if (search.matched === 0) {
    return (
      <NoteLine look={NOTE_LINE_LOOK.ROWS} status>
        {SETTINGS_NO_MATCH_WORDS}
      </NoteLine>
    );
  }
  let at = -1;
  const stop = (page: SettingsView) => {
    at += 1;
    const index = at;
    return {
      id: settingsSearchStopId(listId, index),
      current: index === active && page === shown ? NAV_CURRENT.LOCATION : undefined,
      roving: true,
      onClick: () => onOpen(index),
    };
  };
  return (
    <div id={listId} className="settings-search-results flex flex-col gap-tight-gap">
      {search.groups.map((group) => {
        const page = settingsPageOf(group.page);
        return (
          <section key={group.page} aria-label={resultPageWord(group.page)}>
            <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW}>
              <li>
                <NavItem icon={page.icon} {...stop(group.page)}>
                  <Highlighted text={page.title} ranges={group.marks ?? []} />
                </NavItem>
              </li>
              {group.items.map((entry) => (
                <li key={entry.id}>
                  <NavItem nested icon={resultIcon(entry)} {...stop(group.page)}>
                    <ResultLabel entry={entry} />
                  </NavItem>
                </li>
              ))}
            </Stack>
          </section>
        );
      })}
    </div>
  );
}

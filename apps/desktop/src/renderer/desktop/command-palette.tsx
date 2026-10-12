/**
 * command-palette.tsx -- ⌘K: the plans, the open plan's agents, every command the window can run now, and the settings, found by typing, in a dialog over the window.
 *
 * The palette is cmdk's own dialog, list, and keys, drawn in the window's
 * menu rows, under a row of filters as Cursor's palette has them: All, then
 * one kind each. All lists each kind's best few rows under its heading, and
 * a filter that kind's alone, as many as are worth reading; ⌘[ and ⌘]
 * step through the filters while the palette stands, where they mean Back
 * and Forward elsewhere, and a press on a filter chooses it. The palette
 * ranks the rows itself with cmdk's own scoring, so each kind keeps its own
 * best few however many rows the others hold.
 *
 * It decides nothing about a command: it lists the commands whose control is
 * on screen and able right now (`app-commands.ts`), so a row runs exactly
 * what its shortcut would, Delete plan's question included, and it opens a
 * plan through the same select the sidebar does, which takes its ask back
 * when the host does not open the plan. Each plan names its repository
 * beside it, so two plans of one name can be told apart, and an archived
 * plan says so. An agent opens its tab as the column's "+" would, a subagent
 * its tab as the side panel's "+" would, and a setting lands on its row as
 * the settings search does.
 *
 * It is the nearest layer while it stands: no key pressed in it goes on to
 * the window, so Escape closes the palette and nothing else, a call's reply
 * included, and no chord changes what stands behind it. Closing hands focus
 * back to whatever had it, and only then runs what was chosen, so a command
 * acts from where the developer was, as its shortcut would have.
 *
 * Every row's value is its place in the list, never words: cmdk writes it
 * into an attribute, which the session recording does not mask
 * (`session-replay.ts`), and two plans may share a name. The search reads
 * each row's words instead.
 */

import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { ArchiveIcon, DocumentIcon, GearIcon, SearchIcon } from "@sidecar/panel";
import type { SettingsRowsInput } from "@sidecar/settings";
import { Command, defaultFilter } from "cmdk";
import { useEffect, useRef, useState } from "react";
import {
  APP_COMMAND,
  APP_SHORTCUT_GROUPS,
  APP_SHORTCUTS,
  type AppCommand,
  appCommandLabel,
  commandForKey,
  isKeyedCommand,
  type KeyedCommand,
  shortcutGlyphs,
} from "#shared/shortcuts";
import { appCommandOffered, runAppCommand, useAppCommand } from "../app-commands";
import { Keycaps } from "../keycaps";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import type { PlansControl } from "../planning/use-plans-tab";
import { workRowsOf } from "../planning/work-model";
import { Highlighted } from "../search-field";
import { matchesTokens, searchTokens } from "../search-tokens";
import { landOnSettingsRow, RESULT_PAGE_WORD, settingsSearchEntries } from "../settings-search";
import type { SettingsView } from "../settings-views";
import { agentEntries } from "./main-tabs";
import { panelEntries, planWorkers } from "./side-panel";

/** The kinds of row the palette lists, each a filter of its own after All, in the order the chips stand. */
const PALETTE_FILTER = {
  ALL: "all",
  PLANS: "plans",
  AGENTS: "agents",
  ACTIONS: "actions",
  SETTINGS: "settings",
} as const;

type PaletteFilter = (typeof PALETTE_FILTER)[keyof typeof PALETTE_FILTER];

/** A kind of row, which every filter but All is. */
type PaletteKind = Exclude<PaletteFilter, typeof PALETTE_FILTER.ALL>;

const PALETTE_FILTERS: readonly PaletteFilter[] = Object.values(PALETTE_FILTER);

/** Each filter's chip, which is also each kind's heading under All. */
const FILTER_LABEL = {
  [PALETTE_FILTER.ALL]: "All",
  [PALETTE_FILTER.PLANS]: "Plans",
  [PALETTE_FILTER.AGENTS]: "Agents",
  [PALETTE_FILTER.ACTIONS]: "Actions",
  [PALETTE_FILTER.SETTINGS]: "Settings",
} as const satisfies Record<PaletteFilter, string>;

/** What the search field asks for under each filter. */
const FILTER_PLACEHOLDER = {
  [PALETTE_FILTER.ALL]: "Search plans, agents, actions, and settings…",
  [PALETTE_FILTER.PLANS]: "Search plans…",
  [PALETTE_FILTER.AGENTS]: "Search agents…",
  [PALETTE_FILTER.ACTIONS]: "Search actions…",
  [PALETTE_FILTER.SETTINGS]: "Search settings…",
} as const satisfies Record<PaletteFilter, string>;

/** How many rows a kind lists: its best few under All, and as many as are worth reading under its own filter. */
const KIND_ROWS = {
  ALL: 5,
  FILTERED: 50,
} as const;

/** The first row's value: rows are valued by their place in the list, from one. */
const FIRST_ROW = "1";

/** The footer's hints, each the chords drawn as keys and what they do. */
const FOOTER_HINTS: readonly { chords: readonly (readonly string[])[]; label: string }[] = [
  { chords: [["↑"], ["↓"]], label: "Select" },
  { chords: [["↩"]], label: "Open" },
  {
    chords: [
      shortcutGlyphs(APP_SHORTCUTS[APP_COMMAND.BACK].chord),
      shortcutGlyphs(APP_SHORTCUTS[APP_COMMAND.FORWARD].chord),
    ],
    label: "Change filter",
  },
  { chords: [["Esc"]], label: "Close" },
];

/** The commands the palette lists: the Keyboard shortcuts page's, then the menu bar's own dialogs. */
const PALETTE_COMMANDS: readonly AppCommand[] = [
  ...APP_SHORTCUT_GROUPS.flatMap((group) => group.commands),
  APP_COMMAND.SEND_FEEDBACK,
  APP_COMMAND.SUGGEST_FEATURE,
];

/** One row as the palette draws it, the words its search reads, and what choosing it does. */
interface PaletteRow {
  icon?: React.ReactNode;
  label: string;
  /** Muted words after the name: a plan's repository, an agent's plan, a setting's page. */
  detail?: string | undefined;
  /** The chord an action's row draws as keys. */
  command?: KeyedCommand | undefined;
  /** The short words the search scores, the name first. */
  terms: readonly string[];
  /** Longer words the row is found by as the settings search finds it, every word of the query somewhere in them. */
  keywords?: readonly string[] | undefined;
  onChoose: () => void;
}

/** One kind's rows, ranked and cut to what the filter lists. */
interface PaletteSection {
  kind: PaletteKind;
  rows: readonly PaletteRow[];
}

/** The score a row found only by its keywords takes: after every row its own words matched. */
const KEYWORD_SCORE = Number.MIN_VALUE;

/**
 * The least of cmdk's scores the palette counts as a match. An abbreviation
 * of a row's words ("tgsb" for Toggle sidebar) scores above it, and letters
 * scattered through unrelated words ("palette" in Permanently delete plan)
 * a tenth of it.
 */
const LEAST_SCORE = 0.01;

/** cmdk's own score of the words for the query, nothing under the least the palette counts. */
function fuzzyScore(words: string, query: string): number {
  const score = defaultFilter(words, query);
  return score < LEAST_SCORE ? 0 : score;
}

/**
 * How well a row answers the query: cmdk's own score over its short words,
 * else the least score where every word of the query is in its keywords.
 * Note that the keywords are not scored by cmdk, because its scoring is
 * fuzzy and a setting's description is long enough to hold almost any
 * letters in order.
 */
function rowScore(row: PaletteRow, query: string, tokens: readonly string[]): number {
  const score = fuzzyScore(row.terms.join(" "), query);
  if (score > 0 || row.keywords === undefined) return score;
  return matchesTokens(row.keywords, tokens) ? KEYWORD_SCORE : 0;
}

/**
 * The rows that match the query, best first, as many as `limit`, ties left
 * in the order given. A blank query matches every row in that order.
 */
function ranked(rows: readonly PaletteRow[], query: string, limit: number): readonly PaletteRow[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return rows.slice(0, limit);
  return rows
    .map((row) => ({ row, score: rowScore(row, query, tokens) }))
    .filter((each) => each.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map((each) => each.row);
}

/** The filter `step` places from the one given, wrapping at either end. */
function steppedFilter(filter: PaletteFilter, step: number): PaletteFilter {
  const at = PALETTE_FILTERS.indexOf(filter);
  const count = PALETTE_FILTERS.length;
  return PALETTE_FILTERS[(at + step + count) % count] ?? PALETTE_FILTER.ALL;
}

/** A plan's muted words: its repository, and whether it is archived. */
function planDetail(plan: PlanSummary, archived: boolean): string | undefined {
  const words = [plan.repository, archived ? "Archived" : null].filter((word) => word !== null);
  return words.length === 0 ? undefined : words.join(" · ");
}

/** Every plan, the sidebar's first in its order, then the archived ones. */
function planRows(plans: PlansControl, open: (planId: string) => void): readonly PaletteRow[] {
  const row = (plan: PlanSummary, archived: boolean): PaletteRow => ({
    icon: archived ? <ArchiveIcon /> : <DocumentIcon />,
    label: plan.name,
    detail: planDetail(plan, archived),
    terms: plan.repository === null ? [plan.name] : [plan.name, plan.repository],
    onChoose: () => open(plan.id),
  });
  return [
    ...plans.plans.map((plan) => row(plan, false)),
    ...plans.archived.map((plan) => row(plan, true)),
  ];
}

/**
 * The open plan's coding agents, as the column's "+" lists them, then its
 * subagents, as the side panel's "+" lists them, each beside the plan's
 * name; none while no plan is open. An agent opens as its notification's
 * click opens it, and a subagent's tab as the "+" opens it, the version
 * history giving way to either, so neither opens behind what covers it.
 */
function agentRows(plans: PlansControl, show: (pick: () => void) => void): readonly PaletteRow[] {
  const planId = plans.activePlanId;
  if (planId === undefined) return [];
  const planName = [...plans.plans, ...plans.archived].find((plan) => plan.id === planId)?.name;
  const workers = planWorkers(plans.work.turns, workRowsOf(plans.work.turns, plans.work.callLive));
  const agents = agentEntries(plans.mainTabs, plans.agents, true).map(({ row }) => ({
    row,
    onPick: () => plans.onShowAgent(planId, row.id),
  }));
  const subagents = panelEntries({
    panel: plans.sidePanel,
    kinds: [],
    workers,
    files: [],
    standing: true,
  }).map(({ row, onPick }) => ({
    row,
    onPick: () => {
      if (plans.history.open) plans.history.onClose();
      onPick();
    },
  }));
  const entries = [...agents, ...subagents];
  return entries.map(({ row, onPick }) => ({
    icon: row.icon,
    label: row.label,
    detail: planName,
    terms: planName === undefined ? [row.label] : [row.label, planName],
    onChoose: () => show(onPick),
  }));
}

/** The commands offered now, the palette's own left out, each with its chord. */
function actionRows(run: (command: AppCommand) => void): readonly PaletteRow[] {
  return PALETTE_COMMANDS.filter(
    (command) => command !== APP_COMMAND.COMMAND_PALETTE && appCommandOffered(command),
  ).map((command) => ({
    label: appCommandLabel(command),
    command: isKeyedCommand(command) ? command : undefined,
    terms: [appCommandLabel(command)],
    onChoose: () => run(command),
  }));
}

/** Every settings row the pages draw now, as the settings search finds them, beside its page's name. */
function settingRows(
  rows: SettingsRowsInput | undefined,
  land: (page: SettingsView, id: string) => void,
): readonly PaletteRow[] {
  if (rows === undefined) return [];
  return settingsSearchEntries(rows).map((entry) => ({
    icon: <GearIcon />,
    label: entry.label,
    detail: RESULT_PAGE_WORD[entry.page],
    terms: [entry.label],
    keywords: entry.haystack,
    onChoose: () => land(entry.page, entry.id),
  }));
}

function PaletteItem({
  row,
  value,
  tokens,
}: {
  row: PaletteRow;
  value: string;
  tokens: readonly string[];
}): React.JSX.Element {
  return (
    <Command.Item className="command-palette-row" value={value} onSelect={row.onChoose}>
      {row.icon === undefined ? null : <span className="command-palette-icon">{row.icon}</span>}
      <span className="command-palette-name">
        <Highlighted text={row.label} tokens={tokens} />
      </span>
      {row.detail === undefined ? null : (
        <span className="command-palette-detail">
          <Highlighted text={row.detail} tokens={tokens} />
        </span>
      )}
      {row.command === undefined ? null : (
        <span className="command-palette-hint">
          <Keycaps caps={shortcutGlyphs(APP_SHORTCUTS[row.command].chord)} />
        </span>
      )}
    </Command.Item>
  );
}

/** The filters under the field; a press chooses one and leaves the caret in the field. */
function FilterChips({
  filter,
  onFilter,
}: {
  filter: PaletteFilter;
  onFilter: (filter: PaletteFilter) => void;
}): React.JSX.Element {
  return (
    <fieldset className="command-palette-filters" aria-label="Filter">
      {PALETTE_FILTERS.map((each) => (
        <button
          key={each}
          type="button"
          className="command-palette-filter"
          aria-pressed={each === filter}
          // Note that a chip takes no focus, because the caret belongs in the
          // field and Return there opens the row chosen, not the chip.
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFilter(each)}
        >
          {FILTER_LABEL[each]}
        </button>
      ))}
    </fieldset>
  );
}

function PaletteFooter(): React.JSX.Element {
  return (
    <div className="command-palette-footer" aria-hidden="true">
      {FOOTER_HINTS.map((hint) => (
        <span key={hint.label} className="command-palette-footer-hint">
          {hint.chords.map((caps) => (
            <Keycaps key={caps.at(-1)} caps={caps} />
          ))}
          {hint.label}
        </span>
      ))}
    </div>
  );
}

/**
 * The palette, offering ⌘K while `available`: past the sign-in, where there
 * is something to run. A palette standing when that ends is taken down in
 * the render that finds it gone. It opens on All with nothing typed.
 */
export function CommandPalette({
  available,
  tab,
  onTabChange,
  plans,
  settings,
}: {
  available: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  plans: PlansControl;
  /** What the settings pages draw now, which the Settings rows are; the page a row lands on is shown through `onViewChange`. */
  settings: {
    rows: SettingsRowsInput | undefined;
    onViewChange: (view: SettingsView) => void;
  };
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (open && !available) setOpen(false);
  const [filter, setFilter] = useState<PaletteFilter>(PALETTE_FILTER.ALL);
  const [query, setQuery] = useState("");
  // The row chosen, by its place in the list, which a new filter puts back on the first.
  const [selected, setSelected] = useState(FIRST_ROW);
  const changeFilter = (next: PaletteFilter) => {
    setFilter(next);
    setSelected(FIRST_ROW);
  };
  const invoker = useRef<HTMLElement | null>(null);
  const chosen = useRef<(() => void) | undefined>(undefined);
  const shown = useRef(false);

  useAppCommand(
    APP_COMMAND.COMMAND_PALETTE,
    available
      ? () => {
          invoker.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          changeFilter(PALETTE_FILTER.ALL);
          setQuery("");
          setOpen(true);
        }
      : undefined,
  );

  // Note that what was chosen runs once the palette is gone and focus is
  // back where it was, because a command that moves focus (Delete's
  // question, the new-plan field) would otherwise lose it to the palette's
  // own going.
  useEffect(() => {
    if (open) {
      shown.current = true;
      return;
    }
    if (!shown.current) return;
    shown.current = false;
    if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
    const run = chosen.current;
    chosen.current = undefined;
    run?.();
  }, [open]);

  const choose = (run: () => void) => {
    chosen.current = run;
    setOpen(false);
  };
  // A plan, and an agent's tab, are always opened on the Plans tab, as a
  // press in the sidebar is.
  const onPlans = (run: () => void) =>
    choose(() => {
      if (tab !== PANEL_TAB.PLANS) onTabChange(PANEL_TAB.PLANS);
      run();
    });
  // The seek for a setting's row gives itself up once another is asked
  // for or Settings is left, so it never lands on a later visit's page.
  const landing = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (tab !== PANEL_TAB.SETTINGS) landing.current?.();
  }, [tab]);
  useEffect(() => () => landing.current?.(), []);
  const land = (page: SettingsView, id: string) =>
    choose(() => {
      onTabChange(PANEL_TAB.SETTINGS);
      settings.onViewChange(page);
      landing.current?.();
      landing.current = landOnSettingsRow(id);
    });

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that no key pressed in the palette goes on to the window, because
    // the window's Escape would stop Luke mid-reply and a window chord would
    // change what stands behind the palette. Escape itself is the dialog's,
    // which closes the palette alone.
    event.stopPropagation();
    const pressed = commandForKey(
      [APP_COMMAND.COMMAND_PALETTE, APP_COMMAND.BACK, APP_COMMAND.FORWARD],
      event.nativeEvent,
    );
    if (pressed === undefined) return;
    // The menu bar's Back and Forward are held off too, since the palette
    // claims their chords for its filters while it stands.
    event.preventDefault();
    if (pressed === APP_COMMAND.COMMAND_PALETTE) setOpen(false);
    else changeFilter(steppedFilter(filter, pressed === APP_COMMAND.BACK ? -1 : 1));
  };

  // Each kind's rows, built only for the filter shown and only while open.
  const sourceOf = {
    [PALETTE_FILTER.PLANS]: () =>
      plans.signedIn ? planRows(plans, (planId) => onPlans(() => plans.onSelect(planId))) : [],
    [PALETTE_FILTER.AGENTS]: () => agentRows(plans, onPlans),
    [PALETTE_FILTER.ACTIONS]: () => actionRows((command) => choose(() => runAppCommand(command))),
    [PALETTE_FILTER.SETTINGS]: () => settingRows(settings.rows, land),
  } as const satisfies Record<PaletteKind, () => readonly PaletteRow[]>;
  const kinds = PALETTE_FILTERS.filter((each): each is PaletteKind =>
    filter === PALETTE_FILTER.ALL ? each !== PALETTE_FILTER.ALL : each === filter,
  );
  const limit = filter === PALETTE_FILTER.ALL ? KIND_ROWS.ALL : KIND_ROWS.FILTERED;
  const sections: readonly PaletteSection[] = open
    ? kinds
        .map((kind) => ({ kind, rows: ranked(sourceOf[kind](), query, limit) }))
        .filter((section) => section.rows.length > 0)
    : [];
  const tokens = searchTokens(query);
  let place = 0;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      loop
      overlayClassName="command-palette-backdrop"
      contentClassName="command-palette"
      onKeyDown={keyDown}
    >
      <div className="command-palette-search">
        <SearchIcon />
        <Command.Input
          placeholder={FILTER_PLACEHOLDER[filter]}
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <FilterChips filter={filter} onFilter={changeFilter} />
      <Command.List className="command-palette-list" label="Results">
        <Command.Empty className="command-palette-empty">Nothing matches.</Command.Empty>
        {sections.map((section) => (
          <Command.Group key={section.kind} heading={FILTER_LABEL[section.kind]}>
            {section.rows.map((row) => {
              place += 1;
              return <PaletteItem key={place} row={row} value={String(place)} tokens={tokens} />;
            })}
          </Command.Group>
        ))}
      </Command.List>
      <PaletteFooter />
    </Command.Dialog>
  );
}

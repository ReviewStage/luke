/**
 * tab-strip-model.ts -- what a tab of the window's two strips is, and how a strip orders, remembers, and replaces its tabs, as an editor's does.
 *
 * The plan's column and the side panel each hold a strip of tabs over the
 * open plan (the desktop's `planning/use-main-tabs.ts` and
 * `planning/use-side-panel.ts`). A tab is either a word
 * its column names it by, such as the plan's own or the side panel's Board,
 * or an object naming what it shows: one coding agent, a draft agent not yet
 * started, one subagent, one file, one agent's changes, one agent's
 * terminal, or one page. Two tabs are the
 * same where they name the same thing, so a tab rebuilt on every render is
 * still the tab it was.
 *
 * Each strip keeps, per plan, the order the developer moved its tabs into
 * and the tabs they viewed, the latest last. What follows is how both
 * strips read and change those two lists alike: a tab the order does not
 * hold stands after those it does, in its kind's place (`inTaskOrder`); a
 * tab opened goes to the strip's end (`openedOrder`); a move takes the tab
 * out and puts it back before the tab standing at its new place
 * (`movedOrder`); and closing the chosen tab chooses the one viewed before
 * it that still stands, and only where none does its neighbour
 * (`replacementOf`), as a browser's tabs do.
 */

/**
 * What each kind of tab whose name is not its subject's is called, wherever
 * it is named (the desktop's `planning/tab-look.tsx`): the plan's Inbox, a
 * draft agent's tab and the "+" row that opens one, an agent the window holds
 * nothing of, and an agent's Changes before its agent is read. The side panel's fixed kinds
 * are named beside their glyphs (`SIDE_PANEL_TAB_KIND`).
 */
export const TAB_WORDS = {
  INBOX: "Inbox",
  NEW_AGENT: "New coding agent",
  CODING_AGENT: "Coding agent",
  CHANGES: "Changes",
  TERMINAL: "Terminal",
} as const;

/** A pull request run tab's name: the word for what it shows, and the pull request's number. */
export function prRunLabelOf(number: number): string {
  return `Run #${number}`;
}

/** A Changes tab's name for its agent's: the agent's own, after the word for what it shows. */
export function changesLabelOf(agentLabel: string): string {
  return `${TAB_WORDS.CHANGES}: ${agentLabel}`;
}

/** One coding agent's tab, named by the agent it shows. */
export interface AgentStripTab {
  readonly agent: string;
}

/** The tab of an agent not yet started, named by the key its first message will start it under. */
export interface DraftStripTab {
  readonly draft: string;
}

/** A worker one of the plan's agents delegated to, as its tab carries it: the agent, and the task it handed over, which the tab names itself by. */
interface SubagentDelegation {
  readonly agent: string;
  readonly task: string;
}

/** One subagent's tab, named by the call that started it: on the open plan's work, or, with the delegation, on one of its agents' turns. */
export interface SubagentStripTab {
  readonly subagent: string;
  /** Absent for the planning worker, whose session the plan's work holds. */
  readonly delegation?: SubagentDelegation;
}

/** One file's tab, named by the file's path in the open plan's repository. */
export interface FileStripTab {
  readonly file: string;
}

/** One agent's Changes tab, named by the agent whose changes it shows. */
export interface ChangesStripTab {
  readonly changes: string;
}

/** One agent's Terminal tab, named by the agent in whose sandbox its shells run. */
export interface TerminalStripTab {
  readonly terminal: string;
}

/** One page's tab, named by the page an agent wrote for the plan. */
export interface PageStripTab {
  readonly page: string;
}

/**
 * One agent's pull request run on this Mac, named by the agent that
 * published the pull request, with the pull request it runs: its
 * workspace, repository, and number.
 */
export interface PrRunStripTab {
  readonly prRun: string;
  readonly pullRequest: {
    readonly workspaceId: string;
    readonly repository: string;
    readonly number: number;
  };
}

/** A tab of either strip: a word of its column's own, or one naming what it shows. */
export type StripTab =
  | string
  | AgentStripTab
  | DraftStripTab
  | SubagentStripTab
  | FileStripTab
  | ChangesStripTab
  | TerminalStripTab
  | PageStripTab
  | PrRunStripTab;

/**
 * Whether a tab is one agent's. Note that each kind is told by the field
 * naming what it shows, which a word, having none, never holds.
 */
export function isAgentTab(tab: StripTab): tab is AgentStripTab {
  return tab instanceof Object && "agent" in tab;
}

/** Whether a tab is a draft agent's. */
export function isDraftTab(tab: StripTab): tab is DraftStripTab {
  return tab instanceof Object && "draft" in tab;
}

/** Whether a tab is one subagent's. */
export function isSubagentTab(tab: StripTab): tab is SubagentStripTab {
  return tab instanceof Object && "subagent" in tab;
}

/** Whether a tab is one file's. */
export function isFileTab(tab: StripTab): tab is FileStripTab {
  return tab instanceof Object && "file" in tab;
}

/** Whether a tab is one agent's changes. */
export function isChangesTab(tab: StripTab): tab is ChangesStripTab {
  return tab instanceof Object && "changes" in tab;
}

/** Whether a tab is one agent's terminal. */
export function isTerminalTab(tab: StripTab): tab is TerminalStripTab {
  return tab instanceof Object && "terminal" in tab;
}

/** Whether a tab is one page's. */
export function isPageTab(tab: StripTab): tab is PageStripTab {
  return tab instanceof Object && "page" in tab;
}

/** Whether a tab is one agent's pull request run on this Mac. */
export function isPrRunTab(tab: StripTab): tab is PrRunStripTab {
  return tab instanceof Object && "prRun" in tab;
}

/**
 * The agent whose tab follows its run now: the one the plan's column
 * shows, while the column is on screen, the plan's page shown and no panel
 * filling the window over it; none otherwise, since a tab out of sight
 * stops following its transcript, and what it last held is no longer the
 * agent's latest step.
 */
export function followedAgent(
  tab: StripTab,
  column: { readonly shown: boolean; readonly covered: boolean },
): string | undefined {
  return column.shown && !column.covered && isAgentTab(tab) ? tab.agent : undefined;
}

/**
 * The coding agent a tab is one of the agent's own: its tab, its Changes
 * tab, or its Terminal tab, which is where a terminal command means that
 * agent (`terminal-entry.ts`); none for any other tab.
 */
export function agentOfTab(tab: StripTab): string | undefined {
  if (isAgentTab(tab)) return tab.agent;
  if (isChangesTab(tab)) return tab.changes;
  return isTerminalTab(tab) ? tab.terminal : undefined;
}

/** Whether two tabs are the same tab. A delegated worker's call names it within its agent, as the service names its conversation, so its tab is the pair. */
export function sameTab(a: StripTab, b: StripTab): boolean {
  if (isAgentTab(a)) return isAgentTab(b) && a.agent === b.agent;
  if (isSubagentTab(a)) {
    return (
      isSubagentTab(b) && a.subagent === b.subagent && a.delegation?.agent === b.delegation?.agent
    );
  }
  if (isDraftTab(a)) return isDraftTab(b) && a.draft === b.draft;
  if (isFileTab(a)) return isFileTab(b) && a.file === b.file;
  if (isChangesTab(a)) return isChangesTab(b) && a.changes === b.changes;
  if (isTerminalTab(a)) return isTerminalTab(b) && a.terminal === b.terminal;
  if (isPageTab(a)) return isPageTab(b) && a.page === b.page;
  if (isPrRunTab(a)) return isPrRunTab(b) && a.prRun === b.prRun;
  return a === b;
}

/**
 * The key each agent's Terminal tab is drawn under, by agent, made the first
 * time it is asked for. Note that it is not the agent's id, because the
 * agent's Changes tab stands in the same strip under that.
 */
const terminalKeys = new Map<string, string>();

function terminalKey(agentId: string): string {
  const held = terminalKeys.get(agentId);
  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  terminalKeys.set(agentId, made);
  return made;
}

/** The key each agent's pull request run tab is drawn under, made the first time it is asked for, on the same terms as a Terminal tab's. */
const prRunKeys = new Map<string, string>();

function prRunKey(agentId: string): string {
  const held = prRunKeys.get(agentId);
  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  prRunKeys.set(agentId, made);
  return made;
}

/**
 * A tab's key for a list that draws one element per tab: a word tab's word,
 * the agent's, call's, or draft's own id, which no word spells, or the
 * file's path. A Changes tab is keyed by its agent's id, which no other tab
 * of the side panel, the one strip it stands in, is keyed by, a Terminal tab
 * by a key made for its agent (`terminalKey`), and a page's by the page's
 * own id.
 */
export function tabKey(tab: StripTab): string {
  if (isAgentTab(tab)) return tab.agent;
  if (isTerminalTab(tab)) return terminalKey(tab.terminal);
  if (isPrRunTab(tab)) return prRunKey(tab.prRun);
  if (isDraftTab(tab)) return tab.draft;
  if (isFileTab(tab)) return tab.file;
  if (isChangesTab(tab)) return tab.changes;
  if (isPageTab(tab)) return tab.page;
  return isSubagentTab(tab) ? tab.subagent : tab;
}

/**
 * `drawn` in the plan's order: each tab `order` holds first, as it stands
 * there, then the rest as they stood. Note that a tab never moved, such as
 * one just opened, so stands after every tab that was.
 */
export function inTaskOrder<T>(
  drawn: readonly T[],
  order: readonly StripTab[],
  tabOf: (each: T) => StripTab,
): T[] {
  const placed = order.flatMap((tab) => drawn.filter((each) => sameTab(tabOf(each), tab)));
  return [...placed, ...drawn.filter((each) => !placed.includes(each))];
}

/**
 * The plan's order written whole: the tabs `was` already held, those the
 * strip does not draw now among them, such as one closed, then the rest of
 * `strip`, the run of tabs the strip draws now, as it stands.
 */
function wholeOrder<T extends StripTab>(was: readonly T[], strip: readonly T[]): T[] {
  return [...was, ...strip.filter((each) => !was.some((other) => sameTab(other, each)))];
}

/**
 * The plan's order with the tab opened at the end of `strip`, the run of
 * tabs the strip draws now, as an editor opens a file: the order written
 * whole (`wholeOrder`), so every tab keeps the place it is drawn in, then
 * the tab, taken from wherever the order held it. Nothing where the tab
 * already stands in the strip, which an open only chooses.
 */
export function openedOrder<T extends StripTab>(
  was: readonly T[],
  strip: readonly T[],
  tab: T,
): readonly T[] | undefined {
  if (strip.some((other) => sameTab(other, tab))) return undefined;
  return [...wholeOrder(was, strip).filter((other) => !sameTab(other, tab)), tab];
}

/**
 * The plan's order with the tab moved to `to` in `strip`, the run of tabs
 * the strip draws now: the tabs the order already held, those the strip
 * does not draw now among them, such as one closed, then the rest of the
 * strip as it stands, the tab taken out and put back before the tab that
 * stands at `to` now, or after every one where none does. Nothing where the
 * tab does not move.
 */
export function movedOrder<T extends StripTab>(
  was: readonly T[],
  strip: readonly T[],
  tab: T,
  to: number,
): readonly T[] | undefined {
  const all = wholeOrder(was, strip);
  const at = strip.findIndex((other) => sameTab(other, tab));
  const own = all.find((other) => sameTab(other, tab));
  if (at < 0 || to === at || own === undefined) return undefined;
  const before = strip.filter((other) => !sameTab(other, tab))[Math.max(0, to)];
  const rest = all.filter((other) => !sameTab(other, tab));
  const place = before === undefined ? -1 : rest.findIndex((other) => sameTab(other, before));
  return place < 0 ? [...rest, own] : [...rest.slice(0, place), own, ...rest.slice(place)];
}

/**
 * The tabs viewed with `viewed` viewed last, in the order given, each taken
 * from where it stood before, and the oldest let go past `kept`; nothing
 * where they were already viewed so.
 */
export function viewedLast<T extends StripTab>(
  before: readonly T[],
  viewed: readonly T[],
  kept: number,
): readonly T[] | undefined {
  const others = before.filter((each) => !viewed.some((tab) => sameTab(tab, each)));
  const recent = [...others, ...viewed].slice(-kept);
  const same =
    recent.length === before.length &&
    recent.every((tab, at) => before[at] !== undefined && sameTab(tab, before[at]));
  return same ? undefined : recent;
}

/**
 * The tab chosen in place of the closed one: the latest of `recent` that
 * still stands in `standing`, the strip as the close leaves it, or where
 * none does, the tab after it in `strip`, the strip as it stood, or the one
 * before.
 */
export function replacementOf<T extends StripTab>(
  standing: readonly T[],
  recent: readonly T[],
  strip: readonly T[],
  tab: T,
): T | undefined {
  const viewed = recent.findLast((each) => standing.some((other) => sameTab(other, each)));
  if (viewed !== undefined) return viewed;
  const place = strip.findIndex((other) => sameTab(other, tab));
  return strip[place + 1] ?? strip[place - 1];
}

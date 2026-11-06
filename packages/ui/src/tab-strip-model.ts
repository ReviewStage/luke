export const TAB_WORDS = {
  INBOX: "Inbox",
  THREAD: "Thread",
  OVERVIEW: "Overview",
  NEW_AGENT: "New agent",
  AGENT: "Agent",
  PULL_REQUEST: "Pull request",
  TERMINAL: "Terminal",
  LOCAL: "Local",
  BROWSER: "Browser",
} as const;

export function pullRequestLabelOf(pullRequest: {
  readonly number: number;
  readonly title: string;
}): string {
  return `#${pullRequest.number} ${pullRequest.title}`;
}

export interface AgentStripTab {
  readonly agent: string;
}

export interface DraftStripTab {
  readonly draft: string;
}

interface SubagentDelegation {
  readonly agent: string;
  readonly task: string;
}

export interface SubagentStripTab {
  readonly subagent: string;
  readonly delegation?: SubagentDelegation;
}

export interface FileStripTab {
  readonly file: string;
}

export interface ChangesStripTab {
  readonly changes: string;
  readonly number?: number;
}

export interface TerminalStripTab {
  readonly terminal: string;
}

export interface LocalStripTab {
  readonly local: string;
}

export interface PageStripTab {
  readonly page: string;
}

export interface CloudBrowserStripTab {
  readonly cloudBrowser: string;
}

export interface TranscriptStripTab {
  readonly transcript: string;
}

export type StripTab =
  | string
  | AgentStripTab
  | TranscriptStripTab
  | DraftStripTab
  | SubagentStripTab
  | FileStripTab
  | ChangesStripTab
  | TerminalStripTab
  | LocalStripTab
  | PageStripTab
  | CloudBrowserStripTab;

export function isAgentTab(tab: StripTab): tab is AgentStripTab {
  return tab instanceof Object && "agent" in tab;
}

export function isDraftTab(tab: StripTab): tab is DraftStripTab {
  return tab instanceof Object && "draft" in tab;
}

export function isSubagentTab(tab: StripTab): tab is SubagentStripTab {
  return tab instanceof Object && "subagent" in tab;
}

export function isFileTab(tab: StripTab): tab is FileStripTab {
  return tab instanceof Object && "file" in tab;
}

export function isChangesTab(tab: StripTab): tab is ChangesStripTab {
  return tab instanceof Object && "changes" in tab;
}

export function isTranscriptTab(tab: StripTab): tab is TranscriptStripTab {
  return tab instanceof Object && "transcript" in tab;
}

export function isTerminalTab(tab: StripTab): tab is TerminalStripTab {
  return tab instanceof Object && "terminal" in tab;
}

export function isLocalTab(tab: StripTab): tab is LocalStripTab {
  return tab instanceof Object && "local" in tab;
}

export function isPageTab(tab: StripTab): tab is PageStripTab {
  return tab instanceof Object && "page" in tab;
}

export function isCloudBrowserTab(tab: StripTab): tab is CloudBrowserStripTab {
  return tab instanceof Object && "cloudBrowser" in tab;
}

export function followedAgent(
  tab: StripTab | undefined,
  column: { readonly shown: boolean; readonly covered: boolean },
): string | undefined {
  return column.shown && !column.covered && tab !== undefined && isAgentTab(tab)
    ? tab.agent
    : undefined;
}

export function agentOfTab(tab: StripTab | undefined): string | undefined {
  if (tab === undefined) return undefined;
  if (isAgentTab(tab)) return tab.agent;
  if (isChangesTab(tab)) return tab.changes;
  if (isLocalTab(tab)) return tab.local;
  return isTerminalTab(tab) ? tab.terminal : undefined;
}

export function sameTab(a: StripTab | undefined, b: StripTab | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (isAgentTab(a)) return isAgentTab(b) && a.agent === b.agent;
  if (isTranscriptTab(a)) return isTranscriptTab(b) && a.transcript === b.transcript;
  if (isSubagentTab(a)) {
    return (
      isSubagentTab(b) && a.subagent === b.subagent && a.delegation?.agent === b.delegation?.agent
    );
  }
  if (isDraftTab(a)) return isDraftTab(b) && a.draft === b.draft;
  if (isFileTab(a)) return isFileTab(b) && a.file === b.file;
  if (isChangesTab(a)) return isChangesTab(b) && a.changes === b.changes && a.number === b.number;
  if (isTerminalTab(a)) return isTerminalTab(b) && a.terminal === b.terminal;
  if (isLocalTab(a)) return isLocalTab(b) && a.local === b.local;
  if (isPageTab(a)) return isPageTab(b) && a.page === b.page;
  if (isCloudBrowserTab(a)) return isCloudBrowserTab(b) && a.cloudBrowser === b.cloudBrowser;
  return a === b;
}

const terminalKeys = new Map<string, string>();

function terminalKey(agentId: string): string {
  const held = terminalKeys.get(agentId);
  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  terminalKeys.set(agentId, made);
  return made;
}

const localKeys = new Map<string, string>();

function localKey(agentId: string): string {
  const held = localKeys.get(agentId);
  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  localKeys.set(agentId, made);
  return made;
}

const transcriptKeys = new Map<string, string>();

function transcriptKey(agentId: string): string {
  const held = transcriptKeys.get(agentId);
  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  transcriptKeys.set(agentId, made);
  return made;
}

const numberedKeys = new Map<string, Map<number, string>>();

function numberedKey(agentId: string, number: number): string {
  const ofAgent = numberedKeys.get(agentId) ?? new Map<number, string>();
  numberedKeys.set(agentId, ofAgent);
  const held = ofAgent.get(number);
  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  ofAgent.set(number, made);
  return made;
}

export function tabKey(tab: StripTab): string {
  if (isAgentTab(tab)) return tab.agent;
  if (isTranscriptTab(tab)) return transcriptKey(tab.transcript);
  if (isTerminalTab(tab)) return terminalKey(tab.terminal);
  if (isLocalTab(tab)) return localKey(tab.local);
  if (isDraftTab(tab)) return tab.draft;
  if (isFileTab(tab)) return tab.file;
  if (isChangesTab(tab)) {
    return tab.number === undefined ? tab.changes : numberedKey(tab.changes, tab.number);
  }
  if (isPageTab(tab)) return tab.page;
  if (isCloudBrowserTab(tab)) return tab.cloudBrowser;
  return isSubagentTab(tab) ? tab.subagent : tab;
}

export function inTaskOrder<T>(
  drawn: readonly T[],
  order: readonly StripTab[],
  tabOf: (each: T) => StripTab,
): T[] {
  const placed = order.flatMap((tab) => drawn.filter((each) => sameTab(tabOf(each), tab)));
  return [...placed, ...drawn.filter((each) => !placed.includes(each))];
}

function wholeOrder<T extends StripTab>(was: readonly T[], strip: readonly T[]): T[] {
  return [...was, ...strip.filter((each) => !was.some((other) => sameTab(other, each)))];
}

export function openedOrder<T extends StripTab>(
  was: readonly T[],
  strip: readonly T[],
  tab: T,
): readonly T[] | undefined {
  if (strip.some((other) => sameTab(other, tab))) return undefined;
  return [...wholeOrder(was, strip).filter((other) => !sameTab(other, tab)), tab];
}

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

export interface ViewedAt<T extends StripTab> {
  readonly tab: T;
  readonly at: number;
}

export function viewedAtOf<T extends StripTab>(
  stamps: readonly ViewedAt<T>[],
  tab: T,
): number | undefined {
  return stamps.find((each) => sameTab(each.tab, tab))?.at;
}

export function stampedViewed<T extends StripTab>(
  before: readonly ViewedAt<T>[],
  viewed: readonly T[],
  standing: readonly T[],
  at: number,
  kept: number,
): readonly ViewedAt<T>[] | undefined {
  const unstamped = standing.filter((tab) => viewedAtOf(before, tab) === undefined);
  const fresh = [...viewed, ...unstamped].filter(
    (tab, place, all) =>
      viewedAtOf(before, tab) !== at && all.findIndex((other) => sameTab(other, tab)) === place,
  );
  if (fresh.length === 0) return undefined;
  const others = before.filter((each) => !fresh.some((tab) => sameTab(tab, each.tab)));
  const all = [...others, ...fresh.map((tab) => ({ tab, at }))];
  const loose = all
    .filter((each) => !standing.some((tab) => sameTab(tab, each.tab)))
    .slice(0, Math.max(0, all.length - kept));
  return all.filter((each) => !loose.includes(each));
}

export function withoutViewedAt<T extends StripTab>(
  stamps: readonly ViewedAt<T>[],
  tab: T,
): readonly ViewedAt<T>[] {
  return stamps.some((each) => sameTab(each.tab, tab))
    ? stamps.filter((each) => !sameTab(each.tab, tab))
    : stamps;
}

export function idleTabs<T extends StripTab>(
  strip: readonly T[],
  stamps: readonly ViewedAt<T>[],
  now: number,
  idle: number,
  keeps: (tab: T) => boolean,
): readonly T[] {
  return strip
    .filter((tab) => {
      const at = viewedAtOf(stamps, tab);
      return at !== undefined && now - at >= idle && !keeps(tab);
    })
    .toReversed();
}

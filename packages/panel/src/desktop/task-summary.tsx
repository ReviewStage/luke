import { AGENT_BOUNDS, type AgentSummary } from "@repo/features/agent-wire";
import {
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
  cn,
  GAP,
  GROUP_HEADING,
  GROUP_SURFACE,
  GroupHeader,
  IconButton,
  InlineEdit,
  LAYOUT_ELEMENT,
  LIST_DENSITY,
  List,
  ListRow,
  type ListRowMenu,
  RowHint,
  RowHintOptions,
  SCROLL_FADE,
  SCROLL_SIZE,
  ScrollArea,
  Stack,
  Tooltip,
  usePressAway,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { sameTab } from "@repo/ui/tab-strip-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { Schema } from "effect";
import { ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { rowDrafted, useInboxRowDrafts } from "../composer-drafts.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import { agentSubject } from "../tasks/agent-ref.js";
import { useChangesPeopleOf } from "../tasks/changes-people.js";
import type { InboxBoardView } from "../tasks/inbox-model.js";
import { peopleOf } from "../tasks/pull-request-card.js";
import { openPlanStanding, TAB_KIND } from "../tasks/tab-look.js";
import type { AgentsControl, HeldPeople } from "../tasks/use-agents.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { keptFlag, keptKey, useKept } from "../use-kept.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
import { ArchivedAgents, SUMMARY_GLYPH } from "./agent-archive.js";
import { AGENTS_SECTION, agentEntries, INBOX_ROW, inboxEntry } from "./main-tabs.js";
import { ADD_SECTION, type ChangesOffer, changesOffers, panelEntries } from "./side-panel.js";
import { type CountNoun, foldedCount, sidebarFold } from "./sidebar-fold.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";
import { type CardSubject, tabCard } from "./tab-card.js";

const KEPT = {
  PINNED: keptKey("app.summary-pinned", keptFlag),
  FOLDED: keptKey("app.summaryFoldedSections", Schema.fromJsonString(Schema.Array(Schema.String))),
} as const;

const SUMMARY_WIDE = 1040;

const SUMMARY_RAILED = 480;

const SUMMARY_MODE = {
  COLUMN: "column",
  RAIL: "rail",
  NONE: "none",
} as const;

export type SummaryMode = (typeof SUMMARY_MODE)[keyof typeof SUMMARY_MODE];

const CARD_FROM = {
  RAIL: "rail",
} as const;

type CardFrom = (typeof CARD_FROM)[keyof typeof CARD_FROM];

const TABS_SECTION = "Tabs";

const SECTION_ORDER = [
  TABS_SECTION,
  AGENTS_SECTION,
  ADD_SECTION.PULL_REQUESTS,
  ADD_SECTION.PAGES,
] as const;

type SummaryHeading = (typeof SECTION_ORDER)[number];

const SECTION_NOUN = {
  [TABS_SECTION]: { one: "tab", many: "tabs" },
  [AGENTS_SECTION]: { one: "agent", many: "agents" },
  [ADD_SECTION.PULL_REQUESTS]: { one: "pull request", many: "pull requests" },
  [ADD_SECTION.PAGES]: { one: "page", many: "pages" },
} as const satisfies Record<SummaryHeading, CountNoun>;

const NONE_FOLDED: readonly string[] = [];

const OPENER = "[data-summary-opener]";

const OPENED_FROM_CARD = '[role="menu"], [role="alertdialog"], [role="tooltip"]';

export interface SummaryPin {
  pinned: boolean;
  onToggle: () => void;
  wide: boolean;
  onMeasured: (wide: boolean) => void;
}

export function useSummaryPin(fixtureMode: boolean): SummaryPin {
  const [kept, , changeKept] = useKept(KEPT.PINNED, true);
  const [staged, setStaged] = useState(true);
  const [wide, setWide] = useState(true);
  const onToggle = useCallback(
    () => (fixtureMode ? setStaged : changeKept)((was) => !was),
    [fixtureMode, changeKept],
  );
  const pinned = fixtureMode ? staged : kept;
  return useMemo(() => ({ pinned, onToggle, wide, onMeasured: setWide }), [pinned, onToggle, wide]);
}

export interface SummaryLayout {
  mode: SummaryMode;
  holds: boolean;
  wide: boolean;
  card: CardFrom | undefined;
  onToggle: () => void;
  onExpand: () => void;
  onDismiss: () => void;
}

export function useSummaryLayout(
  pin: SummaryPin,
  column: HTMLElement | null,
  covering: boolean,
  holds: boolean,
): SummaryLayout {
  const { wide, onMeasured } = pin;
  const [hung, setHung] = useState<CardFrom | undefined>(undefined);
  const [railed, setRailed] = useState(true);
  useLayoutEffect(() => {
    if (column === null) return;
    const measure = () => {
      const width = column.getBoundingClientRect().width;
      if (width <= 0) return;
      onMeasured(width >= SUMMARY_WIDE);
      setRailed(width >= SUMMARY_RAILED);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [column, onMeasured]);
  const mode = !holds
    ? SUMMARY_MODE.NONE
    : wide && pin.pinned
      ? SUMMARY_MODE.COLUMN
      : railed
        ? SUMMARY_MODE.RAIL
        : SUMMARY_MODE.NONE;
  const gone = mode !== SUMMARY_MODE.RAIL || covering || !holds;
  if (gone && hung !== undefined) setHung(undefined);
  const card = gone ? undefined : hung;
  const expand = (from: CardFrom) => {
    if (card !== undefined) setHung(undefined);
    else if (wide) pin.onToggle();
    else setHung(from);
  };
  const onDismiss = useCallback(() => setHung(undefined), []);
  return {
    mode,
    holds,
    wide,
    card,
    onToggle: pin.onToggle,
    onExpand: () => expand(CARD_FROM.RAIL),
    onDismiss,
  };
}

function cardControl(layout: SummaryLayout, cardId: string) {
  return {
    "aria-haspopup": "dialog" as const,
    "aria-expanded": layout.card !== undefined,
    "aria-controls": layout.card === undefined ? undefined : cardId,
  };
}

interface SummaryEntry extends AddEntry {
  card?: ReactNode;
}

interface SummarySection<Entry extends AddEntry = SummaryEntry> {
  heading: SummaryHeading;
  entries: readonly Entry[];
}

function withCards(
  entries: readonly AddEntry[],
  input: {
    tasks: TasksControl;
    inbox: InboxBoardView;
    held: HeldTranscripts;
    changes: readonly ChangesOffer[];
    people: ReadonlyMap<string, HeldPeople>;
    onOpenAgent: (agentId: string) => void;
  },
): SummaryEntry[] {
  const { tasks, inbox, held, changes, people, onOpenAgent } = input;
  const { agents, mainTabs } = tasks;
  const models = agents.models ?? [];
  const card = (entry: AddEntry, subject: CardSubject) => ({
    ...entry,
    card: tabCard(subject) ?? undefined,
  });
  return entries.map((entry) => {
    const { row, agent } = entry;
    if (agent !== undefined) {
      const chosen = sameTab({ agent: agent.id }, mainTabs.tab);
      const subject = agentSubject(agents, agent.id, held, chosen);
      return card(entry, { kind: TAB_KIND.AGENT, subject, models });
    }
    if (row.id === INBOX_ROW) return card(entry, { kind: TAB_KIND.INBOX, inbox });
    if (row.section === ADD_SECTION.PULL_REQUESTS) {
      const offer = changes.find((each) => each.pullRequest.url === row.id);
      if (offer === undefined) return entry;
      const chosen = sameTab({ agent: offer.agent.id }, mainTabs.tab);
      return card(entry, {
        kind: TAB_KIND.CHANGES,
        subject: agentSubject(agents, offer.agent.id, held, chosen),
        models,
        pullRequest: offer.pullRequest,
        people: peopleOf(people.get(offer.agent.id), offer.pullRequest),
        onOpenAgent: () => onOpenAgent(offer.agent.id),
      });
    }
    if (row.section === ADD_SECTION.PAGES) {
      const page = tasks.pages?.find((each) => each.id === row.id);
      const taskId = tasks.activeTaskId;
      if (page === undefined || taskId === undefined) return entry;
      const place = { taskId };
      return card(entry, { kind: TAB_KIND.PAGE, place, pageId: page.id, name: page.title, page });
    }
    return entry;
  });
}

function summaryRows(tasks: TasksControl, inbox: InboxBoardView, inboxDrafted = false) {
  const { sidePanel, mainTabs, agents } = tasks;
  const changes = changesOffers(agents, sidePanel.changes);
  const taskId = tasks.activeTaskId;
  const inboxRow =
    taskId !== undefined && inbox.open.length + inbox.settled.length > 0
      ? [inboxEntry(() => tasks.onShowInbox({ taskId }), inbox.waiting.length, inboxDrafted)]
      : [];
  const rows = [
    ...inboxRow,
    ...panelEntries({
      panel: sidePanel,
      kinds: sidePanel.used,
      changes,
      pages: tasks.pages ?? [],
      plan: openPlanStanding(tasks),
    }),
    ...agentEntries(mainTabs, agents),
  ];
  return { rows, changes };
}

function sectionsOf<Entry extends AddEntry>(
  entries: readonly Entry[],
  agents: AgentsControl,
): SummarySection<Entry>[] {
  const archived = (agents.archived?.length ?? 0) > 0;
  return SECTION_ORDER.flatMap((heading) => {
    const own = entries.filter((entry) => (entry.row.section ?? TABS_SECTION) === heading);
    const kept = own.length > 0 || (heading === AGENTS_SECTION && archived);
    return kept ? [{ heading, entries: own }] : [];
  });
}

function summarySections(
  tasks: TasksControl,
  inbox: InboxBoardView,
  held: HeldTranscripts,
  onOpenAgent: (agentId: string) => void,
  inboxDrafted: boolean,
  people: ReadonlyMap<string, HeldPeople>,
): SummarySection[] {
  const { rows, changes } = summaryRows(tasks, inbox, inboxDrafted);
  const entries = withCards(rows, { tasks, inbox, held, changes, people, onOpenAgent });
  return sectionsOf(entries, tasks.agents);
}

export function summaryHolds(tasks: TasksControl, inbox: InboxBoardView): boolean {
  return sectionsOf(summaryRows(tasks, inbox).rows, tasks.agents).length > 0;
}

function SummaryRow({
  entry,
  onPick,
  menu,
  more,
  editor,
  description,
  rowRef,
}: {
  entry: SummaryEntry;
  onPick: () => void;
  menu?: ListRowMenu | undefined;
  more?: boolean | undefined;
  editor?: ReactNode;
  description?: ReactNode;
  rowRef?: ((element: HTMLElement | null) => void) | undefined;
}) {
  const editing = editor !== undefined;
  const detail = description ?? entry.row.detail;
  return (
    <RowHintOptions card={entry.card}>
      <ListRow
        ref={rowRef}
        leading={<span className={SUMMARY_GLYPH}>{entry.row.icon}</span>}
        title={editing ? editor : entry.row.label}
        titleReplayMasked={entry.row.replayMasked === true}
        description={detail}
        descriptionReplayMasked={description === undefined && entry.row.replayMasked === true}
        meta={editing ? null : entry.endMark}
        hint={
          entry.card === undefined || editing
            ? undefined
            : { Hint: RowHint, label: entry.row.label }
        }
        onPress={editing ? undefined : onPick}
        menu={editing ? undefined : menu}
        more={more}
      />
    </RowHintOptions>
  );
}

const AGENT_THING = "Agent";

function AgentSummaryRow({
  entry,
  agent,
  agents,
  shown,
  onPick,
}: {
  entry: SummaryEntry;
  agent: AgentSummary;
  agents: AgentsControl;
  shown: boolean;
  onPick: () => void;
}) {
  const row = useRef<HTMLElement | null>(null);
  const hold = useCallback((element: HTMLElement | null) => {
    row.current = element;
  }, []);
  const actions = useAgentActions(agent, agents, {
    label: entry.row.label,
    shown,
    terminals: { onOpenTerminal: undefined },
  });
  const { rename } = actions;
  const editing = rename?.editing === true;
  const endedByKey = useRefocusAfterEdit(editing, row);
  const coarse = useCoarsePointer();
  return (
    <>
      <SummaryRow
        entry={entry}
        onPick={onPick}
        rowRef={hold}
        menu={rowMenu(AGENT_THING, agentMenuGroups(rowDoors(actions.doors)), shown, true)}
        more={!coarse}
        editor={
          editing && rename !== undefined ? (
            <InlineEdit
              value={rename.asked ?? entry.row.label}
              label="Agent name"
              maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
              editing
              onEnd={(edit) => {
                endedByKey(edit.byKey);
                rename.end(edit.value);
              }}
            />
          ) : undefined
        }
        description={rename?.refused === true ? <span>{RENAME_FAILED}</span> : undefined}
      />
      {actions.dialog}
    </>
  );
}

function RailRow({ entry }: { entry: AddEntry }) {
  return (
    <li>
      <Tooltip label={entry.row.terms?.[0] ?? entry.row.label}>
        <IconButton
          icon={<span className={SUMMARY_GLYPH}>{entry.row.icon}</span>}
          label={entry.row.label}
          onClick={entry.onPick}
        />
      </Tooltip>
    </li>
  );
}

function SummaryList({
  sections,
  agents,
  shown,
  onOpenAgent,
  onPicked,
}: {
  sections: readonly SummarySection[];
  agents: AgentsControl;
  shown: boolean;
  onOpenAgent: (agentId: string) => void;
  onPicked?: () => void;
}): React.JSX.Element {
  const [folded, , changeFolded] = useKept(KEPT.FOLDED, NONE_FOLDED);
  const toggle = (heading: SummaryHeading) =>
    changeFolded((kept) =>
      kept.includes(heading) ? kept.filter((each) => each !== heading) : [...kept, heading],
    );
  return (
    <>
      {sections.map(({ heading, entries }) => {
        const isFolded = folded.includes(heading);
        return (
          <div key={heading} className="task-summary-section">
            <ReplayUnmask>
              <GroupHeader
                heading={GROUP_HEADING.NONE}
                surface={GROUP_SURFACE.NARROW}
                label={heading}
                fold={sidebarFold(isFolded, () => toggle(heading))}
                count={
                  entries.length === 0
                    ? undefined
                    : foldedCount(isFolded, entries.length, SECTION_NOUN[heading])
                }
              >
                <List label={heading} density={LIST_DENSITY.DENSE}>
                  {entries.map((entry) => {
                    const onPick = () => {
                      onPicked?.();
                      entry.onPick();
                    };
                    return entry.agent === undefined ? (
                      <SummaryRow key={entry.row.id} entry={entry} onPick={onPick} />
                    ) : (
                      <AgentSummaryRow
                        key={entry.row.id}
                        entry={entry}
                        agent={entry.agent}
                        agents={agents}
                        shown={shown}
                        onPick={onPick}
                      />
                    );
                  })}
                </List>
                {heading === AGENTS_SECTION ? (
                  <ArchivedAgents
                    agents={agents}
                    shown={shown}
                    onOpen={(agentId) => {
                      onPicked?.();
                      onOpenAgent(agentId);
                    }}
                  />
                ) : null}
              </GroupHeader>
            </ReplayUnmask>
          </div>
        );
      })}
    </>
  );
}

function SummaryCard({
  id,
  from,
  sections,
  agents,
  onOpenAgent,
  onDismiss,
  leaving,
  ref: hold,
}: {
  id: string;
  from: CardFrom;
  sections: readonly SummarySection[];
  agents: AgentsControl;
  onOpenAgent: (agentId: string) => void;
  onDismiss: () => void;
  leaving: boolean;
  ref: (element: HTMLElement | null) => void;
}): React.JSX.Element {
  const card = useRef<HTMLElement>(null);
  const drawn = useCallback(
    (node: HTMLElement | null) => {
      card.current = node;
      hold(node);
    },
    [hold],
  );
  useLayoutEffect(() => {
    if (leaving) return;
    const element = card.current;
    (element?.querySelector<HTMLElement>("li > button") ?? element)?.focus({
      preventScroll: true,
    });
  }, [leaving]);
  const collapse = useCallback(() => {
    const opener = document.querySelector<HTMLElement>(`[data-summary-opener="${from}"]`);
    onDismiss();
    (opener?.querySelector<HTMLElement>("button") ?? opener)?.focus({ preventScroll: true });
  }, [from, onDismiss]);
  usePressAway(card, () => undefined, {
    onPressAway: leaving ? undefined : onDismiss,
    holds: (target) =>
      !(target instanceof Element) ||
      target.closest(OPENER) !== null ||
      target.closest(OPENED_FROM_CARD) !== null,
  });
  useEffect(() => {
    if (leaving) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.target instanceof Element && event.target.closest(OPENED_FROM_CARD) !== null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      collapse();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [collapse, leaving]);
  return (
    <Card
      look={CARD_LOOK.RAISED}
      corner={CARD_CORNER.MENU}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.MENU}
      ref={drawn}
      id={id}
      className="task-summary-card absolute top-0 right-0 z-menu box-border flex max-h-full w-summary origin-top-right animate-card-grow-in flex-col outline-none data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-card-leave data-[leaving=true]:transition-none"
      role="dialog"
      aria-label="Summary"
      tabIndex={-1}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
    >
      <ScrollArea size={SCROLL_SIZE.CONTENT}>
        <div className="task-summary-card-body relative flex flex-col gap-section-gap px-menu-inset pt-summary-card-inset pb-list-inset">
          <span className="task-summary-collapse">
            <Tooltip label="Collapse summary">
              <IconButton
                icon={<ChevronsRightIcon />}
                label="Collapse summary"
                onClick={collapse}
              />
            </Tooltip>
          </span>
          <SummaryList
            sections={sections}
            agents={agents}
            shown
            onOpenAgent={onOpenAgent}
            onPicked={onDismiss}
          />
        </div>
      </ScrollArea>
    </Card>
  );
}

function SummaryChevron({
  layout,
  cardId,
}: {
  layout: SummaryLayout;
  cardId: string;
}): React.JSX.Element {
  const pinned = layout.mode === SUMMARY_MODE.COLUMN;
  const label = pinned ? "Collapse summary" : "Expand summary";
  const hangs = !pinned && !(layout.wide && layout.card === undefined);
  return (
    <span
      className="task-summary-chevron"
      data-summary-opener={pinned ? undefined : CARD_FROM.RAIL}
    >
      <Tooltip label={label}>
        <IconButton
          icon={pinned ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
          label={label}
          {...(hangs ? cardControl(layout, cardId) : {})}
          onClick={pinned ? layout.onToggle : layout.onExpand}
        />
      </Tooltip>
    </span>
  );
}

function SummaryRoom({
  mode,
  kept = false,
  children,
}: {
  mode: SummaryMode;
  kept?: boolean;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <aside
      className={cn(
        "task-summary relative box-border flex w-summary flex-none flex-col bg-ground",
        mode === SUMMARY_MODE.RAIL && "w-summary-rail pt-column-inset",
      )}
      aria-label={kept ? undefined : "Summary"}
      aria-hidden={kept || undefined}
      data-mode={mode}
    >
      {children}
    </aside>
  );
}

export function SummarySkeleton({ mode }: { mode: SummaryMode }): React.JSX.Element | null {
  return mode === SUMMARY_MODE.NONE ? null : <SummaryRoom mode={mode} kept />;
}

export function TaskSummary({
  tasks,
  layout,
  cardId,
  inbox,
  held,
  onOpenAgent,
}: {
  tasks: TasksControl;
  layout: SummaryLayout;
  cardId: string;
  inbox: InboxBoardView;
  held: HeldTranscripts;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const rowDrafts = useInboxRowDrafts();
  const inboxDrafted = [...inbox.open, ...inbox.settled].some((item) =>
    rowDrafted(rowDrafts.get(item.id), item),
  );
  const pullRequests = tasks.agents.pullRequests;
  const people = useChangesPeopleOf(useMemo(() => [...pullRequests.keys()], [pullRequests]));
  const sections = summarySections(tasks, inbox, held, onOpenAgent, inboxDrafted, people);
  const kinds = (sections.find(({ heading }) => heading === TABS_SECTION)?.entries ?? []).filter(
    (entry) => entry.row.id !== INBOX_ROW,
  );
  const [hungFrom, setHungFrom] = useState(layout.card);
  if (layout.card !== undefined && layout.card !== hungFrom) setHungFrom(layout.card);
  const card = useDisclosure(layout.card !== undefined);
  return (
    <>
      {layout.mode === SUMMARY_MODE.NONE ? null : (
        <SummaryRoom mode={layout.mode}>
          <SummaryChevron layout={layout} cardId={cardId} />
          <ScrollArea fade={SCROLL_FADE.BOTH}>
            <div
              className={cn(
                "task-summary-body flex flex-col gap-section-gap p-column-inset",
                layout.mode === SUMMARY_MODE.RAIL && "items-center pt-ring-reach",
              )}
            >
              {layout.mode === SUMMARY_MODE.COLUMN ? (
                <SummaryList
                  sections={sections}
                  agents={tasks.agents}
                  shown={tasks.shown}
                  onOpenAgent={onOpenAgent}
                />
              ) : kinds.length === 0 ? null : (
                <Stack
                  as={LAYOUT_ELEMENT.UL}
                  gap={GAP.ROW}
                  className="task-summary-rows"
                  aria-label={TABS_SECTION}
                >
                  {kinds.map((entry) => (
                    <RailRow key={entry.row.id} entry={entry} />
                  ))}
                </Stack>
              )}
            </div>
          </ScrollArea>
        </SummaryRoom>
      )}
      {!card.mounted || hungFrom === undefined ? null : (
        <SummaryCard
          id={cardId}
          from={hungFrom}
          sections={sections}
          agents={tasks.agents}
          onOpenAgent={onOpenAgent}
          onDismiss={layout.onDismiss}
          leaving={card.leaving}
          ref={card.ref}
        />
      )}
    </>
  );
}

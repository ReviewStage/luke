import type {
  CodingAgentChangesPeople,
  CodingAgentPullRequest,
} from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { PageLine, PagePlace } from "@luke/features/page-wire";
import type { TaskStatus } from "@luke/features/task-wire";
import { HoverCard, HoverCardHead, HoverCardNote } from "@luke/ui";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import type { ReactNode } from "react";
import { AgentCard, type AgentSubject } from "../tasks/agent-ref.js";
import { AgentTabCard, type CardReading } from "../tasks/agent-tab-card.js";
import { ChangesCard } from "../tasks/changes-card.js";
import { PageChipCard, TaskChipCard } from "../tasks/chip-cards.js";
import { browserOf } from "../tasks/cloud-browser-pane.js";
import { FileCard } from "../tasks/file-ref.js";
import { type InboxBoardView, NEEDS_YOU } from "../tasks/inbox-model.js";
import { PageCard, PageNameCard } from "../tasks/page-card.js";
import { type PlanStanding, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { TerminalCardFoot } from "../tasks/terminal-shells.js";
import {
  type FixedSidePanelTab,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KIND,
} from "../tasks/use-side-panel.js";

/**
 * tab-card.tsx -- the card each kind of tab hangs wherever the thing it shows is named: its tab in either strip, its row in the task's summary, and a transcript's row that opens it.
 *
 * `tabLook` gives a kind one glyph and one name wherever it is offered;
 * `tabCard` gives it one card the same way, from what the place knows of
 * the thing, so a page, an agent, or a plan reads alike from its tab, its
 * summary row, and a call's row in a transcript. Every kind is answered
 * here by name, and the answer is never left out: a kind whose tab hangs
 * no card answers `null`, since its name says all there is, and a kind
 * added to `TAB_KIND` or `SIDE_PANEL_TAB` fails to compile until it says
 * what it hangs. A place that would hang its own card for a kind adds what
 * it knows to that kind's subject instead, so every other place hangs it
 * too. Each card here stands in for what the place cannot read yet, its
 * glyph and the name the place knows it by, rather than falling back to
 * the hint the control would have hung.
 */

/** What a place knows of the thing a tab shows, by its kind, as its card reads it. */
export type CardSubject =
  | {
      readonly kind: typeof TAB_KIND.PANEL;
      readonly tab: FixedSidePanelTab;
      /** The task the panel stands beside, by its id and as its Plan tab names it; none where the place knows no task. */
      readonly plan?: { readonly taskId: string; readonly standing: PlanStanding } | undefined;
      /** The task's Inbox as its board reads, which its Inbox tab's card counts; none where the place does not read it. */
      readonly inbox?: InboxBoardView | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.PLAN;
      readonly taskId: string;
      /** The task's name and status as the place knows them, which its card names it by where the window lists no such task. */
      readonly name: string | undefined;
      readonly status?: TaskStatus | undefined;
    }
  | { readonly kind: typeof TAB_KIND.INBOX; readonly inbox?: InboxBoardView | undefined }
  | { readonly kind: typeof TAB_KIND.CHAT }
  | { readonly kind: typeof TAB_KIND.DRAFT }
  | {
      readonly kind: typeof TAB_KIND.AGENT;
      readonly subject: AgentSubject;
      readonly models: readonly CatalogModel[] | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.SUBAGENT;
      readonly name: string;
      readonly untitled: boolean;
      readonly models: readonly CatalogModel[] | undefined;
      readonly read: () => CardReading;
    }
  | {
      readonly kind: typeof TAB_KIND.CHANGES;
      /** The agent whose pull request it is, as the place names it. */
      readonly subject: AgentSubject;
      readonly models: readonly CatalogModel[] | undefined;
      /** The pull request, none before it is read. */
      readonly pullRequest: CodingAgentPullRequest | undefined;
      readonly people: CodingAgentChangesPeople | undefined;
      readonly onOpenAgent: () => void;
    }
  | {
      readonly kind: typeof TAB_KIND.TERMINAL;
      readonly agentId: string;
      /** The agent whose sandbox its shells run in. */
      readonly subject: AgentSubject;
      readonly models: readonly CatalogModel[] | undefined;
    }
  | { readonly kind: typeof TAB_KIND.MAC_TERMINAL }
  | {
      readonly kind: typeof TAB_KIND.FILE;
      readonly path: string;
      /** What the agents said of the file, or where it is read. */
      readonly note: string | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.PAGE;
      /** What the page stands on, its plan or its agent on no task. */
      readonly place: PagePlace;
      readonly pageId: string;
      /** The page's title as the place knows it, which its card names it by until the page is read. */
      readonly name: string | undefined;
      /** The page as the place holds it, live, where it holds it; none where its card reads it as it is hung. */
      readonly page?: PageLine | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.BROWSER;
      /** The glyph and name of whose browser it is in. */
      readonly owner: { readonly icon: React.JSX.Element; readonly name: string };
      readonly title: string;
      /** Its page's address, empty before it opens one. */
      readonly address: string;
    };

/** A thing's card where the window holds nothing more of it: its glyph and its name. */
function NamedCard({ glyph, name }: { glyph: ReactNode; name: string }): React.JSX.Element {
  return (
    <HoverCard data-tab-card="">
      <HoverCardHead glyph={glyph} name={name} />
    </HoverCard>
  );
}

/** A task's card, as its sidebar row and a chip naming it hang it, or its glyph and name where the window lists no such task. */
function PlanCard({
  taskId,
  standing,
}: {
  taskId: string;
  standing: PlanStanding;
}): React.JSX.Element {
  const { icon, label } = tabLook({ kind: TAB_KIND.PLAN, ...standing });
  return <TaskChipCard taskId={taskId} fallback={<NamedCard glyph={icon} name={label} />} />;
}

/**
 * The Inbox's card: its name, how many items wait on the developer at its
 * right, and under them the title of the newest that waits, or of the
 * latest settled where none does.
 */
function InboxCard({ inbox }: { inbox: InboxBoardView }): React.JSX.Element {
  const waiting = inbox.open.length;
  const latest = waiting > 0 ? inbox.open.at(-1) : inbox.settled[0];
  return (
    <HoverCard data-tab-card="">
      <HoverCardHead
        name={TAB_WORDS.INBOX}
        corner={
          waiting === 0
            ? NEEDS_YOU.NONE
            : `${waiting} ${waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`
        }
      />
      {latest === undefined ? null : <HoverCardNote>{latest.title}</HoverCardNote>}
    </HoverCard>
  );
}

/** A fixed tab's card: the Plan tab's its task's, the Inbox's what waits; the panel's other kinds hang none, their names saying all there is. */
function panelCard(subject: Extract<CardSubject, { kind: typeof TAB_KIND.PANEL }>) {
  switch (subject.tab) {
    case SIDE_PANEL_TAB.PLAN:
      return subject.plan === undefined ? null : (
        <PlanCard taskId={subject.plan.taskId} standing={subject.plan.standing} />
      );
    case SIDE_PANEL_TAB.INBOX:
      return subject.inbox === undefined ? null : <InboxCard inbox={subject.inbox} />;
    case SIDE_PANEL_TAB.BOARD:
    case SIDE_PANEL_TAB.CODE:
    case SIDE_PANEL_TAB.COMMENTS:
    case SIDE_PANEL_TAB.CHAT:
      return null;
  }
}

/**
 * The card a tab of the kind given hangs, and every place naming what it
 * shows: `null` for a kind that hangs none, which a place hangs its hint
 * for. Note that the answer is never `undefined`, so a kind this leaves
 * out is a compile error rather than a hint hung in a card's place.
 */
export function tabCard(subject: CardSubject): React.JSX.Element | null {
  switch (subject.kind) {
    case TAB_KIND.PANEL:
      return panelCard(subject);
    case TAB_KIND.PLAN:
      return (
        <PlanCard
          taskId={subject.taskId}
          standing={{
            name: subject.name ?? SIDE_PANEL_TAB_KIND[SIDE_PANEL_TAB.PLAN].label,
            status: subject.status,
          }}
        />
      );
    case TAB_KIND.INBOX:
      return subject.inbox === undefined ? null : <InboxCard inbox={subject.inbox} />;
    case TAB_KIND.CHAT:
    case TAB_KIND.DRAFT:
    case TAB_KIND.MAC_TERMINAL:
      return null;
    case TAB_KIND.AGENT:
      return <AgentCard subject={subject.subject} models={subject.models} />;
    case TAB_KIND.SUBAGENT:
      return (
        <AgentTabCard
          name={subject.name}
          untitled={subject.untitled}
          models={subject.models ?? []}
          read={subject.read}
        />
      );
    // Note that a pull request not yet read hangs none, its tab naming it Pull request until it is.
    case TAB_KIND.CHANGES:
      return subject.pullRequest === undefined || subject.subject.agent === undefined ? null : (
        <ChangesCard
          subject={subject.subject}
          models={subject.models}
          pullRequest={subject.pullRequest}
          people={subject.people}
          onOpenAgent={subject.onOpenAgent}
        />
      );
    // A Terminal tab hangs its agent's card, saying under a rule whose sandbox its shells run in.
    case TAB_KIND.TERMINAL:
      return (
        <AgentCard
          subject={subject.subject}
          models={subject.models}
          foot={<TerminalCardFoot agentId={subject.agentId} />}
        />
      );
    case TAB_KIND.FILE:
      return <FileCard path={subject.path} note={subject.note} />;
    case TAB_KIND.PAGE:
      return subject.page !== undefined ? (
        <PageCard place={subject.place} page={subject.page} />
      ) : (
        <PageChipCard
          place={subject.place}
          pageId={subject.pageId}
          fallback={<PageNameCard name={subject.name} />}
        />
      );
    case TAB_KIND.BROWSER:
      return (
        <HoverCard data-tab-card="">
          <HoverCardHead
            glyph={subject.owner.icon}
            name={subject.title}
            sub={`In ${browserOf(subject.owner.name)}`}
          />
          {subject.address.length === 0 ? null : (
            <HoverCardNote oneLine>{subject.address}</HoverCardNote>
          )}
        </HoverCard>
      );
  }
}

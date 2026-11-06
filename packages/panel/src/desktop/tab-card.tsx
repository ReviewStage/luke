import type { AgentChangesPeople, AgentPullRequest } from "@repo/features/agent-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import type { PageLine, PagePlace } from "@repo/features/page-wire";
import type { TaskStatus } from "@repo/features/task-wire";
import { HoverCard, HoverCardHead, HoverCardNote, STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import { AgentCard, type AgentSubject } from "../tasks/agent-ref.js";
import { AgentTabCard, type CardReading, taskFoot } from "../tasks/agent-tab-card.js";
import { PageChipCard, TaskChipCard } from "../tasks/chip-cards.js";
import { browserOf } from "../tasks/cloud-browser-pane.js";
import { FileCard } from "../tasks/file-ref.js";
import { type InboxBoardView, NEEDS_YOU, needsYouWords } from "../tasks/inbox-model.js";
import { PageCard, PageNameCard, PageNameSkeleton } from "../tasks/page-card.js";
import { PullRequestCard } from "../tasks/pull-request-card.js";
import { type PlanStanding, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { TerminalCardFoot } from "../tasks/terminal-shells.js";
import { openerOf } from "../tasks/use-link-standing.js";
import {
  type FixedSidePanelTab,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KIND,
} from "../tasks/use-side-panel.js";

export type CardSubject =
  | {
      readonly kind: typeof TAB_KIND.PANEL;
      readonly tab: FixedSidePanelTab;
      readonly plan?: { readonly taskId: string; readonly standing: PlanStanding } | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.PLAN;
      readonly taskId: string;
      readonly name: string | undefined;
      readonly status?: TaskStatus | undefined;
    }
  | { readonly kind: typeof TAB_KIND.INBOX; readonly inbox?: InboxBoardView | undefined }
  | { readonly kind: typeof TAB_KIND.DRAFT }
  | {
      readonly kind: typeof TAB_KIND.AGENT;
      readonly subject: AgentSubject;
      readonly models: readonly CatalogModel[] | undefined;
      readonly foot?: string | undefined;
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
      readonly subject: AgentSubject;
      readonly models: readonly CatalogModel[] | undefined;
      readonly pullRequest: AgentPullRequest | undefined;
      readonly people: AgentChangesPeople | undefined;
      readonly onOpenAgent: () => void;
    }
  | {
      readonly kind: typeof TAB_KIND.TERMINAL;
      readonly agentId: string;
      readonly subject: AgentSubject;
      readonly models: readonly CatalogModel[] | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.LOCAL;
      readonly subject: AgentSubject;
      readonly models: readonly CatalogModel[] | undefined;
    }
  | { readonly kind: typeof TAB_KIND.FILE; readonly path: string }
  | {
      readonly kind: typeof TAB_KIND.PAGE;
      readonly place: PagePlace;
      readonly pageId: string;
      readonly name: string | undefined;
      readonly page?: PageLine | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.BROWSER;
      readonly owner: { readonly icon: React.JSX.Element; readonly name: string };
      readonly title: string;
      readonly address: string;
    };

function NamedCard({ glyph, name }: { glyph: ReactNode; name: string }): React.JSX.Element {
  return (
    <HoverCard data-task-card="">
      <HoverCardHead glyph={glyph} name={name} />
    </HoverCard>
  );
}

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

function InboxCard({ inbox }: { inbox: InboxBoardView }): React.JSX.Element {
  const waiting = inbox.waiting.length;
  const latest = waiting > 0 ? inbox.waiting.at(-1) : inbox.settled[0];
  return (
    <HoverCard data-inbox-card="">
      <HoverCardHead
        glyph={tabLook({ kind: TAB_KIND.INBOX }).icon}
        name={TAB_WORDS.INBOX}
        corner={waiting === 0 ? NEEDS_YOU.NONE : needsYouWords(waiting)}
        cornerTone={waiting === 0 ? undefined : STATUS_TONE.ATTENTION}
      />
      {latest === undefined ? null : <HoverCardNote>{latest.title}</HoverCardNote>}
    </HoverCard>
  );
}

function panelCard(subject: Extract<CardSubject, { kind: typeof TAB_KIND.PANEL }>) {
  switch (subject.tab) {
    case SIDE_PANEL_TAB.DESCRIPTION:
      return subject.plan === undefined ? null : (
        <PlanCard taskId={subject.plan.taskId} standing={subject.plan.standing} />
      );
    case SIDE_PANEL_TAB.INBOX:
    case SIDE_PANEL_TAB.COMMENTS:
      return null;
  }
}

export function tabCard(subject: CardSubject): React.JSX.Element | null {
  switch (subject.kind) {
    case TAB_KIND.PANEL:
      return panelCard(subject);
    case TAB_KIND.PLAN:
      return (
        <PlanCard
          taskId={subject.taskId}
          standing={{
            name: subject.name ?? SIDE_PANEL_TAB_KIND[SIDE_PANEL_TAB.DESCRIPTION].label,
            status: subject.status,
          }}
        />
      );
    case TAB_KIND.INBOX:
      return subject.inbox === undefined ? null : <InboxCard inbox={subject.inbox} />;
    case TAB_KIND.DRAFT:
      return null;
    case TAB_KIND.AGENT:
      return (
        <AgentCard
          subject={subject.subject}
          models={subject.models}
          foot={subject.foot === undefined ? undefined : taskFoot(subject.foot)}
        />
      );
    case TAB_KIND.SUBAGENT:
      return (
        <AgentTabCard
          name={subject.name}
          untitled={subject.untitled}
          models={subject.models ?? []}
          read={subject.read}
        />
      );
    case TAB_KIND.CHANGES: {
      const { pullRequest, people } = subject;
      if (pullRequest === undefined || subject.subject.agent === undefined) return null;
      return (
        <PullRequestCard
          pullRequest={pullRequest}
          place={{ taskId: subject.subject.agent.planId }}
          lines={pullRequest}
          files={pullRequest.changedFiles}
          opener={people?.author ?? openerOf(pullRequest)}
          agent={{ subject: subject.subject, models: subject.models, onOpen: subject.onOpenAgent }}
          reviewers={people?.reviewers}
        />
      );
    }
    case TAB_KIND.TERMINAL:
      return (
        <AgentCard
          subject={subject.subject}
          models={subject.models}
          foot={{
            glyph: <GLYPH.TERMINAL />,
            words: <TerminalCardFoot agentId={subject.agentId} />,
          }}
        />
      );
    case TAB_KIND.LOCAL:
      return <AgentCard subject={subject.subject} models={subject.models} />;
    case TAB_KIND.FILE:
      return <FileCard path={subject.path} />;
    case TAB_KIND.PAGE:
      return subject.page !== undefined ? (
        <PageCard place={subject.place} page={subject.page} />
      ) : (
        <PageChipCard
          place={subject.place}
          pageId={subject.pageId}
          reading={<PageNameSkeleton name={subject.name} />}
          fallback={<PageNameCard name={subject.name} />}
        />
      );
    case TAB_KIND.BROWSER:
      return (
        <HoverCard data-browser-card="">
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

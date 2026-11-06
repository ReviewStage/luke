import type { AgentPullRequest, AgentStatus } from "@repo/features/agent-wire";
import type { ModelProvider } from "@repo/features/models-wire";
import type { TaskStatus } from "@repo/features/task-wire";
import { AgentPlaceholderIcon, DocumentIcon, PlusIcon, TaskStatusMark } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { pullRequestLabelOf, TAB_WORDS } from "@repo/ui/tab-strip-model";
import { DOCUMENT_REGION } from "@repo/ui/tasks-model";
import { AppWindowIcon, BotIcon, GitPullRequestIcon, GlobeIcon, InboxIcon } from "lucide-react";
import { HarnessMark } from "../harness-marks.js";
import { GLYPH_STATE, type GlyphState, StateGlyph, stateEndMark } from "../state-glyph.js";
import { agentGlyphState, providerOf } from "./agent-model.js";
import { fileLook } from "./file-ref.js";
import { PullRequestMark, type PullRequestMarked } from "./pull-request-mark.js";
import { type FixedSidePanelTab, SIDE_PANEL_TAB, SIDE_PANEL_TAB_KIND } from "./use-side-panel.js";
import type { TasksControl } from "./use-tasks-tab.js";

export const TAB_KIND = {
  PANEL: "panel",
  PLAN: "plan",
  INBOX: "inbox",
  DRAFT: "draft",
  OVERVIEW: "overview",
  AGENT: "agent",
  SUBAGENT: "subagent",
  CHANGES: "changes",
  TERMINAL: "terminal",
  LOCAL: "local",
  FILE: "file",
  PAGE: "page",
  BROWSER: "browser",
} as const;

interface AgentStanding {
  readonly model: string;
  readonly status?: AgentStatus | undefined;
}

export interface PlanStanding {
  readonly name: string;
  readonly status: TaskStatus | undefined;
}

export type TabSubject =
  | {
      readonly kind: typeof TAB_KIND.PANEL;
      readonly tab: FixedSidePanelTab;
      readonly plan?: PlanStanding | undefined;
      readonly thread?: boolean | undefined;
    }
  | ({ readonly kind: typeof TAB_KIND.PLAN } & PlanStanding)
  | { readonly kind: typeof TAB_KIND.INBOX }
  | { readonly kind: typeof TAB_KIND.DRAFT }
  | { readonly kind: typeof TAB_KIND.OVERVIEW }
  | {
      readonly kind: typeof TAB_KIND.AGENT;
      readonly name: string | undefined;
      readonly agent: AgentStanding | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.SUBAGENT;
      readonly name: string;
      readonly model: string | undefined;
      readonly state: GlyphState;
    }
  | {
      readonly kind: typeof TAB_KIND.CHANGES;
      readonly pullRequest?: (PullRequestMarked & Pick<AgentPullRequest, "title">) | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.TERMINAL | typeof TAB_KIND.LOCAL;
      readonly agent: AgentStanding | undefined;
    }
  | { readonly kind: typeof TAB_KIND.FILE; readonly path: string }
  | { readonly kind: typeof TAB_KIND.PAGE; readonly title: string }
  | {
      readonly kind: typeof TAB_KIND.BROWSER;
      readonly title: string | undefined;
    };

export interface KindLook {
  readonly icon: React.JSX.Element;
  readonly label: string;
}

export function PlanGlyph({ status }: { status: TaskStatus | undefined }) {
  return status === undefined ? <DocumentIcon /> : <TaskStatusMark status={status} />;
}

export function openPlanStanding(
  tasks: Pick<TasksControl, "region" | "tasks">,
): PlanStanding | undefined {
  if (tasks.region.kind !== DOCUMENT_REGION.READY) return undefined;
  const { task } = tasks.region;
  const listed = tasks.tasks.find((each) => each.id === task.id) ?? task;
  return { name: task.name, status: listed.status };
}

export function AgentMark({ provider }: { provider: ModelProvider | undefined }) {
  return provider === undefined ? <AgentPlaceholderIcon /> : <HarnessMark provider={provider} />;
}

export function SubagentMark({ model }: { model: string | undefined }) {
  const provider = model === undefined ? undefined : providerOf(model);
  return provider === undefined ? <BotIcon /> : <HarnessMark provider={provider} />;
}

export function AgentGlyph({ agent }: { agent: AgentStanding | undefined }) {
  const provider = agent === undefined ? undefined : providerOf(agent.model);
  const state = agent?.status === undefined ? GLYPH_STATE.REST : agentGlyphState(agent.status);
  return <StateGlyph glyph={<AgentMark provider={provider} />} state={state} />;
}

function SubagentGlyph({ model, state }: { model: string | undefined; state: GlyphState }) {
  return <StateGlyph glyph={<SubagentMark model={model} />} state={state} />;
}

export function agentEndMark(
  agent: { readonly status: AgentStatus },
  hinted: boolean,
): React.JSX.Element | undefined {
  return stateEndMark(agentGlyphState(agent.status), hinted);
}

export function tabLook(subject: TabSubject): KindLook {
  switch (subject.kind) {
    case TAB_KIND.PANEL: {
      const { tab, plan } = subject;
      if (tab === SIDE_PANEL_TAB.DESCRIPTION && plan !== undefined) {
        return { icon: <PlanGlyph status={plan.status} />, label: plan.name };
      }
      if (tab === SIDE_PANEL_TAB.INBOX && subject.thread === true) {
        return { icon: <GLYPH.THREAD />, label: TAB_WORDS.THREAD };
      }
      const { label, icon: Icon } = SIDE_PANEL_TAB_KIND[tab];
      return { icon: <Icon />, label };
    }
    case TAB_KIND.PLAN:
      return { icon: <PlanGlyph status={subject.status} />, label: subject.name };
    case TAB_KIND.INBOX:
      return { icon: <InboxIcon />, label: TAB_WORDS.INBOX };
    case TAB_KIND.DRAFT:
      return { icon: <PlusIcon />, label: TAB_WORDS.NEW_AGENT };
    case TAB_KIND.OVERVIEW:
      return { icon: <DocumentIcon />, label: TAB_WORDS.OVERVIEW };
    case TAB_KIND.AGENT:
      return {
        icon: <AgentGlyph agent={subject.agent} />,
        label: subject.name ?? TAB_WORDS.AGENT,
      };
    case TAB_KIND.SUBAGENT:
      return {
        icon: <SubagentGlyph model={subject.model} state={subject.state} />,
        label: subject.name,
      };
    case TAB_KIND.CHANGES:
      return {
        icon:
          subject.pullRequest === undefined ? (
            <GitPullRequestIcon />
          ) : (
            <PullRequestMark pullRequest={subject.pullRequest} />
          ),
        label:
          subject.pullRequest === undefined
            ? TAB_WORDS.PULL_REQUEST
            : pullRequestLabelOf(subject.pullRequest),
      };
    case TAB_KIND.TERMINAL:
      return { icon: <AgentGlyph agent={subject.agent} />, label: TAB_WORDS.TERMINAL };
    case TAB_KIND.LOCAL:
      return { icon: <AgentGlyph agent={subject.agent} />, label: TAB_WORDS.LOCAL };
    case TAB_KIND.FILE: {
      const { icon, label } = fileLook(subject.path);
      return { icon, label };
    }
    case TAB_KIND.PAGE:
      return { icon: <AppWindowIcon />, label: subject.title };
    case TAB_KIND.BROWSER:
      return { icon: <GlobeIcon />, label: subject.title ?? TAB_WORDS.BROWSER };
  }
}

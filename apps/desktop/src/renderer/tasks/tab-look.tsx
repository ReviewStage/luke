import type { CodingAgentPullRequest, CodingAgentStatus } from "@luke/features/coding-agent-wire";
import type { ModelProvider } from "@luke/features/models-wire";
import { HarnessMark } from "@luke/panel/harness-marks";
import { AgentPlaceholderIcon, DocumentIcon, PlusIcon } from "@luke/ui";
import { pullRequestLabelOf, TAB_WORDS } from "@luke/ui/tab-strip-model";
import {
  AppWindowIcon,
  BotIcon,
  GitPullRequestIcon,
  GlobeIcon,
  InboxIcon,
  LaptopIcon,
  MessagesSquareIcon,
} from "lucide-react";
import { GLYPH_STATE, type GlyphState, StateGlyph, stateEndMark } from "../state-glyph";
import { agentGlyphState, providerOf } from "./coding-agent-model";
import { fileLook } from "./file-ref";
import { PullRequestMark, type PullRequestMarked } from "./pull-request-mark";
import { type FixedSidePanelTab, SIDE_PANEL_TAB_KIND } from "./use-side-panel";

/**
 * tab-look.tsx -- how each kind of tab looks wherever it is drawn: its glyph and its name on its tab in either strip, its pin in the sidebar, its row in either "+" menu and the task's summary, and its row in ⌘K.
 *
 * Every place that offers a tab draws it through `tabLook`, from what that
 * place knows of the thing the tab shows, so a kind wears one glyph and one
 * name wherever it is offered. A coding agent and a subagent wear their
 * harness's mark wearing where they stand (`AgentGlyph`, `SubagentGlyph`)
 * in every one of those places, the "+" menus' rows included: a row is
 * offered beside a strip that may not hold its tab. Each place adds what
 * only it says beside the look: a tab's card and end mark, a row's detail
 * and section, ⌘K's task name.
 */

/** The kinds of tab, each drawn its own way. */
export const TAB_KIND = {
  /** One of the side panel's fixed kinds: Board, Code, or Call. */
  PANEL: "panel",
  PLAN: "plan",
  INBOX: "inbox",
  /** The plan's own channel of the workspace's chat. */
  CHAT: "chat",
  /** A coding agent not yet started, and the "+" row that opens one. */
  DRAFT: "draft",
  AGENT: "agent",
  SUBAGENT: "subagent",
  CHANGES: "changes",
  /** One agent's terminal, which wears the agent's own glyph: a terminal belongs to its agent's sandbox. */
  TERMINAL: "terminal",
  /** A terminal of this Mac opened on an agent's pushed branch, which wears the laptop: it runs here, not in the agent's sandbox. */
  MAC_TERMINAL: "mac-terminal",
  FILE: "file",
  PAGE: "page",
  /** A Browser tab, named by its page's title once it has one. */
  BROWSER: "browser",
} as const;

/** Where an agent stands as its glyph wears it: its model, and where it stands where that is known. */
interface AgentStanding {
  readonly model: string;
  readonly status?: CodingAgentStatus | undefined;
}

/** What a place knows of the thing a tab shows, by its kind. */
export type TabSubject =
  | { readonly kind: typeof TAB_KIND.PANEL; readonly tab: FixedSidePanelTab }
  | { readonly kind: typeof TAB_KIND.PLAN; readonly name: string }
  | { readonly kind: typeof TAB_KIND.INBOX }
  | { readonly kind: typeof TAB_KIND.CHAT }
  | { readonly kind: typeof TAB_KIND.DRAFT }
  | {
      readonly kind: typeof TAB_KIND.AGENT;
      /** Its tab's label (`agentTabLabel`), or what a pin last called it; the word for an agent where none is known. */
      readonly name: string | undefined;
      readonly agent: AgentStanding | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.SUBAGENT;
      /** Its title, or its task's first line until it has one. */
      readonly name: string;
      readonly model: string | undefined;
      readonly state: GlyphState;
    }
  | {
      readonly kind: typeof TAB_KIND.CHANGES;
      /** The pull request, which names the tab by its number and title and whose mark it wears for where it stands; none before it is read. */
      readonly pullRequest?:
        | (PullRequestMarked & Pick<CodingAgentPullRequest, "title">)
        | undefined;
    }
  | {
      readonly kind: typeof TAB_KIND.TERMINAL;
      /** Where the agent whose sandbox it is stands, as its own tab's glyph wears it. */
      readonly agent: AgentStanding | undefined;
    }
  | { readonly kind: typeof TAB_KIND.MAC_TERMINAL }
  | { readonly kind: typeof TAB_KIND.FILE; readonly path: string }
  | { readonly kind: typeof TAB_KIND.PAGE; readonly title: string }
  | {
      readonly kind: typeof TAB_KIND.BROWSER;
      /** Its page's title, or its address until it has one; none before a page is opened. */
      readonly title: string | undefined;
    };

/** A tab's look: its glyph and its name. */
export interface KindLook {
  readonly icon: React.JSX.Element;
  readonly label: string;
}

/**
 * A coding agent's mark at rest: the mark of the harness its model runs in,
 * or its empty box (`AgentPlaceholderIcon`) until Luke knows the harness. A place
 * offering the agent wears it inside `AgentGlyph`; one that knows nothing
 * of where it stands, as a revision's author, wears it bare.
 */
export function AgentMark({ provider }: { provider: ModelProvider | undefined }) {
  return provider === undefined ? <AgentPlaceholderIcon /> : <HarnessMark provider={provider} />;
}

/**
 * A subagent's mark: the mark of the harness its model runs in, or the
 * worker's robot where its model is not known. Note that the harness is read
 * from the model's id, as an agent's is, so the mark stands before the
 * catalog is read. A transcript's row wears it bare, beside a working mark
 * of its own.
 */
export function SubagentMark({ model }: { model: string | undefined }) {
  const provider = model === undefined ? undefined : providerOf(model);
  return provider === undefined ? <BotIcon /> : <HarnessMark provider={provider} />;
}

/**
 * An agent's glyph wearing where it stands: its mark (`AgentMark`) at its
 * full size, giving way to the working mark while the agent may still write
 * (`state-glyph.tsx`). A failed agent keeps its mark, and its row or tab
 * says the failure at its end (`agentEndMark`). An agent whose standing is
 * not known, a pin's whose task is not open, wears its mark at rest, and one
 * this window does not list, one another Mac started, the mark of no known
 * harness, so a row naming it keeps the glyph's column.
 */
export function AgentGlyph({ agent }: { agent: AgentStanding | undefined }) {
  const provider = agent === undefined ? undefined : providerOf(agent.model);
  const state = agent?.status === undefined ? GLYPH_STATE.REST : agentGlyphState(agent.status);
  return <StateGlyph glyph={<AgentMark provider={provider} />} state={state} />;
}

/** A subagent's glyph wearing where it stands, as `AgentGlyph` wears an agent's. */
function SubagentGlyph({ model, state }: { model: string | undefined; state: GlyphState }) {
  return <StateGlyph glyph={<SubagentMark model={model} />} state={state} />;
}

/** The mark at the end of an agent's row or tab: the failed mark once its turn failed, nothing otherwise (`stateEndMark`). */
export function agentEndMark(
  agent: { readonly status: CodingAgentStatus },
  hinted: boolean,
): React.JSX.Element | undefined {
  return stateEndMark(agentGlyphState(agent.status), hinted);
}

/** How a tab of the kind looks, from what the place drawing it knows of what it shows. */
export function tabLook(subject: TabSubject): KindLook {
  switch (subject.kind) {
    case TAB_KIND.PANEL: {
      const { label, icon: Icon } = SIDE_PANEL_TAB_KIND[subject.tab];
      return { icon: <Icon />, label };
    }
    case TAB_KIND.PLAN:
      return { icon: <DocumentIcon />, label: subject.name };
    case TAB_KIND.INBOX:
      return { icon: <InboxIcon />, label: TAB_WORDS.INBOX };
    case TAB_KIND.CHAT:
      return { icon: <MessagesSquareIcon />, label: TAB_WORDS.CHAT };
    case TAB_KIND.DRAFT:
      return { icon: <PlusIcon />, label: TAB_WORDS.NEW_AGENT };
    case TAB_KIND.AGENT:
      return {
        icon: <AgentGlyph agent={subject.agent} />,
        label: subject.name ?? TAB_WORDS.CODING_AGENT,
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
      // Note that the agent's name is not the label, because the tab says
      // what it is first; each place drawing it names the agent beside it.
      return { icon: <AgentGlyph agent={subject.agent} />, label: TAB_WORDS.TERMINAL };
    case TAB_KIND.MAC_TERMINAL:
      return { icon: <LaptopIcon />, label: TAB_WORDS.MAC_TERMINAL };
    case TAB_KIND.FILE: {
      // A file's tab is named as every place names a file (`file-ref.tsx`).
      const { icon, label } = fileLook(subject.path);
      return { icon, label };
    }
    case TAB_KIND.PAGE:
      return { icon: <AppWindowIcon />, label: subject.title };
    case TAB_KIND.BROWSER:
      return { icon: <GlobeIcon />, label: subject.title ?? TAB_WORDS.BROWSER };
  }
}

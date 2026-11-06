import type { MentionLines } from "@repo/features/mention-link";
import { THING_KIND, type Thing, type ThingKind, type ThingOf } from "@repo/features/thing-kind";
import { HoverCardSkeleton } from "@repo/ui";
import type { ReactNode } from "react";
import { AppCard } from "../actor-ref.js";
import { tabCard } from "../desktop/tab-card.js";
import {
  AutomationChipCard,
  PageChipCard,
  PersonChipCard,
  SectionChipCard,
  UnreadPageCard,
  VersionChipCard,
} from "./chip-cards.js";
import { FileCard } from "./file-ref.js";
import { shortCommit } from "./file-tab-model.js";
import { InboxItemChipCard } from "./inbox-item-chip.js";
import {
  AgentPullRequestChipCard,
  MentionedAgentCard,
  PullRequestChipCard,
} from "./mentioned-agent-card.js";
import { ServerCard } from "./server-card.js";
import { TAB_KIND } from "./tab-look.js";

export interface ThingCardAt {
  readonly own: ReactNode;
  readonly glyph: ReactNode;
  readonly name: string;
  readonly workspace: string;
  readonly wordsWorkspaceId: string | undefined;
  readonly repository: string | undefined;
  readonly gone: string | undefined;
}

type ThingCard<T> = (thing: T, at: ThingCardAt) => ReactNode;

type ThingCards = { readonly [K in ThingKind]: ThingCard<ThingOf<K>> };

const DEFAULT_BRANCH_WORDS = "On the default branch";

export const OWN_CARD: ThingCard<Thing> = (_thing, at) => at.own;

function linesNote(lines: MentionLines | undefined): string | undefined {
  if (lines === undefined) return undefined;
  const span =
    lines.startLine === lines.endLine
      ? `Line ${lines.startLine}`
      : `Lines ${lines.startLine}–${lines.endLine}`;
  return `${span} at ${shortCommit(lines.commit)}`;
}

function reading(at: ThingCardAt): ReactNode {
  return <HoverCardSkeleton glyph={at.glyph} name={at.name} />;
}

const SERVER_CARD: ThingCard<ThingOf<typeof THING_KIND.SERVER | typeof THING_KIND.TOOL>> = (
  server,
) => (
  <ServerCard
    provider={server.provider}
    connection={server.connection}
    tool={server.kind === THING_KIND.TOOL ? server.tool : undefined}
  />
);

const AUTOMATION_CARD: ThingCard<
  ThingOf<typeof THING_KIND.AUTOMATION | typeof THING_KIND.AUTOMATION_RUN>
> = (automation, at) => (
  <AutomationChipCard
    automationId={automation.automationId}
    workspace={at.workspace}
    wordsWorkspaceId={at.wordsWorkspaceId}
    reading={reading(at)}
    fallback={at.own}
  />
);

export const THING_CARD: ThingCards = {
  [THING_KIND.PLAN]: (plan, at) =>
    tabCard({ kind: TAB_KIND.PLAN, taskId: plan.taskId, name: at.name }),
  [THING_KIND.SECTION]: (section, at) => (
    <SectionChipCard
      taskId={section.taskId}
      anchor={section.anchor}
      name={at.name}
      gone={at.gone}
      fallback={at.own}
    />
  ),
  [THING_KIND.VERSION]: (version, at) => (
    <VersionChipCard taskId={version.planId} revision={version.revision} fallback={at.own} />
  ),
  [THING_KIND.COMMENT]: OWN_CARD,
  [THING_KIND.PAGE]: (page, at) => (
    <PageChipCard
      place={"taskId" in page ? { taskId: page.taskId } : { agentId: page.agentId }}
      pageId={page.pageId}
      reading={reading(at)}
      fallback={<UnreadPageCard glyph={at.glyph} name={at.name} />}
    />
  ),
  [THING_KIND.AGENT]: (agent, at) => (
    <MentionedAgentCard agentId={agent.agentId} reading={reading(at)} fallback={at.own} />
  ),
  [THING_KIND.WORKER]: OWN_CARD,
  [THING_KIND.APP]: () => <AppCard />,
  [THING_KIND.CHANGES]: (changes, at) => (
    <AgentPullRequestChipCard
      agentId={changes.agentId}
      taskId={changes.planId}
      reading={reading(at)}
      fallback={at.own}
    />
  ),
  [THING_KIND.PULL_REQUEST]: (pullRequest, at) => (
    <PullRequestChipCard url={pullRequest.url} reading={reading(at)} fallback={at.own} />
  ),
  [THING_KIND.PULL_REQUEST_THREAD]: OWN_CARD,
  [THING_KIND.ISSUE]: OWN_CARD,
  [THING_KIND.LINK]: OWN_CARD,
  [THING_KIND.MESSAGE]: OWN_CARD,
  [THING_KIND.HOME]: OWN_CARD,
  [THING_KIND.BOARD]: OWN_CARD,
  [THING_KIND.INBOX]: OWN_CARD,
  [THING_KIND.INBOX_ITEM]: (item, at) => <InboxItemChipCard place={item} fallback={at.own} />,
  [THING_KIND.AUTOMATIONS]: OWN_CARD,
  [THING_KIND.AUTOMATION]: AUTOMATION_CARD,
  [THING_KIND.AUTOMATION_RUN]: AUTOMATION_CARD,
  [THING_KIND.SETTINGS]: OWN_CARD,
  [THING_KIND.PERSON]: (person, at) => (
    <PersonChipCard
      userId={person.userId}
      workspace={at.workspace}
      reading={reading(at)}
      fallback={at.own}
    />
  ),
  [THING_KIND.ADMIN]: OWN_CARD,
  [THING_KIND.FILE]: (file, at) => (
    <FileCard
      path={file.path}
      repository={at.repository}
      note={linesNote(file.lines) ?? branchNote(at.repository)}
    />
  ),
  [THING_KIND.FOLDER]: OWN_CARD,
  [THING_KIND.SERVER]: SERVER_CARD,
  [THING_KIND.TOOL]: SERVER_CARD,
  [THING_KIND.SKILL]: OWN_CARD,
  [THING_KIND.REPOSITORY]: OWN_CARD,
  [THING_KIND.WORKSPACE]: OWN_CARD,
  [THING_KIND.DATE]: OWN_CARD,
};

function cardOf<K extends ThingKind>(kind: K, thing: ThingOf<K>, at: ThingCardAt): ReactNode {
  return THING_CARD[kind](thing, at);
}

export function branchNote(repository: string | undefined): string | undefined {
  return repository === undefined ? undefined : DEFAULT_BRANCH_WORDS;
}

export function thingCard(thing: Thing, at: ThingCardAt): ReactNode {
  return cardOf(thing.kind, thing, at);
}

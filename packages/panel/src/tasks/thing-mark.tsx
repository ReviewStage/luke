import { CHECK_SUMMARY } from "@repo/features/agent-wire";
import type { KnownNames } from "@repo/features/place-chip-model";
import { THING_KIND, type Thing, type ThingKind, type ThingOf } from "@repo/features/thing-kind";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { ProviderMark } from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, APP_ACTOR } from "@repo/ui/actor-model";
import {
  CalendarIcon,
  GLYPH,
  HashIcon,
  HouseIcon,
  MessageSquareIcon,
  ShieldUserIcon,
} from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark, automationActor } from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { usePerson } from "../member-directory.js";
import { appStateQuery, selectWorkspaces } from "../use-app-state.js";
import { providerOf } from "./agent-model.js";
import { WorkspaceDirectory } from "./chip-cards.js";
import { fileName } from "./file-ref-model.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { InboxItemChipGlyph } from "./inbox-item-chip.js";
import { IssueMark } from "./issue-mark.js";
import { ReadAgentModel } from "./mentioned-agent-card.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { SkillMark } from "./skill-ref.js";
import { AgentGlyph, AgentMark, PlanGlyph } from "./tab-look.js";
import { useAgentStatus, useTaskStatus } from "./use-known-names.js";
import type { LinkStanding } from "./use-link-standing.js";

export interface ThingMarkAt {
  readonly name: string;
  readonly known: KnownNames;
  readonly workspace: string;
  readonly tiles: AgentTiles | undefined;
  readonly standing: LinkStanding | undefined;
}

export interface AgentTiles {
  readonly tileOf: (agentId: string) => Actor | undefined;
}

type ThingMark<T> = (thing: T, at: ThingMarkAt) => ReactNode;

type ThingMarks = { readonly [K in ThingKind]: ThingMark<ThingOf<K>> };

function PlanMark({ taskId }: { taskId: string }): React.JSX.Element {
  return <PlanGlyph status={useTaskStatus(taskId)} />;
}

function harnessMark(model: string | undefined): ReactNode {
  return <AgentMark provider={model === undefined ? undefined : providerOf(model)} />;
}
function KnownAgentMark({ agentId, at }: { agentId: string; at: ThingMarkAt }): ReactNode {
  const model = at.known.agentModels.get(agentId);
  const status = useAgentStatus(agentId);
  if (model !== undefined && status !== undefined) return <AgentGlyph agent={{ model, status }} />;
  if (model !== undefined) return harnessMark(model);
  return <ReadAgentModel agentId={agentId}>{harnessMark}</ReadAgentModel>;
}

function AgentThingMark({
  agent,
  at,
}: {
  agent: ThingOf<typeof THING_KIND.AGENT>;
  at: ThingMarkAt;
}): React.JSX.Element {
  const { tiles } = at;
  const tile = tiles?.tileOf(agent.agentId);
  const harnessless =
    tile === undefined || (tile.kind === ACTOR_KIND.AGENT && tile.provider === undefined);
  return harnessless ? (
    <KnownAgentMark agentId={agent.agentId} at={at} />
  ) : (
    <ActorMark actor={tile} size={ACTOR_SIZE.INLINE} />
  );
}

function PersonFace({ userId, name }: { userId: string; name: string }): React.JSX.Element {
  const person = usePerson({ userId, name });
  return <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />;
}

function PersonMark({
  userId,
  name,
  workspace,
}: {
  userId: string;
  name: string;
  workspace: string;
}): React.JSX.Element {
  const listed = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  const named = listed === undefined ? undefined : workspaceOfSlug(listed, workspace);
  const face = <PersonFace userId={userId} name={name} />;
  return named === undefined ? (
    face
  ) : (
    <WorkspaceDirectory workspace={named}>{face}</WorkspaceDirectory>
  );
}

function AutomationTile({
  automationId,
  name,
}: {
  automationId: string;
  name: string;
}): React.JSX.Element {
  const known = useAutomation(automationId);
  return (
    <ActorMark
      actor={
        known === undefined
          ? { kind: ACTOR_KIND.AUTOMATION, name, state: ACTOR_STATE.REST }
          : automationActor(known.automation)
      }
      size={ACTOR_SIZE.INLINE}
    />
  );
}

function WorkspaceMark({ slug }: { slug: string }): React.JSX.Element {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  const listed = workspaces === undefined ? undefined : workspaceOfSlug(workspaces, slug);
  return <WorkspaceTile workspace={listed ?? { id: slug, name: slug }} size={TILE_SIZE.INLINE} />;
}

const AUTOMATION_MARK: ThingMark<
  ThingOf<typeof THING_KIND.AUTOMATION | typeof THING_KIND.AUTOMATION_RUN>
> = (automation, at) => <AutomationTile automationId={automation.automationId} name={at.name} />;

const SERVER_MARK: ThingMark<ThingOf<typeof THING_KIND.SERVER | typeof THING_KIND.TOOL>> = (
  server,
) => <ProviderMark provider={server.provider} />;

const THING_MARK: ThingMarks = {
  [THING_KIND.PLAN]: (plan) => <PlanMark taskId={plan.taskId} />,
  [THING_KIND.SECTION]: () => <HashIcon aria-hidden="true" />,
  [THING_KIND.VERSION]: (version) => <PlanMark taskId={version.planId} />,
  [THING_KIND.COMMENT]: () => <GLYPH.COMMENT />,
  [THING_KIND.PAGE]: () => <GLYPH.PAGE />,
  [THING_KIND.AGENT]: (agent, at) => <AgentThingMark agent={agent} at={at} />,
  [THING_KIND.WORKER]: () => <GLYPH.AGENT />,
  [THING_KIND.APP]: () => <ActorMark actor={APP_ACTOR} size={ACTOR_SIZE.INLINE} />,
  [THING_KIND.CHANGES]: () => <GLYPH.PULL_REQUEST_CHANGES />,
  [THING_KIND.PULL_REQUEST]: (_pullRequest, { standing }) =>
    standing?.pullRequest === undefined ? (
      <GLYPH.PULL_REQUEST />
    ) : (
      <PullRequestMark pullRequest={{ ...standing.pullRequest, checks: CHECK_SUMMARY.NONE }} />
    ),
  [THING_KIND.PULL_REQUEST_THREAD]: () => <GLYPH.COMMENT />,
  [THING_KIND.ISSUE]: (_issue, { standing }) =>
    standing?.issue === undefined ? <GLYPH.ISSUE /> : <IssueMark issue={standing.issue} />,
  [THING_KIND.LINK]: (link) => (
    <ProviderMark provider={"site" in link ? link.site : link.provider} />
  ),
  [THING_KIND.MESSAGE]: () => <MessageSquareIcon aria-hidden="true" />,
  [THING_KIND.HOME]: () => <HouseIcon aria-hidden="true" />,
  [THING_KIND.BOARD]: () => <GLYPH.TASK />,
  [THING_KIND.INBOX]: () => <GLYPH.INBOX />,
  [THING_KIND.INBOX_ITEM]: (item) => <InboxItemChipGlyph place={item} />,
  [THING_KIND.AUTOMATIONS]: () => <GLYPH.AUTOMATION />,
  [THING_KIND.AUTOMATION]: AUTOMATION_MARK,
  [THING_KIND.AUTOMATION_RUN]: AUTOMATION_MARK,
  [THING_KIND.SETTINGS]: () => <GLYPH.SETTINGS />,
  [THING_KIND.PERSON]: (person, at) => (
    <PersonMark userId={person.userId} name={at.name} workspace={at.workspace} />
  ),
  [THING_KIND.ADMIN]: () => <ShieldUserIcon aria-hidden="true" />,
  [THING_KIND.FILE]: (file) => <FileTypeIcon name={fileName(file.path)} />,
  [THING_KIND.FOLDER]: () => <GLYPH.FOLDER />,
  [THING_KIND.SERVER]: SERVER_MARK,
  [THING_KIND.TOOL]: SERVER_MARK,
  [THING_KIND.SKILL]: () => <SkillMark />,
  [THING_KIND.REPOSITORY]: () => <GLYPH.REPOSITORY />,
  [THING_KIND.WORKSPACE]: (workspace) => <WorkspaceMark slug={workspace.workspace} />,
  [THING_KIND.DATE]: () => <CalendarIcon aria-hidden="true" />,
};

function markOf<K extends ThingKind>(kind: K, thing: ThingOf<K>, at: ThingMarkAt): ReactNode {
  return THING_MARK[kind](thing, at);
}

export function thingMark(thing: Thing, at: ThingMarkAt): ReactNode {
  return markOf(thing.kind, thing, at);
}

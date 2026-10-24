import { CHECK_SUMMARY } from "@luke/features/coding-agent-wire";
import type { KnownNames } from "@luke/features/place-chip-model";
import { THING_KIND, type Thing, type ThingKind, type ThingOf } from "@luke/features/thing-kind";
import type { Workspace } from "@luke/features/workspace-wire";
import { DocumentIcon, ProviderMark } from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, LUKE_ACTOR } from "@luke/ui/actor-model";
import {
  CalendarIcon,
  GLYPH,
  HashIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  ShieldUserIcon,
} from "@luke/ui/icons";
import { fileName } from "@luke/voice/code-pane-model";
import * as Atom from "effect/reactivity/Atom";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark, automationActor } from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { usePerson } from "../member-directory.js";
import { APP_SLICE, APP_STATE_HELD, useAppSlice } from "../use-app-state.js";
import { providerOf } from "./coding-agent-model.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { InboxItemChipGlyph } from "./inbox-item-chip.js";
import { IssueMark } from "./issue-mark.js";
import { ReadAgentModel } from "./mentioned-agent-card.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { SkillMark } from "./skill-ref.js";
import { AgentMark, PlanGlyph } from "./tab-look.js";
import { useTaskStatus } from "./use-known-names.js";
import { type ChipWhere, type LinkStanding, useWordsWorkspaceId } from "./use-link-standing.js";

/**
 * thing-mark.tsx -- the mark a chip leads with for each kind of thing it names, one entry per kind (`@luke/features/thing-kind`).
 *
 * A thing wears the mark its row wears wherever the window lists it, and
 * its chip wears that same mark whichever way it was written: a mention's
 * chip and a Luke link's chip both lead with `thingMark`, so a person
 * named by a link wears their face as their mention does, and an agent of
 * the plan open wears its tab's tile either way. The table is keyed by
 * every `THING_KIND` and typed over each kind's own `Thing`, so a kind
 * added there fails to compile until it says what mark it wears.
 *
 * A mark that reads where the thing stands, a plan's status, a pull
 * request's or an issue's state, an agent's harness, an automation's last
 * run, an Inbox item's agent, falls back while the window holds none of it
 * to the one glyph `@luke/ui/icons`' `GLYPH` stands for the kind by, never
 * to the mark of the site its address is on; a person falls back to the
 * initials the people rows draw where they have no picture.
 */

/** What a chip hands its thing's mark: what it calls the thing, where it stands, and what it holds of it. */
export interface ThingMarkAt {
  /** The name the chip calls it by, which a person not among the members read, and an agent on no task, are found by. */
  readonly name: string;
  readonly known: KnownNames;
  /** Where the chip stands, whose workspace an agent on no task is found in. */
  readonly where: ChipWhere;
  /** The tiles of one plan's agents, as the place drawing the chip holds them; none where it holds none. */
  readonly tiles: AgentTiles | undefined;
  /** What its provider answered for the page it names; none for any other thing, or while unread. */
  readonly standing: LinkStanding | undefined;
}

/** The tiles of a plan's agents as their tabs wear them, by the plan's id. */
export interface AgentTiles {
  readonly taskId: string;
  readonly tileOf: (agentId: string) => Actor | undefined;
}

/** The mark a kind wears. */
type ThingMark<T> = (thing: T, at: ThingMarkAt) => ReactNode;

/** The marks, one entry per kind. */
type ThingMarks = { readonly [K in ThingKind]: ThingMark<ThingOf<K>> };

/** The workspaces of the document, which tells a workspace's mark only as they move. */
const workspacesAtom: Atom.Atom<readonly Workspace[] | undefined> = Atom.withEquality(
  Atom.map(APP_SLICE.TASKS, (planning) => planning?.workspaces),
  (held, next) => held === next,
);

/** A plan's glyph, wearing its status where the window holds the task, as its row does. */
function PlanMark({ taskId }: { taskId: string }): React.JSX.Element {
  return <PlanGlyph status={useTaskStatus(taskId)} />;
}

/** The harness an agent runs in, read off its model; the mark of no known harness where no model is known. */
function harnessMark(model: string | undefined): React.JSX.Element {
  return <AgentMark provider={model === undefined ? undefined : providerOf(model)} />;
}

/**
 * The mark of an agent the place holds no tile of: the harness the window
 * last read it running on, and where the window holds no model of it, an
 * archived agent's or one past the few its task's row names, the one read
 * for it (`ReadAgentModel`).
 */
function KnownAgentMark({
  agentId,
  taskId,
  at,
}: {
  agentId: string;
  taskId: string | undefined;
  at: ThingMarkAt;
}): React.JSX.Element {
  const workspaceId = useWordsWorkspaceId(at.where);
  const held = useAppSlice(APP_STATE_HELD);
  const model = at.known.agentModels.get(agentId);
  // Note that nothing is read before main's document lands, because the agent may be among those it lists.
  if (model !== undefined || !held) return harnessMark(model);
  return (
    <ReadAgentModel agentId={agentId} taskId={taskId} workspaceId={workspaceId} name={at.name}>
      {harnessMark}
    </ReadAgentModel>
  );
}

/** An agent's mark: its tab's tile where the place holds its plan's agents, else its harness's. */
function AgentThingMark({
  agent,
  at,
}: {
  agent: ThingOf<typeof THING_KIND.AGENT>;
  at: ThingMarkAt;
}): React.JSX.Element {
  const { tiles } = at;
  const tile =
    tiles !== undefined && agent.taskId === tiles.taskId ? tiles.tileOf(agent.agentId) : undefined;
  // Note that a tile the page knows no harness of, its agents not yet read say, gives way to the mark read for it.
  const harnessless =
    tile === undefined || (tile.kind === ACTOR_KIND.AGENT && tile.provider === undefined);
  return harnessless ? (
    <KnownAgentMark agentId={agent.agentId} taskId={agent.taskId} at={at} />
  ) : (
    <ActorMark actor={tile} size={ACTOR_SIZE.INLINE} />
  );
}

/** A person as the workspace's members around the chip draw them: their picture, their initials where they have none, or grayed where they left. */
function PersonMark({ userId, name }: { userId: string; name: string }): React.JSX.Element {
  const person = usePerson({ userId, name });
  return <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />;
}

/** An automation's clock tile, wearing how its newest run went where the window reads the automation, and at rest where it does not. */
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

/** A workspace's tile as its rows draw it; its letter by its slug where the window holds it not. */
function WorkspaceMark({ slug }: { slug: string }): React.JSX.Element {
  const listed = useAppSlice(workspacesAtom)?.find((each) => each.slug === slug);
  return <WorkspaceTile workspace={listed ?? { id: slug, name: slug }} size={TILE_SIZE.INLINE} />;
}

/** An automation's mark, or one of its runs': the automation's tile. */
const AUTOMATION_MARK: ThingMark<
  ThingOf<typeof THING_KIND.AUTOMATION | typeof THING_KIND.AUTOMATION_RUN>
> = (automation, at) => <AutomationTile automationId={automation.automationId} name={at.name} />;

/** An MCP server's mark, or one of its tools': its provider's. */
const SERVER_MARK: ThingMark<ThingOf<typeof THING_KIND.SERVER | typeof THING_KIND.TOOL>> = (
  server,
) => <ProviderMark provider={server.provider} />;

/** The mark each kind leads with, as its row leads with it wherever the window lists the thing. */
const THING_MARK: ThingMarks = {
  [THING_KIND.PLAN]: (plan) => <PlanMark taskId={plan.taskId} />,
  [THING_KIND.SECTION]: () => <HashIcon aria-hidden="true" />,
  [THING_KIND.VERSION]: (version) => <PlanMark taskId={version.planId} />,
  [THING_KIND.COMMENT]: () => <GLYPH.COMMENT />,
  [THING_KIND.TURN]: () => <DocumentIcon />,
  [THING_KIND.PAGE]: () => <GLYPH.PAGE />,
  [THING_KIND.AGENT]: (agent, at) => <AgentThingMark agent={agent} at={at} />,
  [THING_KIND.WORKER]: () => <GLYPH.AGENT />,
  [THING_KIND.LUKE]: () => <ActorMark actor={LUKE_ACTOR} size={ACTOR_SIZE.INLINE} />,
  [THING_KIND.CHANGES]: () => <GLYPH.PULL_REQUEST_CHANGES />,
  // A pull request its provider answered for wears its mark for where it stands, as everywhere the window draws one.
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
  [THING_KIND.INBOX]: () => <GLYPH.INBOX />,
  [THING_KIND.INBOX_ITEM]: (item) => <InboxItemChipGlyph place={item} />,
  [THING_KIND.AUTOMATIONS]: () => <GLYPH.AUTOMATION />,
  [THING_KIND.AUTOMATION]: AUTOMATION_MARK,
  [THING_KIND.AUTOMATION_RUN]: AUTOMATION_MARK,
  [THING_KIND.SETTINGS]: () => <GLYPH.SETTINGS />,
  [THING_KIND.PERSON]: (person, at) => <PersonMark userId={person.userId} name={at.name} />,
  [THING_KIND.CHAT]: () => <MessagesSquareIcon aria-hidden="true" />,
  [THING_KIND.ADMIN]: () => <ShieldUserIcon aria-hidden="true" />,
  [THING_KIND.FILE]: (file) => <FileTypeIcon name={fileName(file.path)} />,
  [THING_KIND.FOLDER]: () => <GLYPH.FOLDER />,
  [THING_KIND.SERVER]: SERVER_MARK,
  [THING_KIND.TOOL]: SERVER_MARK,
  [THING_KIND.SKILL]: () => <SkillMark />,
  // Note that a repository's row leads with its owner's picture only where the place may draw pictures, which no chip is told yet, so it wears its kind's glyph.
  [THING_KIND.REPOSITORY]: () => <GLYPH.REPOSITORY />,
  [THING_KIND.WORKSPACE]: (workspace) => <WorkspaceMark slug={workspace.workspace} />,
  [THING_KIND.DATE]: () => <CalendarIcon aria-hidden="true" />,
};

/** A thing's mark drawn through its kind's own entry. */
function markOf<K extends ThingKind>(kind: K, thing: ThingOf<K>, at: ThingMarkAt): ReactNode {
  return THING_MARK[kind](thing, at);
}

/** The mark a thing leads with, by its kind's entry. */
export function thingMark(thing: Thing, at: ThingMarkAt): ReactNode {
  return markOf(thing.kind, thing, at);
}

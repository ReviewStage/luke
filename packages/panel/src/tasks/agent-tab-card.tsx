import type {
  AgentPullRequest,
  AgentStatus,
  AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import type { DescriptionEditor } from "@repo/features/task-wire";
import {
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  Time,
  useMinute,
  VisuallyHidden,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import {
  ACTOR_SIZE,
  ActorMark,
  AutomationCard,
  automationActor,
  PROVENANCE_VERB,
  ProvenanceRow,
} from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { usePerson } from "../member-directory.js";
import { GLYPH_STATE, glyphStateWords } from "../state-glyph.js";
import {
  type ArchivedByReading,
  agentParts,
  agentStillWriting,
  isDelegation,
  pullRequestNumberLabel,
} from "./agent-model.js";
import { ModelLabel } from "./model-label.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { delegationView } from "./tool-call-model.js";
import { type CopiedTranscript, LATEST_ACTIVITY, latestActivity } from "./transcript-copy.js";
import { WorkingTime } from "./working-time.js";

const CARD_CORNER = {
  WORKING: "working",
  ENDED: "ended",
  NONE: "none",
} as const;

export type CardCorner =
  | { readonly kind: typeof CARD_CORNER.WORKING; readonly startedAt: number | undefined }
  | {
      readonly kind: typeof CARD_CORNER.ENDED;
      readonly state: string | undefined;
      readonly at: number | undefined;
    }
  | { readonly kind: typeof CARD_CORNER.NONE };

const ENDED_SEPARATOR = " · ";

export interface HeldTranscript {
  readonly messages: readonly AgentTranscriptMessage[];
  readonly status: AgentStatus;
  readonly runStartedAt: number | undefined;
  readonly title: string | undefined;
  readonly subagentTitles: ReadonlyMap<string, string>;
}

export interface CardReading {
  readonly corner: CardCorner;
  readonly choice: ModelChoice | undefined;
  readonly transcript: CopiedTranscript | undefined;
  readonly startedBy?: DescriptionEditor | undefined;
  readonly automationId?: string | undefined;
  readonly startedAt?: number | undefined;
  readonly tile?: Actor | undefined;
  readonly pullRequest?:
    | Pick<AgentPullRequest, "number" | "title" | "state" | "checks">
    | undefined;
  readonly archivedBy?: ArchivedByReading | undefined;
}

function Corner({ corner }: { corner: CardCorner }): React.JSX.Element | null {
  const now = useMinute();
  switch (corner.kind) {
    case CARD_CORNER.WORKING:
      return corner.startedAt === undefined ? null : (
        <WorkingTime startedAt={corner.startedAt} className="" />
      );
    case CARD_CORNER.ENDED:
      return (
        <>
          {corner.state}
          {corner.state === undefined || corner.at === undefined ? null : ENDED_SEPARATOR}
          {corner.at === undefined ? null : <Time at={corner.at} now={now} hint={false} />}
        </>
      );
    case CARD_CORNER.NONE:
      return null;
  }
}

function cornerSays(corner: CardCorner): boolean {
  if (corner.kind === CARD_CORNER.NONE) return false;
  return corner.kind !== CARD_CORNER.WORKING || corner.startedAt !== undefined;
}

function StartedBy({
  by,
  automationId,
  at,
}: {
  by: DescriptionEditor | undefined;
  automationId: string | undefined;
  at: number | undefined;
}): React.JSX.Element | null {
  const now = useMinute();
  const person = usePerson(by);
  const known = useAutomation(automationId);
  if (known === undefined && by === undefined) return null;
  return known === undefined ? (
    <ProvenanceRow verb={PROVENANCE_VERB.STARTED} actor={person} at={at} now={now} />
  ) : (
    <ProvenanceRow
      verb={PROVENANCE_VERB.STARTED}
      actor={automationActor(known.automation)}
      card={<AutomationCard automation={known.automation} workspaceName={known.workspaceName} />}
      onOpen={known.onOpen}
      at={at}
      now={now}
    />
  );
}

function PullRequestRow({
  pullRequest,
}: {
  pullRequest: NonNullable<CardReading["pullRequest"]>;
}): React.JSX.Element {
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={<PullRequestMark pullRequest={pullRequest} />}
      label={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
    />
  );
}

function ArchivedByNote({ archivedBy }: { archivedBy: ArchivedByReading }): React.JSX.Element {
  return (
    <>
      <HoverCardNote oneLine>{archivedBy.words}</HoverCardNote>
      {archivedBy.reason === undefined ? null : <HoverCardNote>{archivedBy.reason}</HoverCardNote>}
    </>
  );
}

function ActivityLine({ transcript }: { transcript: CopiedTranscript }): React.JSX.Element | null {
  const activity = latestActivity(transcript);
  if (activity === undefined) return null;
  return (
    <HoverCardNote oneLine>
      {activity.kind === LATEST_ACTIVITY.WORDS ? (
        activity.text
      ) : (
        <>
          {activity.verb}
          {activity.subject === "" ? null : " "}
          {activity.code ? <code>{activity.subject}</code> : activity.subject}
        </>
      )}
    </HoverCardNote>
  );
}

export function cardCorner(input: {
  writing: boolean;
  startedAt: number | undefined;
  movedAt: number | undefined;
  state: string | undefined;
}): CardCorner {
  const { writing, startedAt, movedAt, state } = input;
  if (writing) return { kind: CARD_CORNER.WORKING, startedAt };
  return movedAt === undefined && state === undefined
    ? { kind: CARD_CORNER.NONE }
    : { kind: CARD_CORNER.ENDED, state, at: movedAt };
}

export function lastFinished(
  messages: readonly AgentTranscriptMessage[] | undefined,
): number | undefined {
  return messages?.findLast((message) => message.finishedAt !== undefined)?.finishedAt;
}

export function delegatedChoice(
  messages: readonly AgentTranscriptMessage[] | undefined,
  callId: string,
  own: ModelChoice,
): ModelChoice | undefined {
  const call = messages
    ?.flatMap(agentParts)
    .find((part) => isDelegation(part) && part.callId === callId);
  return call === undefined || !isDelegation(call) ? undefined : delegationView(call, own).choice;
}

export function heldLatest(
  held: HeldTranscript | undefined,
  now: { writing: boolean; runStartedAt: number | undefined },
  chosen: boolean,
): readonly AgentTranscriptMessage[] | undefined {
  if (held === undefined || held.runStartedAt !== now.runStartedAt) return undefined;
  if (chosen) return held.messages;
  return !agentStillWriting(held.status) && !now.writing ? held.messages : undefined;
}

export interface CardFoot {
  readonly glyph: React.ReactNode;
  readonly words: React.ReactNode;
}

export function taskFoot(words: string): CardFoot {
  return { glyph: <GLYPH.DESCRIPTION />, words };
}

export function AgentTabCard({
  name,
  untitled = false,
  models,
  read,
  foot,
}: {
  name: string;
  untitled?: boolean;
  models: readonly CatalogModel[];
  read: () => CardReading;
  foot?: CardFoot | undefined;
}): React.JSX.Element {
  const {
    corner,
    choice,
    transcript,
    startedBy,
    automationId,
    startedAt,
    tile,
    pullRequest,
    archivedBy,
  } = read();
  const head = (
    <HoverCardHead
      mark={tile === undefined ? undefined : <ActorMark actor={tile} size={ACTOR_SIZE.CARD} />}
      name={name}
      oneLine={untitled}
      sub={choice === undefined ? undefined : <ModelLabel choice={choice} models={models} />}
      corner={cornerSays(corner) ? <Corner corner={corner} /> : undefined}
    />
  );
  return (
    <HoverCard data-agent-card="">
      {head}
      {corner.kind === CARD_CORNER.WORKING ? (
        <VisuallyHidden>{glyphStateWords(GLYPH_STATE.WORKING, false)}</VisuallyHidden>
      ) : null}
      <StartedBy by={startedBy} automationId={automationId} at={startedAt} />
      {pullRequest === undefined ? null : <PullRequestRow pullRequest={pullRequest} />}
      {archivedBy === undefined ? null : <ArchivedByNote archivedBy={archivedBy} />}
      {transcript === undefined ? null : <ActivityLine transcript={transcript} />}
      {foot === undefined ? null : (
        <HoverCardRow look={HOVER_CARD_ROW_LOOK.DETAIL} glyph={foot.glyph} label={foot.words} />
      )}
    </HoverCard>
  );
}

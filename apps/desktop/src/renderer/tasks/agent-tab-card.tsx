import type {
  CodingAgentMessage,
  CodingAgentPullRequest,
  CodingAgentStatus,
} from "@luke/features/coding-agent-wire";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import type { PlanEditor } from "@luke/features/task-wire";
import { HoverCard, HoverCardHead, HoverCardNote, HoverCardRule } from "@luke/ui";
import type { Actor } from "@luke/ui/actor-model";
import {
  ACTOR_SIZE,
  ActorLine,
  ActorMark,
  ActorRef,
  AutomationCard,
  automationActor,
} from "../actor-ref";
import { useAutomation } from "../automation-directory";
import { usePerson } from "../member-directory";
import {
  type ArchivedByReading,
  agentParts,
  agentStillWriting,
  isDelegation,
  pullRequestNumberLabel,
} from "./coding-agent-model";
import { ModelLabel } from "./model-label";
import { PullRequestMark } from "./pull-request-mark";
import { RelativeTime } from "./relative-time";
import { useMinute } from "./task-time";
import { delegationView } from "./tool-call-model";
import { type CopiedTranscript, LATEST_ACTIVITY, latestActivity } from "./transcript-copy";
import { WorkingTime } from "./working-time";

/**
 * agent-tab-card.tsx -- the card an agent's or a subagent's tab hangs while the pointer rests on it: its whole name, when it last moved, and one line of what it last did.
 *
 * The card stands in the tab's hint's place (`tooltip.tsx`), so it waits,
 * warms, and goes as a hint does, and an agent's and a subagent's are laid
 * out alike. Its head is the name, wrapped to two lines, or, for a subagent
 * not yet titled, its task on one line faded where it is cut short, as a
 * tab's label is; under the name, the model and the effort it runs at as
 * every place draws the pair (`model-label.tsx`), where they are known; and
 * the time at the head's right: "Working…" and the run's count while
 * the agent works, as its transcript's last line says it, and how long ago
 * it last moved once it has ended, in the sidebar's letters, after how it
 * ended where it stopped or failed ("Stopped · 3m"): when its
 * latest turn finished, where the tab holds it, or else when its newest
 * run began, the latest moment its summary knows. Under
 * it stands one line of the latest step, faded where it is cut short as a
 * tab's label is: the agent's last words as plain text, or its last call as
 * the concise copy says it (`transcript-copy.ts`'s `latestActivity`).
 *
 * An agent's card wears its tile beside its name (`actor-ref.tsx`), its
 * pull request at the corner's lead where the place holds one, and
 * "Started by" and who did: the automation whose run started it, by its
 * clock and name, where the window knows it, or else, for a teammate's
 * agent, the teammate's disc and name; either hangs its own card over this
 * one. An archived agent's says who archived it, Luke or another agent on a
 * member's behalf among them, and the reason given. The card has no way to the tab of its own: wherever it hangs, the
 * name it hangs from is what a press opens, so the card only says.
 *
 * The step is read from what a tab already holds, never fetched on hover:
 * the transcript the agent's tab last drew (`HeldTranscript`), while it is
 * still the agent's latest, or a brain's worker's session, which the task
 * holds whole. A card with nothing current to read says the name and the
 * time alone.
 */

/** What a card's head says at its right. */
const CARD_CORNER = {
  /** The agent works: "Working…", and how long its run has gone where its start is known. */
  WORKING: "working",
  /** The agent ended: how it ended where its glyph does not say it, a stop or a failure, and how long ago it last moved, where known. */
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

/** What parts how an agent ended from how long ago it did. */
const ENDED_SEPARATOR = " · ";

/** What the corner says before the count while the agent works, as its transcript's last line does. */
const WORKING_WORD = "Working…";

/** The transcript an agent's or a worker's tab last drew, and where the agent stood, since when its run began, and the titles it and its workers bear, as the page it was read from said. */
export interface HeldTranscript {
  readonly messages: readonly CodingAgentMessage[];
  readonly status: CodingAgentStatus;
  readonly runStartedAt: number | undefined;
  /** A worker's own title, on a worker's; an agent's is its summary's. */
  readonly title: string | undefined;
  /** Each of an agent's workers' titles, by the call that started it; none on a worker's. */
  readonly subagentTitles: ReadonlyMap<string, string>;
}

/** What a card says, read as it is hung: its corner, the model and effort its agent runs on where known, and the transcript its step is read from, or nothing where none is current. */
export interface CardReading {
  readonly corner: CardCorner;
  readonly choice: ModelChoice | undefined;
  readonly transcript: CopiedTranscript | undefined;
  /** The teammate who started the agent, as the wire names them, drawn "Started by [disc] Charles Pan"; none for the reader's own, or a card that is no agent's. */
  readonly startedBy?: PlanEditor | undefined;
  /** The automation whose run started the agent, drawn "Started by [clock] Morning Sentry triage" in the starter's place where the window knows it. */
  readonly automationId?: string | undefined;
  /** The agent's own tile, beside its name; none on a card that is no agent's, or of one the place does not hold. */
  readonly tile?: Actor | undefined;
  /** The pull request the agent opened, where the place holds it, at the head's corner. */
  readonly pullRequest?: Pick<CodingAgentPullRequest, "number" | "state" | "checks"> | undefined;
  /** Who archived the agent and why, on an archived agent's card where the service said. */
  readonly archivedBy?: ArchivedByReading | undefined;
}

function Corner({ corner }: { corner: CardCorner }): React.JSX.Element | null {
  const now = useMinute();
  switch (corner.kind) {
    case CARD_CORNER.WORKING:
      return (
        <>
          {WORKING_WORD}
          {corner.startedAt === undefined ? null : <WorkingTime startedAt={corner.startedAt} />}
        </>
      );
    case CARD_CORNER.ENDED:
      return (
        <>
          {corner.state}
          {corner.state === undefined || corner.at === undefined ? null : ENDED_SEPARATOR}
          {corner.at === undefined ? null : <RelativeTime at={corner.at} now={now} hint={false} />}
        </>
      );
    case CARD_CORNER.NONE:
      return null;
  }
}

/** What the head says at its right: the agent's pull request where the place holds one, then where the agent stands; nothing where neither is known. */
function headCorner(
  corner: CardCorner,
  pullRequest: CardReading["pullRequest"],
): React.ReactNode | undefined {
  const standing = corner.kind === CARD_CORNER.NONE ? undefined : <Corner corner={corner} />;
  if (pullRequest === undefined) return standing;
  return (
    <>
      <PullRequestMark pullRequest={pullRequest} />
      {pullRequestNumberLabel(pullRequest)}
      {standing === undefined ? null : ENDED_SEPARATOR}
      {standing}
    </>
  );
}

/**
 * Who started the agent: the automation whose run did, by its clock and
 * name, which hang its card and open its page, where the window knows it
 * (`automation-directory.tsx`); else a teammate, by their disc and name,
 * which hang their card; else nobody.
 */
function StartedBy({
  by,
  automationId,
}: {
  by: PlanEditor | undefined;
  automationId: string | undefined;
}): React.JSX.Element | null {
  const person = usePerson(by);
  const known = useAutomation(automationId);
  if (known === undefined && by === undefined) return null;
  return (
    <HoverCardNote oneLine>
      <ActorLine>
        {"Started by "}
        {known === undefined ? (
          <ActorRef actor={person} />
        ) : (
          <ActorRef
            actor={automationActor(known.automation)}
            card={
              <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
            }
            onOpen={known.onOpen}
          />
        )}
      </ActorLine>
    </HoverCardNote>
  );
}

/** Who archived the agent, on one line, and the reason they gave under it. */
function ArchivedByNote({ archivedBy }: { archivedBy: ArchivedByReading }): React.JSX.Element {
  return (
    <>
      <HoverCardNote oneLine>{archivedBy.words}</HoverCardNote>
      {archivedBy.reason === undefined ? null : <HoverCardNote>{archivedBy.reason}</HoverCardNote>}
    </>
  );
}

/** The one line of the latest step, faded at its end where it is cut short. */
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

/**
 * The corner a card wears: working, counted from `startedAt` where it is
 * known, while the agent may still write; once it has ended, how it ended
 * where its tab's glyph does not say it (`state`: "Stopped", "Failed"),
 * as the tab's hint said it, and how long ago it last moved, or nothing
 * where neither is known.
 */
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

/** When the latest of the agent's turns among `messages` answered or ended, where the service said. */
export function lastFinished(
  messages: readonly CodingAgentMessage[] | undefined,
): number | undefined {
  return messages?.findLast((message) => message.finishedAt !== undefined)?.finishedAt;
}

/**
 * The model and effort one of an agent's workers runs on, as the call that
 * started it says them among the agent's messages, a half it left out
 * being the agent's own (`own`); nothing where the call is not held.
 */
export function delegatedChoice(
  messages: readonly CodingAgentMessage[] | undefined,
  callId: string,
  own: ModelChoice,
): ModelChoice | undefined {
  const call = messages
    ?.flatMap(agentParts)
    .find((part) => isDelegation(part) && part.callId === callId);
  return call === undefined || !isDelegation(call) ? undefined : delegationView(call, own).choice;
}

/**
 * The messages a tab held, while they are still the agent's latest: read on
 * the run the agent is on now, which moves with each turn, and either the
 * tab is the one chosen, whose transcript follows that run, or they were
 * read after the run ended and it has not moved since. Nothing otherwise,
 * so a card never says an earlier turn's step as the latest, even while the
 * chosen tab's first read of a new turn is out or did not answer.
 */
export function heldLatest(
  held: HeldTranscript | undefined,
  now: { writing: boolean; runStartedAt: number | undefined },
  chosen: boolean,
): readonly CodingAgentMessage[] | undefined {
  if (held === undefined || held.runStartedAt !== now.runStartedAt) return undefined;
  if (chosen) return held.messages;
  return !agentStillWriting(held.status) && !now.writing ? held.messages : undefined;
}

/**
 * The card: the agent's tile, the name, its model under it, and its
 * corner, then who started it, the latest step where the tab holds one
 * current, and under a rule what a tab of the agent's other than its own
 * adds, as its Terminal tab says whose sandbox it is in.
 */
export function AgentTabCard({
  name,
  untitled = false,
  models,
  read,
  foot,
}: {
  name: string;
  /** Whether the name is a subagent's task standing in until it has a title. */
  untitled?: boolean;
  /** The catalog as last read, which names the model. */
  models: readonly CatalogModel[];
  /** What the card says, read from what the tab holds as the card is hung. */
  read: () => CardReading;
  /** One line under a rule, said by a tab of the agent's other than its own. */
  foot?: React.ReactNode;
}): React.JSX.Element {
  const { corner, choice, transcript, startedBy, automationId, tile, pullRequest, archivedBy } =
    read();
  const head = (
    <HoverCardHead
      name={name}
      oneLine={untitled}
      sub={choice === undefined ? undefined : <ModelLabel choice={choice} models={models} />}
      corner={headCorner(corner, pullRequest)}
    />
  );
  return (
    <HoverCard data-tab-card="">
      {tile === undefined ? (
        head
      ) : (
        <div className="actor-card-head">
          <ActorMark actor={tile} size={ACTOR_SIZE.CARD} />
          {head}
        </div>
      )}
      <StartedBy by={startedBy} automationId={automationId} />
      {archivedBy === undefined ? null : <ArchivedByNote archivedBy={archivedBy} />}
      {transcript === undefined ? null : <ActivityLine transcript={transcript} />}
      {foot === undefined ? null : (
        <>
          <HoverCardRule />
          <HoverCardNote>{foot}</HoverCardNote>
        </>
      )}
    </HoverCard>
  );
}

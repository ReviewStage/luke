import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { PlanEditor } from "@luke/features/task-wire";
import { TASK_WORK_STATE } from "@luke/features/tasks-view";
import { TRANSCRIPT_PART_TYPE } from "@luke/features/transcript-wire";
import { CallIcon, EmptyState } from "@luke/ui";
import { LUKE_ACTOR } from "@luke/ui/actor-model";
import {
  type CallTurn,
  callThread,
  THREAD_ITEM,
  type ThreadSection,
} from "@luke/voice/call-thread";
import {
  callEndedLine,
  TRANSCRIPT_EMPTY_LINE,
  TRANSCRIPT_REGION,
  type TranscriptCallRow,
  type TranscriptRegion,
} from "@luke/voice/transcript-model";
import { isRecord, isWireString, MESSAGE_ROLE } from "@luke/wire";
import type { UIMessage } from "ai";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { usePerson } from "../member-directory";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { RetryRowLabel } from "../retry-button";
import { BusyLabel, SPINNER_SIZE, Spinner } from "../spinner";
import { AGENT_LEAD, AgentMessage, type DelegationDoors } from "./agent-tab";
import { CallCheckpoint, CallEnded } from "./call-card";
import { REVEAL_MARK, useRevealInLog } from "./reveal-in-log";
import { TranscriptNote } from "./transcript-blocks";
import {
  type TaskConversation,
  type WorkTurnRow,
  workerJobs,
  workFailed,
  workRowsOf,
} from "./work-model";
import { WorkingLine } from "./working-time";

/**
 * task-call.tsx -- the open task's Call tab: its calls with Luke as one thread, read as a coding agent's tab reads, Luke's work drawn under the line that asked for it.
 *
 * A call lands in the thread the way a voice call lands in a chat thread.
 * Every row is a coding agent tab's own (`AgentMessage`): the developer's
 * lines are the developer's bubbles, a run of them one bubble, and Luke's
 * spoken lines are the agent's messages, a Copy under each. The work a line
 * caused stands right under it (`call-thread.ts`), each brain turn drawn
 * as an agent's turn is, its calls grouped and, once it has finished,
 * folded behind one line, its subagents and the coding agents it started on
 * rows of their own, and how long it worked under it, its card on hover; a
 * turn still working ends on the shimmering working line, and one that
 * ended without answering on a quiet line saying it stopped or failed. A spoken turn's
 * words stay inside its fold with how long it worked, because Luke said
 * them, and his saying them is the line after the work, so a finished
 * spoken turn is one quiet line under its ask, and one that only spoke
 * draws nothing; what the voice and the brain hand each
 * other is never drawn. Each call begins at a divider saying when it
 * started, the standing one marked live, and one that ended closes on how
 * long it ran, its card on hover. A teammate's call is named for them at
 * its divider, and over each run of lines, theirs under their face and
 * Luke's under his, so the thread reads as two named parties; the reader's
 * own call names nobody. The list keeps to its newest line while it
 * is scrolled there, so a live call reads like a chat, and the turns before
 * the oldest drawn are read a page at a time as the developer scrolls up to
 * them. Every word here is the developer's, Luke's, or the developer's
 * repository's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** What the tab says where the transcript could not be read. */
const TRANSCRIPT_FAILED_LINE = "The transcript could not be read.";

/** What a turn that ended without answering ends on, by whether it failed (`workFailed`), as an agent's turn ends. */
const ENDED_WORD = {
  STOPPED: "Stopped",
  FAILED: "Failed",
} as const;

/** Where the read of the turns before the oldest one drawn stands. */
const EARLIER_READ = {
  IDLE: "idle",
  READING: "reading",
  FAILED: "failed",
} as const;

type EarlierRead = (typeof EARLIER_READ)[keyof typeof EARLIER_READ];

/** What the row before the oldest turn drawn says, by where the read stands; a read out draws the spinner over the row's words. */
const EARLIER_LINE = {
  [EARLIER_READ.IDLE]: "Show earlier work",
  [EARLIER_READ.FAILED]: "Could not read earlier work.",
} as const satisfies Record<Exclude<EarlierRead, typeof EARLIER_READ.READING>, string>;

/** What a version's Open asks the tab to bring into view: a call, by its key, or the turn running at a moment. */
export type CallReveal =
  | { readonly call: string; readonly onRevealed: () => void }
  | { readonly at: number; readonly onRevealed: () => void };

/** A run of one speaker's lines as one message of the thread, a text part to each line. */
function spokenMessage(lines: readonly UIMessage[]): CodingAgentMessage {
  return {
    id: lines[0]?.id ?? "",
    role: lines[0]?.role ?? MESSAGE_ROLE.USER,
    parts: lines.flatMap((line) =>
      line.parts.flatMap((part) =>
        part.type === TRANSCRIPT_PART_TYPE.TEXT ? [{ type: part.type, text: part.text }] : [],
      ),
    ),
  };
}

/** Whether a turn's message holds work to draw: a call, which a spoken turn's words and reasoning fold under; a turn of words alone has none. */
function hasWork(message: CodingAgentMessage): boolean {
  return message.parts.some((part) => isRecord(part) && isWireString(part.toolCallId));
}

/**
 * The row standing before the oldest turn drawn while older turns stand:
 * the page before it is read as the row scrolls into view, the way a long
 * transcript reads back, or on its press. The row is drawn afresh for each
 * page, so a read that settles while the same row stands left the same
 * older turns standing and did not land; the row then waits for a press
 * rather than asking again on its own.
 */
function EarlierWork({ onLoad }: { onLoad: () => Promise<void> }): React.JSX.Element {
  const row = useRef<HTMLButtonElement>(null);
  const [read, setRead] = useState<EarlierRead>(EARLIER_READ.IDLE);
  const load = useRef(() => {
    setRead(EARLIER_READ.READING);
    const failed = () => setRead(EARLIER_READ.FAILED);
    onLoad().then(failed, failed);
  });

  useEffect(() => {
    const target = row.current;
    if (target === null || read !== EARLIER_READ.IDLE) return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load.current();
    });
    seen.observe(target);
    return () => seen.disconnect();
  }, [read]);

  return (
    <button
      ref={row}
      type="button"
      className="ai-trigger m-0 text-[11.5px] text-muted-foreground"
      disabled={read === EARLIER_READ.READING}
      onClick={() => load.current()}
    >
      <BusyLabel busy={read === EARLIER_READ.READING} label="Loading earlier work">
        {read === EARLIER_READ.FAILED ? (
          <RetryRowLabel failure={EARLIER_LINE[EARLIER_READ.FAILED]} />
        ) : (
          EARLIER_LINE[EARLIER_READ.IDLE]
        )}
      </BusyLabel>
    </button>
  );
}

/** How a turn's work is drawn: what its rows open, when its running workers began, and whether it counts how long it works. */
interface WorkDoors {
  readonly delegation: DelegationDoors;
  /** Whether the tab is on screen, which is when a working turn counts how long it has worked. */
  readonly counting: boolean;
  /** The turn a version's Open asked to bring into view, by its key. */
  readonly revealed: string | undefined;
}

/** One turn's work as one of Luke's messages, its words folded with its work where he said them, ending on the working line while it moves and on how it ended where it did not answer. */
function TurnWork({
  turn,
  spoken,
  doors,
}: {
  turn: WorkTurnRow;
  spoken: boolean;
  doors: WorkDoors;
}): React.JSX.Element | null {
  const { message } = turn;
  const ended = turn.moving || turn.state !== TASK_WORK_STATE.FAILED ? undefined : turn.record;
  const mark = turn.key === doors.revealed ? <span {...{ [REVEAL_MARK]: "" }} /> : null;
  // A turn that only answered in words Luke said aloud has nothing left to draw but where a version's Open lands.
  const drawn = spoken ? hasWork(message) : message.parts.length > 0;
  if (!drawn && !turn.moving && ended === undefined) return mark;
  return (
    <>
      {mark}
      {turn.earlierOmitted ? <TranscriptNote>Earlier steps are not shown.</TranscriptNote> : null}
      <AgentMessage
        message={message}
        plan={false}
        lead={AGENT_LEAD}
        moving={turn.moving}
        delegation={doors.delegation}
        said={spoken}
      />
      {turn.moving ? <WorkingLine startedAt={doors.counting ? turn.startedAt : undefined} /> : null}
      {ended === undefined ? null : (
        <p className="agent-end-line" data-ended="">
          {workFailed(ended) ? ENDED_WORD.FAILED : ENDED_WORD.STOPPED}
        </p>
      )}
    </>
  );
}

/** A call's entries as the thread draws them: each run of one speaker's lines one message, and each turn's work where it stands among them. */
function CallEntries({
  entries,
  doors,
  caller,
}: {
  entries: Extract<ThreadSection<WorkTurnRow>, { kind: typeof THREAD_ITEM.CALL }>["entries"];
  doors: WorkDoors;
  /** The teammate whose call it was, whose lines are drawn under their name and Luke's under his; none for the reader's own. */
  caller: PlanEditor | undefined;
}): React.JSX.Element {
  const teammate = usePerson(caller);
  const drawn: React.JSX.Element[] = [];
  let run: UIMessage[] = [];
  const flush = () => {
    const first = run[0];
    if (first === undefined) return;
    const said = spokenMessage(run);
    drawn.push(
      <AgentMessage
        key={first.id}
        message={said}
        plan={false}
        sender={
          caller === undefined ? undefined : said.role === MESSAGE_ROLE.USER ? teammate : LUKE_ACTOR
        }
        lead={AGENT_LEAD}
        moving={false}
        delegation={undefined}
      />,
    );
    run = [];
  };
  for (const entry of entries) {
    if (entry.kind === THREAD_ITEM.LINE) {
      if (run[0] !== undefined && run[0].role !== entry.line.role) flush();
      run.push(entry.line);
      continue;
    }
    flush();
    drawn.push(
      <TurnWork key={entry.turn.key} turn={entry.turn.turn} spoken={entry.spoken} doors={doors} />,
    );
  }
  flush();
  return <>{drawn}</>;
}

/** One call: the checkpoint it begins at, its lines and the work under them, and once it has ended, the line saying how long it ran (`call-card.tsx`). */
function CallSection({
  call,
  entries,
  now,
  revealed,
  doors,
}: {
  call: TranscriptCallRow;
  entries: Extract<ThreadSection<WorkTurnRow>, { kind: typeof THREAD_ITEM.CALL }>["entries"];
  now: number;
  /** Whether a version's Open asked for this call. */
  revealed: boolean;
  doors: WorkDoors;
}): React.JSX.Element {
  const ended = callEndedLine(call);
  return (
    <>
      {/* Before the checkpoint rather than on it, since a sticky checkpoint stands at the top however far it has scrolled. */}
      {revealed ? <span {...{ [REVEAL_MARK]: "" }} /> : null}
      <CallCheckpoint startedAt={call.startedAt} live={call.live} now={now} caller={call.caller} />
      <CallEntries entries={entries} doors={doors} caller={call.caller} />
      {ended === undefined ? null : (
        <CallEnded line={ended} startedAt={call.startedAt} record={call.record} />
      )}
    </>
  );
}

/** When each running worker's task began, by the call that started it, which its row counts from. */
function workerStarts(rows: readonly WorkTurnRow[]): ReadonlyMap<string, number> {
  return new Map(
    rows.flatMap((turn) =>
      turn.workers.flatMap((worker) =>
        worker.session?.startedAt === undefined ? [] : [[worker.call.id, worker.session.startedAt]],
      ),
    ),
  );
}

/** The turn that was running at `at`: the last to start at or before it, or the first where every turn drawn started after it. */
function turnAt(rows: readonly WorkTurnRow[], at: number): string | undefined {
  return (rows.findLast((row) => row.startedAt <= at) ?? rows[0])?.key;
}

/**
 * Reads older pages of the work while the moment a version's Open asked for
 * is older than every turn drawn and an older page stands, answering whether
 * it is still reading. A page that did not land leaves the page before it
 * where it was, so a read settling with the same page before it is one that
 * failed, and the seeking stops there rather than asking again forever.
 */
function useEarlierUntil(
  at: number | undefined,
  rows: readonly WorkTurnRow[],
  earlier: string | undefined,
  onLoadEarlier: () => Promise<void>,
): boolean {
  const [failedAt, setFailedAt] = useState<string | undefined>(undefined);
  const oldest = rows[0]?.startedAt;
  const seeking =
    at !== undefined &&
    earlier !== undefined &&
    earlier !== failedAt &&
    oldest !== undefined &&
    oldest > at;
  const latest = useRef(onLoadEarlier);
  latest.current = onLoadEarlier;
  useEffect(() => {
    if (!seeking || earlier === undefined) return;
    const settled = () => setFailedAt(earlier);
    latest.current().then(settled, settled);
  }, [seeking, earlier]);
  return seeking;
}

/** The thread's sections, keyed by the call or turn each is. */
function ThreadSections({
  sections,
  now,
  revealCall,
  doors,
}: {
  sections: readonly ThreadSection<WorkTurnRow>[];
  now: number;
  revealCall: string | undefined;
  doors: WorkDoors;
}): React.JSX.Element {
  return (
    <>
      {sections.map((section) =>
        section.kind === THREAD_ITEM.CALL ? (
          <CallSection
            key={section.call.key}
            call={section.call}
            entries={section.entries}
            now={now}
            revealed={section.call.key === revealCall}
            doors={doors}
          />
        ) : (
          <Fragment key={section.turn.key}>
            <TurnWork turn={section.turn.turn} spoken={section.spoken} doors={doors} />
          </Fragment>
        ),
      )}
    </>
  );
}

export function TaskCall({
  region,
  onRetry,
  conversation,
  callLive,
  onLoadEarlier,
  onOpenSubagent,
  onOpenTarget,
  cards,
  shown,
  models,
  reveal,
  video,
}: {
  /** What was said on the task's calls, as the transcript reads it. */
  region: TranscriptRegion;
  onRetry: () => void;
  /** The task's conversation with the brain as an agent's transcript is read, its newest turns and every older page read since; none before the first read lands. */
  conversation: TaskConversation;
  callLive: boolean;
  /** Reads the page before the oldest turn drawn, which the conversation's `earlier` names; the view brings it. */
  onLoadEarlier: () => Promise<void>;
  /** Opens a subagent's session in a tab of the panel's own, or chooses the tab open on it, by the call that started it. */
  onOpenSubagent: (callId: string) => void;
  /** Opens what a call is about in the tab that draws it, as a start's row opens its agent's; none where nothing opens one. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards a subagent's row and a call about an agent hang, as their tabs hang them; none where they hang their hints. */
  cards?: DelegationDoors["cards"];
  /** Whether the tab is on screen, which is when a running turn counts how long it has worked. */
  shown: boolean;
  /** The catalog as last read, which names each subagent's model; none before the first read lands. */
  models?: readonly CatalogModel[] | undefined;
  /** What a version's Open asked to bring into view, and the word that it has. */
  reveal?: CallReveal | undefined;
  /** The call's video, drawn above the thread at the tab's width while Luke's avatar is up. */
  video?: React.ReactNode;
}): React.JSX.Element {
  const rows = workRowsOf(conversation, callLive);
  const earlier = conversation?.earlier;
  const now = Date.now();
  const root = useRef<HTMLElement>(null);
  const at = reveal !== undefined && "at" in reveal ? reveal.at : undefined;
  const seeking = useEarlierUntil(at, rows, earlier, onLoadEarlier);
  // Note that an ask is answered once the transcript has been read, whether or not it holds what was asked for.
  useRevealInLog(root, region.kind !== TRANSCRIPT_REGION.READING && !seeking, reveal?.onRevealed);
  const calls = region.kind === TRANSCRIPT_REGION.READY ? region.calls : [];
  const placed: readonly CallTurn<WorkTurnRow>[] = rows.map((row) => ({
    key: row.key,
    startedAt: row.startedAt,
    asked: row.asked,
    askedAt: row.askedAt,
    spoken: row.spoken,
    turn: row,
  }));
  const doors: WorkDoors = {
    delegation: {
      models,
      // A running worker's row counts how long it has worked while the tab is on screen, as its turn counts.
      starts: shown ? workerStarts(rows) : undefined,
      onOpen: (callId) => onOpenSubagent(callId),
      onOpenTarget,
      cards,
      // A stop names the subagent it stopped by its job, wherever among the turns its start stands.
      jobs: workerJobs(conversation),
    },
    counting: shown,
    revealed: at === undefined ? undefined : turnAt(rows, at),
  };
  const drawn = calls.length > 0 || rows.length > 0 || earlier !== undefined;
  return (
    <section ref={root} className="task-call ph-no-capture" aria-label="Call">
      {video}
      {drawn ? (
        <Conversation>
          {/* No top padding, because a sticky checkpoint would leave what scrolled under it showing in that band; lines fade beneath it. */}
          <ConversationContent className="checkpoint-log scroll-fade pt-0">
            {/* A transcript that could not be read leaves the work standing, and says so above it. */}
            {region.kind === TRANSCRIPT_REGION.FAILED ? (
              <div className="pt-(--section-gap)">
                <ReadFailure line={TRANSCRIPT_FAILED_LINE} onRetry={onRetry} />
              </div>
            ) : null}
            {region.kind === TRANSCRIPT_REGION.READY && region.earlierOmitted ? (
              <TranscriptNote>Earlier lines are not shown.</TranscriptNote>
            ) : null}
            {/* Drawn afresh for each page, which is how a read that did not land is told apart. */}
            {earlier === undefined ? null : <EarlierWork key={earlier} onLoad={onLoadEarlier} />}
            <ThreadSections
              sections={callThread(calls, placed)}
              now={now}
              revealCall={reveal !== undefined && "call" in reveal ? reveal.call : undefined}
              doors={doors}
            />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : region.kind === TRANSCRIPT_REGION.READING ? (
        <ConversationEmptyState>
          <Spinner label="Loading transcript" size={SPINNER_SIZE.REGION} />
        </ConversationEmptyState>
      ) : region.kind === TRANSCRIPT_REGION.FAILED ? (
        <ConversationEmptyState>
          <ReadFailure
            line={TRANSCRIPT_FAILED_LINE}
            onRetry={onRetry}
            place={READ_FAILURE_PLACE.CENTRED}
          />
        </ConversationEmptyState>
      ) : (
        <EmptyState icon={<CallIcon />}>{TRANSCRIPT_EMPTY_LINE}</EmptyState>
      )}
    </section>
  );
}

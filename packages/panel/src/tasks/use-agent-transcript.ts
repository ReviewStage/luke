import type { AgentQueue } from "@repo/features/agent-queue-wire";
import {
  AGENT_CALL_FAILURE,
  type AgentMessagesAnswerView,
  type AgentMessagesParams,
  type AgentTranscriptKey,
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptOlderParams,
} from "@repo/features/agent-view";
import {
  AGENT_LAUNCH,
  AGENT_STATUS,
  type AgentContext,
  type AgentFailure,
  type AgentLaunch,
  type AgentPayer,
  type AgentStatus,
  type AgentSubagentStanding,
  type AgentTranscriptMessage,
  type AgentUsage,
} from "@repo/features/agent-wire";
import type { DeviceLaunchStep } from "@repo/features/device-agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppTranscript } from "@repo/host/app-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askAct } from "../act.js";
import { jsonBytes, PANEL_SPAN, PANEL_SPAN_ATTRIBUTE, recordPanelSpan } from "../panel-spans.js";
import { useHeldRows, useHostRead } from "../use-host-read.js";
import { type AgentRun, agentStillWriting } from "./agent-model.js";

/**
 * use-agent-transcript.ts -- one agent's transcript, or one of its workers', as its tab draws it, from the read the host holds of it on app state.
 *
 * The tab holds its transcript while it is shown (`useHostRead`), and the
 * host follows it and lays every page on app state as it is read
 * (`LIVE_READ.TRANSCRIPT`), the messages that moved crossing alone, so
 * nothing here follows a cursor or keeps a loop. A transcript the host
 * still holds, as one a tab showed lately, draws in the tab's first frame,
 * before anything is read. Older pages are read one at a time as the reader
 * asks for them (`loadOlder`, `agents.transcriptOlder`), each laid before
 * the messages held by the host while they still begin where it was asked.
 * The host's word on the agent is the last page's: its status, with why
 * where its turn failed, which the tab's end line says, what its model's
 * context holds, which the box's ring draws, and when its run and each
 * worker it waits on began, which the working line and a subagent's row
 * count from. A transcript that could not be read says so, with Try again,
 * which reads it anew; the messages held stand meanwhile. Each hold is
 * timed to its first page drawn and to the page that caught it up
 * (`panel-spans.ts`), each told whether the transcript already stood as the
 * hold was taken, which draws with no round trip.
 */

/** How one read is asked at once: the agent, the cursor to read past, and the worker's call where it is a worker's, answered as the view hears it. Copy transcript reads this way. */
export type TranscriptReader = (params: AgentMessagesParams) => Promise<AgentMessagesAnswerView>;

/** How the page below the oldest message held is read and laid: the transcript and where to read below, answered with whether it landed. */
export type TranscriptOlderReader = (
  params: AgentTranscriptOlderParams,
) => Promise<AgentTranscriptOlderAnswer>;

/** The window's own older read, through the act door. */
const windowTranscriptOlder: TranscriptOlderReader = (params) =>
  askAct(ACT_KIND.AGENTS_TRANSCRIPT_OLDER, params);

/** Whether two keys name the same transcript. */
function sameTranscript(one: AgentTranscriptKey, other: AgentTranscriptKey): boolean {
  return one.agentId === other.agentId && one.callId === other.callId;
}

/** What the tab draws of the transcript. */
export interface AgentTranscriptControl {
  messages: readonly AgentTranscriptMessage[];
  /** Why the agent's newest turn failed, as the last page said; nothing while it did not. */
  failure: AgentFailure | undefined;
  /** The host a failed agent's run was lost with, as the last page said; nothing for any other failure. */
  hostLost: { readonly host: string } | undefined;
  /** What the agent has cost over every turn it settled, its workers' included, as the last page said; nothing before one settled. */
  usage: AgentUsage | undefined;
  /** Who pays for the agent, as the last page said; nothing on a worker's, and for an agent from before payers. */
  payer: AgentPayer | undefined;
  /** What the agent's model's context holds as its newest step left it, as the last page said; nothing before a step ended, and on a worker's. */
  context: AgentContext | undefined;
  /** When the run under way began, as the last page said; nothing where it did not, which is where a worker's tab counts from. */
  runStartedAt: number | undefined;
  /** Where the agent, or the worker, stood as the last page said; nothing before one landed. */
  pageStatus: AgentStatus | undefined;
  /** Whether the last page read came back short, so every message written by then past the oldest held is read. */
  caughtUp: boolean;
  /** Whether messages older than the oldest held stand, which `loadOlder` reads. */
  hasOlder: boolean;
  /** Whether an older page is being read. */
  loadingOlder: boolean;
  /** Whether the last older read did not answer, until the next is asked for. */
  olderFailed: boolean;
  /** Reads the page older than the oldest message held and has it laid before them; nothing while one is out or none stands. */
  loadOlder: () => void;
  /** How many pages have been read, which an ask counts from to know a page landed after it. */
  pages: number;
  /** What the agent, or the worker, is titled as the last page said; nothing before one landed or a title did. */
  pageTitle: string | undefined;
  /** The title of each of the agent's workers that has one, by the call that started it, as the last page said; none on a worker's. */
  subagentTitles: ReadonlyMap<string, string>;
  /** When each worker the agent's newest turn still waits on began, by the call that started it, as the last page said; none on a worker's. */
  delegations: ReadonlyMap<string, number>;
  /** Where each of the agent's workers stands, by the call that started it, as its own session reads and the last page said; none on a worker's, and from a service older than it. */
  subagents: ReadonlyMap<string, AgentSubagentStanding>;
  /** The messages queued behind the agent's turn and the queue's pause, as the last page said; none while none is queued, and on a worker's. */
  queue: AgentQueue | undefined;
  /** Where the launch a local agent waits on stands, as the last page said while it still wrote; none for one in the cloud, once the launch's turn opened, once it ended, and on a worker's. */
  launch: AgentLaunch | undefined;
  /** Where the launch of a failed local agent its host settled unstarted stopped, as the last page said; nothing for any other failure. */
  launchStopped: DeviceLaunchStep | undefined;
  /** Whether a read is out, with nothing held yet to draw. */
  reading: boolean;
  /** Whether the transcript could not be read, so the tab offers to try again. */
  failed: boolean;
  /** What the read that did not answer failed with, for the tab to report: the page saying so, with what failed beneath it; nothing while none failed. */
  failedWith: unknown;
  onRetry: () => void;
}

/** No messages, for a transcript not read yet. */
const NO_MESSAGES: readonly AgentTranscriptMessage[] = [];

/** The tab's older read: the transcript it was asked for, the `before` one is out for, and the `before` the last one that did not answer was asked at. */
interface OlderRead {
  readonly transcript: AgentTranscriptKey;
  readonly out: string | undefined;
  readonly failedAt: string | undefined;
}

/**
 * One hold, as it is timed: when it was taken, the pages the transcript had
 * been read for then, whether rows already stood, and which of its two
 * spans ended.
 */
interface HoldTiming {
  readonly startedAt: number;
  readonly pagesAtStart: number;
  readonly held: boolean;
  painted: boolean;
  caughtUp: boolean;
}

/** Ends one of a hold's spans now, measured by the messages held and the transcript that ended it. */
function endHoldSpan(
  name: typeof PANEL_SPAN.TRANSCRIPT_FIRST_PAINT | typeof PANEL_SPAN.TRANSCRIPT_CAUGHT_UP,
  timing: HoldTiming,
  held: AppTranscript,
): void {
  recordPanelSpan({
    name,
    startedAt: timing.startedAt,
    endedAt: Date.now(),
    attributes: () => ({
      [PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]: held.messages.length,
      [PANEL_SPAN_ATTRIBUTE.HELD_BYTES]: jsonBytes(held),
      [PANEL_SPAN_ATTRIBUTE.CACHE_HIT]: timing.held ? 1 : 0,
    }),
  });
}

/** A list the last page said, by the field each entry is keyed by, the very map while the list is the one it was built from. */
function useKeyed<Entry, Value>(
  list: readonly Entry[] | undefined,
  entryOf: (entry: Entry) => readonly [string, Value],
): ReadonlyMap<string, Value> {
  const latest = useRef(entryOf);
  latest.current = entryOf;
  // Note that the host keeps every part of a page that said nothing new, so a list read alike is the very list.
  return useMemo(() => new Map((list ?? []).map((entry) => latest.current(entry))), [list]);
}

export function useAgentTranscript(input: {
  /** Which transcript: the agent's own, or one of its workers' by the call that started it. */
  transcript: AgentTranscriptKey;
  /** Whether the tab is on screen: the panel open on it, on the Tasks tab. */
  shown: boolean;
  /** How an older page is read; the window's own where none is named. */
  older?: TranscriptOlderReader | undefined;
  /** A page said where a worker stands now, and since when, which no list holds; none for an agent, which the task list says. */
  onStatus?: ((agentId: string, run: AgentRun) => void) | undefined;
}): AgentTranscriptControl {
  const { transcript, shown, onStatus } = input;
  // Note that what the host holds is drawn whether shown or not, and held only while shown, so a tab kept behind another stands as it was.
  const { retry } = useHostRead(LIVE_READ.TRANSCRIPT, shown ? transcript : undefined);
  const held = useHeldRows(LIVE_READ.TRANSCRIPT, transcript);
  const word = held?.word;
  const older = input.older ?? windowTranscriptOlder;
  const latest = useRef({ onStatus, older });
  latest.current = { onStatus, older };
  const [olderRead, setOlderRead] = useState<OlderRead>({
    transcript,
    out: undefined,
    failedAt: undefined,
  });
  // Note that another transcript's tab starts from nothing of this one's.
  const ownOlder: OlderRead = sameTranscript(olderRead.transcript, transcript)
    ? olderRead
    : { transcript, out: undefined, failedAt: undefined };
  // The hold standing, as it is timed; none while the tab holds nothing.
  const timing = useRef<HoldTiming | undefined>(undefined);
  const heldNow = useRef(held);
  heldNow.current = held;

  const { agentId, callId } = transcript;
  useEffect(() => {
    if (!shown) return;
    const standing = heldNow.current;
    const timed: HoldTiming = {
      startedAt: Date.now(),
      pagesAtStart: standing?.pages ?? 0,
      // Note that a hold whose transcript already stands is timed as such, so a span with no round trip in it is told apart.
      held: standing !== undefined && standing.pages > 0,
      painted: false,
      caughtUp: false,
    };
    timing.current = timed;
    return () => {
      if (timing.current === timed) timing.current = undefined;
    };
  }, [shown, agentId, callId]);

  // Note that a span ends once the transcript that ends it has been drawn,
  // since this runs after the commit that drew it, and never for a hold let
  // go before its first page landed.
  useEffect(() => {
    const timed = timing.current;
    if (timed === undefined || held === undefined || held.pages === 0) return;
    if (!timed.painted) {
      timed.painted = true;
      endHoldSpan(PANEL_SPAN.TRANSCRIPT_FIRST_PAINT, timed, held);
    }
    // Note that a transcript held before the hold is read past its cursor again, so only a page since says it caught up.
    const read = !timed.held || held.pages > timed.pagesAtStart;
    if (held.word?.caughtUp === true && read && !timed.caughtUp) {
      timed.caughtUp = true;
      endHoldSpan(PANEL_SPAN.TRANSCRIPT_CAUGHT_UP, timed, held);
    }
  }, [held]);

  // A worker's tab hears where the worker stands from its own page, which no list holds.
  useEffect(() => {
    if (shown && word !== undefined) latest.current.onStatus?.(agentId, word);
  }, [shown, word, agentId]);

  const before = held?.before;
  const out = ownOlder.out;
  const loadOlder = useCallback(() => {
    if (before === undefined || out === before) return;
    setOlderRead({ transcript, out: before, failedAt: undefined });
    // Note that an older read that landed stays out until the page it laid arrives, so it is never asked for twice.
    const settle = (answer: AgentTranscriptOlderAnswer) =>
      setOlderRead((was) => {
        if (!sameTranscript(was.transcript, transcript) || was.out !== before) return was;
        if ("failure" in answer) return { transcript, out: undefined, failedAt: before };
        return answer.landed ? was : { transcript, out: undefined, failedAt: undefined };
      });
    latest.current
      .older({ ...transcript, before })
      .then(settle, () => settle({ failure: AGENT_CALL_FAILURE.UNANSWERED }));
  }, [transcript, before, out]);

  const onRetry = useCallback(() => {
    retry();
  }, [retry]);

  const subagentTitles = useKeyed(
    word?.subagentTitles,
    (titled) => [titled.callId, titled.title] as const,
  );
  const delegations = useKeyed(
    word?.delegations,
    (started) => [started.callId, started.startedAt] as const,
  );
  const subagents = useKeyed(word?.subagents, (standing) => [standing.callId, standing] as const);
  const messages = held?.messages ?? NO_MESSAGES;
  const failed = held?.failure !== undefined;
  const writing = word === undefined || agentStillWriting(word.status);
  return {
    messages,
    failure: word?.failureReason,
    hostLost: word?.hostLost,
    usage: word?.usage,
    payer: word?.payer,
    context: word?.context,
    runStartedAt: word?.runStartedAt,
    pageStatus: word?.status,
    caughtUp: word?.caughtUp ?? false,
    hasOlder: before !== undefined,
    // Note that a read is out only while the messages still begin where it was asked, so a newer page that took their place ends it.
    loadingOlder: out !== undefined && out === before,
    olderFailed: ownOlder.failedAt !== undefined && ownOlder.failedAt === before,
    loadOlder,
    pages: held?.pages ?? 0,
    pageTitle: word?.title ?? undefined,
    subagentTitles,
    delegations,
    subagents,
    queue: word?.queue,
    // Note that the page's one launch word is where a start stands while the agent writes and where it stopped once it failed, so a line sent after a failure never reads as the failed step.
    launch: writing ? word?.launch : undefined,
    launchStopped:
      word?.status === AGENT_STATUS.FAILED && word.launch !== AGENT_LAUNCH.WAITING
        ? word.launch
        : undefined,
    reading: shown && !failed && messages.length === 0 && writing,
    failed,
    failedWith: held?.failure,
    onRetry,
  };
}

import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
  type CodingAgentTranscriptKey,
  type CodingAgentTranscriptOlderAnswer,
  type CodingAgentTranscriptOlderParams,
  type CodingAgentTranscriptPage,
} from "@luke/features/coding-agent-view";
import {
  applyMessagesPage,
  type CodingAgentContext,
  type CodingAgentFailure,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSubagentStanding,
  type CodingAgentUsage,
} from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { askAct } from "../act.js";
import { jsonBytes, PANEL_SPAN, PANEL_SPAN_ATTRIBUTE, recordPanelSpan } from "../panel-spans.js";
import { type AgentRun, agentStillWriting } from "./coding-agent-model.js";

/**
 * use-agent-transcript.ts -- one agent's transcript, or one of its workers', or a task's planning worker's, as its tab draws it, pushed to the window page by page while the tab is on screen.
 *
 * The tab holds its transcript's stream open on the act port while it is
 * shown (`codingAgents.transcript`) and closes it when it is not; the host
 * follows the transcript and pushes every page down that stream, so nothing
 * here follows a cursor or keeps a loop. The first page is the
 * transcript's newest, which names where the page older than it is read
 * below, each later one what moved past the last, and each joins the
 * messages held by id. A newest page that does not meet what is held, as
 * one pushed after the tab was away while more was written than a page
 * holds, takes its place. Older pages are read one at a time as the reader
 * asks for them (`loadOlder`, `codingAgents.transcriptOlder`), each put
 * before the messages held in a transition, which a page landing meanwhile
 * goes ahead of. Each page's status is
 * the agent's as the page was read, with why where its turn failed, which
 * the tab's end line says, what its model's context holds, which the box's
 * ring draws, and when its run and each worker it waits on began, which the
 * working line and a subagent's row count from. A page that says the
 * transcript could not be read says so, with Try again, which follows it
 * anew; the messages held stand meanwhile. Each follow is timed to its
 * first page drawn and to the page that caught it up (`panel-spans.ts`),
 * each told whether that first page was the window the host held, which
 * draws with no round trip.
 */

/** How one read is asked at once: the agent, the cursor to read past, and the worker's call where it is a worker's, answered as the view hears it. Copy transcript reads this way. */
export type TranscriptReader = (
  params: CodingAgentMessagesParams,
) => Promise<CodingAgentMessagesAnswerView>;

/**
 * How the window follows a transcript: each page is handed to `hear` as it
 * is pushed, a stream that could not open or broke as a page that could not
 * be read, until the returned call stops it.
 */
export type TranscriptFollower = (
  transcript: CodingAgentTranscriptKey,
  hear: (page: CodingAgentTranscriptPage) => void,
) => () => void;

/** How the page below the oldest message held is read: the transcript and where to read below, answered as the view hears it. */
export type TranscriptOlderReader = (
  params: CodingAgentTranscriptOlderParams,
) => Promise<CodingAgentTranscriptOlderAnswer>;

/** The window's own older read, through the act door. */
export const windowTranscriptOlder: TranscriptOlderReader = (params) =>
  askAct(ACT_KIND.CODING_AGENTS_TRANSCRIPT_OLDER, params);

/** The window's own follower: the transcript's stream, opened through the act door. */
export const windowTranscriptFollower: TranscriptFollower = (transcript, hear) => {
  let stopped = false;
  let stream: AsyncIteratorObject<CodingAgentTranscriptPage> | undefined;
  const following = askAct(ACT_KIND.CODING_AGENTS_TRANSCRIPT, transcript).then(async (opened) => {
    stream = opened;
    // A stream that opened only after the tab let it go is closed at once.
    if (stopped) {
      await opened.return?.(undefined);
      return;
    }
    // A page a read already out hands over after the tab let go is heard by no one.
    for await (const page of opened) {
      if (!stopped) hear(page);
    }
  });
  following.catch(() => {
    if (!stopped) hear({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  });
  return () => {
    stopped = true;
    void stream?.return?.(undefined);
  };
};

/** Whether two keys name the same transcript. */
function sameTranscript(one: CodingAgentTranscriptKey, other: CodingAgentTranscriptKey): boolean {
  return one.agentId === other.agentId && one.callId === other.callId;
}

/** What the tab draws of the transcript. */
export interface AgentTranscriptControl {
  messages: readonly CodingAgentMessage[];
  /** Why the agent's newest turn failed, as the last page said; nothing while it did not. */
  failure: CodingAgentFailure | undefined;
  /** What the agent has cost over every turn it settled, its workers' included, as the last page said; nothing before one settled. */
  usage: CodingAgentUsage | undefined;
  /** What the agent's model's context holds as its newest step left it, as the last page said; nothing before a step ended, and on a worker's. */
  context: CodingAgentContext | undefined;
  /** When the run under way began, as the last page said; nothing where it did not, which is where a worker's tab counts from. */
  runStartedAt: number | undefined;
  /** Where the agent, or the worker, stood as the last page said; nothing before one landed. */
  pageStatus: CodingAgentStatus | undefined;
  /** Whether the last page read came back short, so every message written by then past the oldest held is read. */
  caughtUp: boolean;
  /** Whether messages older than the oldest held stand, which `loadOlder` reads. */
  hasOlder: boolean;
  /** Whether an older page is being read. */
  loadingOlder: boolean;
  /** Whether the last older read did not answer, until the next is asked for. */
  olderFailed: boolean;
  /** Reads the page older than the oldest message held and puts it before them; nothing while one is out or none stands. */
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
  subagents: ReadonlyMap<string, CodingAgentSubagentStanding>;
  /** Whether a read is out, with nothing held yet to draw. */
  reading: boolean;
  /** Whether the last read did not answer, so the tab offers to try again. */
  failed: boolean;
  onRetry: () => void;
}

interface Held {
  transcript: CodingAgentTranscriptKey;
  messages: readonly CodingAgentMessage[];
  failure: CodingAgentFailure | undefined;
  usage: CodingAgentUsage | undefined;
  context: CodingAgentContext | undefined;
  runStartedAt: number | undefined;
  pageStatus: CodingAgentStatus | undefined;
  /** Whether the last page pushed came back short, so every message written by then past the oldest held is held. */
  caughtUp: boolean;
  /** Where the page older than the oldest message held is read below; none where nothing older stands, or before a page landed. */
  before: string | undefined;
  /** The `before` an older read is out for; none while none is. */
  olderOut: string | undefined;
  /** Whether the last older read did not answer. */
  olderFailed: boolean;
  /** How many pages have been pushed, which an ask counts from to know a page landed after it. */
  pages: number;
  pageTitle: string | undefined;
  subagentTitles: ReadonlyMap<string, string>;
  delegations: ReadonlyMap<string, number>;
  subagents: ReadonlyMap<string, CodingAgentSubagentStanding>;
  failed: boolean;
}

function fresh(transcript: CodingAgentTranscriptKey): Held {
  return {
    transcript,
    messages: [],
    failure: undefined,
    usage: undefined,
    context: undefined,
    runStartedAt: undefined,
    pageStatus: undefined,
    caughtUp: false,
    before: undefined,
    olderOut: undefined,
    olderFailed: false,
    pages: 0,
    pageTitle: undefined,
    subagentTitles: new Map(),
    delegations: new Map(),
    subagents: new Map(),
    failed: false,
  };
}

/**
 * The map a page read, or the one held where the page read it alike: each
 * page answers the agent's workers whole, mostly as they stood, and a map
 * kept as it was asks nothing that reads it to be drawn again.
 */
function keptIfSame<V>(
  held: ReadonlyMap<string, V>,
  read: readonly (readonly [string, V])[],
  same: (a: V, b: V) => boolean,
): ReadonlyMap<string, V> {
  const unchanged =
    held.size === read.length &&
    read.every(([key, value]) => {
      const was = held.get(key);
      return was !== undefined && same(was, value);
    });
  return unchanged ? held : new Map(read);
}

/** Whether two readings of a worker say it stands alike. */
function sameStanding(a: CodingAgentSubagentStanding, b: CodingAgentSubagentStanding): boolean {
  return (
    a.callId === b.callId &&
    a.status === b.status &&
    a.model === b.model &&
    a.effort === b.effort &&
    a.startedAt === b.startedAt
  );
}

/**
 * Whether a newest page meets the messages held, so joining it leaves no
 * gap: it holds the whole transcript, or one of the held messages, since
 * both run unbroken to their ends.
 */
function meets(held: readonly CodingAgentMessage[], page: CodingAgentTranscriptPage): boolean {
  if ("failure" in page || page.before === undefined) return true;
  const ids = new Set(page.messages.map((message) => message.id));
  return held.some((message) => ids.has(message.id));
}

/** A page pushed, joined to what is held: its messages by id, and where the agent stands as it says. */
function joined(was: Held, page: CodingAgentTranscriptPage): Held {
  // Note that a transcript the account does not reach draws nothing it held of it, as one the host drew from what it held before access was checked.
  if ("failure" in page) {
    return page.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND
      ? { ...fresh(was.transcript), pages: was.pages, failed: true }
      : { ...was, failed: true };
  }
  // Note that a newest page that does not meet what is held replaces it, older pages and all, rather than leave a gap.
  const replaces =
    page.newest === true && (was.messages.length === 0 || !meets(was.messages, page));
  return {
    ...was,
    messages: replaces ? page.messages : applyMessagesPage(was.messages, page.messages),
    before: replaces ? page.before : was.before,
    olderOut: replaces ? undefined : was.olderOut,
    failure: page.failureReason,
    usage: page.usage,
    context: page.context,
    runStartedAt: page.runStartedAt,
    pageStatus: page.status,
    caughtUp: page.caughtUp,
    pages: was.pages + 1,
    pageTitle: page.title ?? undefined,
    subagentTitles: keptIfSame(
      was.subagentTitles,
      (page.subagentTitles ?? []).map((titled) => [titled.callId, titled.title]),
      Object.is,
    ),
    delegations: keptIfSame(
      was.delegations,
      (page.delegations ?? []).map((started) => [started.callId, started.startedAt]),
      Object.is,
    ),
    subagents: keptIfSame(
      was.subagents,
      (page.subagents ?? []).map((standing) => [standing.callId, standing]),
      sameStanding,
    ),
    failed: false,
  };
}

/**
 * One follow, as it is timed: when it opened, how many readable pages it
 * has heard and the last of them, whether the first was the window the host
 * held, and which of its two spans ended.
 */
interface FollowTiming {
  readonly startedAt: number;
  heard: number;
  page: CodingAgentTranscriptPage | undefined;
  held: boolean;
  painted: boolean;
  caughtUp: boolean;
}

/** Ends one of a follow's spans now, measured by the messages held and the page that ended it. */
function endFollowSpan(
  name: typeof PANEL_SPAN.TRANSCRIPT_FIRST_PAINT | typeof PANEL_SPAN.TRANSCRIPT_CAUGHT_UP,
  timing: FollowTiming,
  messageCount: number,
): void {
  const { page } = timing;
  recordPanelSpan({
    name,
    startedAt: timing.startedAt,
    endedAt: Date.now(),
    attributes: () => ({
      [PANEL_SPAN_ATTRIBUTE.MESSAGE_COUNT]: messageCount,
      [PANEL_SPAN_ATTRIBUTE.PAGE_BYTES]: page === undefined ? 0 : jsonBytes(page),
      [PANEL_SPAN_ATTRIBUTE.CACHE_HIT]: timing.held ? 1 : 0,
    }),
  });
}

export function useAgentTranscript(input: {
  /** Which transcript: the agent's own, one of its workers' by the call that started it, or a task's planning worker's. */
  transcript: CodingAgentTranscriptKey;
  /** Whether the tab is on screen: the panel open on it, on the Tasks tab. */
  shown: boolean;
  follower: TranscriptFollower;
  /** How an older page is read; the window's own where none is named. */
  older?: TranscriptOlderReader | undefined;
  /** A page said where the agent stands now, and since when, which is newer than the list. */
  onStatus: (agentId: string, run: AgentRun) => void;
  /** A page said what the agent is titled now, which the list may have read before the title landed. */
  onTitle: (agentId: string, title: string | null) => void;
}): AgentTranscriptControl {
  const { shown, follower, onStatus, onTitle } = input;
  const [held, setHeld] = useState<Held>(() => fresh(input.transcript));
  // Note that another transcript's tab starts from nothing of this one's.
  const changed = !sameTranscript(held.transcript, input.transcript);
  if (changed) setHeld(fresh(input.transcript));
  // Note that the key is kept as it was while it names the same transcript, so a tab drawn again follows nothing anew.
  const transcript = changed ? input.transcript : held.transcript;
  const [attempt, setAttempt] = useState(0);
  const older = input.older ?? windowTranscriptOlder;
  const latest = useRef({ follower, onStatus, onTitle, older });
  latest.current = { follower, onStatus, onTitle, older };
  // The follow standing, as it is timed; none while the tab follows nothing.
  const timing = useRef<FollowTiming | undefined>(undefined);

  useEffect(() => {
    if (!shown) return;
    const { agentId } = transcript;
    const timed: FollowTiming = {
      startedAt: Date.now(),
      heard: 0,
      page: undefined,
      held: false,
      painted: false,
      caughtUp: false,
    };
    timing.current = timed;
    const stop = latest.current.follower(transcript, (page) => {
      setHeld((was) => (sameTranscript(was.transcript, transcript) ? joined(was, page) : was));
      if ("failure" in page) return;
      // Note that a follow whose first page the host held is timed as such, so a span with no round trip in it is told apart.
      if (timed.heard === 0) timed.held = page.held === true;
      timed.heard += 1;
      timed.page = page;
      latest.current.onStatus(agentId, page);
      latest.current.onTitle(agentId, page.title);
    });
    return () => {
      if (timing.current === timed) timing.current = undefined;
      stop();
    };
  }, [shown, transcript, attempt]);

  // Note that a span ends once the page that ends it has been drawn, since
  // this runs after the commit that joined it, and never for a follow let go
  // before its page landed.
  const messageCount = held.messages.length;
  useEffect(() => {
    const timed = timing.current;
    if (timed === undefined || timed.heard === 0) return;
    if (!timed.painted) {
      timed.painted = true;
      endFollowSpan(PANEL_SPAN.TRANSCRIPT_FIRST_PAINT, timed, messageCount);
    }
    if (held.caughtUp && !timed.caughtUp) {
      timed.caughtUp = true;
      endFollowSpan(PANEL_SPAN.TRANSCRIPT_CAUGHT_UP, timed, messageCount);
    }
  }, [held.pages, held.caughtUp, messageCount]);

  const { before, olderOut } = held;
  const loadOlder = useCallback(() => {
    if (before === undefined || olderOut !== undefined) return;
    setHeld((was) =>
      sameTranscript(was.transcript, transcript) && was.before === before
        ? { ...was, olderOut: before, olderFailed: false }
        : was,
    );
    // Note that an answer is put before the messages only while they still begin where it was asked, so one for a transcript left or replaced since is dropped.
    const settle = (answer: CodingAgentTranscriptOlderAnswer) =>
      setHeld((was) => {
        if (!sameTranscript(was.transcript, transcript) || was.olderOut !== before) return was;
        if ("failure" in answer) return { ...was, olderOut: undefined, olderFailed: true };
        const held = new Set(was.messages.map((message) => message.id));
        return {
          ...was,
          messages: [
            ...answer.messages.filter((message) => !held.has(message.id)),
            ...was.messages,
          ],
          before: answer.before,
          olderOut: undefined,
        };
      });
    // Note that an older page is put before the messages in a transition, so drawing it never holds the window: a page or a keystroke landing meanwhile is drawn first.
    latest.current.older({ ...transcript, before }).then(
      (answer) => startTransition(() => settle(answer)),
      () => settle({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    );
  }, [transcript, before, olderOut]);

  const onRetry = useCallback(() => {
    setHeld((was) => ({ ...was, failed: false }));
    setAttempt((count) => count + 1);
  }, []);

  const writing = held.pageStatus === undefined || agentStillWriting(held.pageStatus);
  return {
    messages: held.messages,
    failure: held.failure,
    usage: held.usage,
    context: held.context,
    runStartedAt: held.runStartedAt,
    pageStatus: held.pageStatus,
    caughtUp: held.caughtUp,
    hasOlder: held.before !== undefined,
    loadingOlder: held.olderOut !== undefined,
    olderFailed: held.olderFailed,
    loadOlder,
    pages: held.pages,
    pageTitle: held.pageTitle,
    subagentTitles: held.subagentTitles,
    delegations: held.delegations,
    subagents: held.subagents,
    reading: shown && !held.failed && held.messages.length === 0 && writing,
    failed: held.failed,
    onRetry,
  };
}

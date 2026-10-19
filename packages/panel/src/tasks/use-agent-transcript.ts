import {
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
  type CodingAgentTranscriptChanged,
  type CodingAgentTranscriptKey,
  TRANSCRIPT_KIND,
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
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActHandle } from "../act.js";
import { appBridge } from "../app-bridge.js";
import { type AgentRun, agentStillWriting } from "./coding-agent-model.js";

/**
 * use-agent-transcript.ts -- one agent's transcript, or one of its workers', or a task's planning worker's, as its tab draws it, pushed to the window page by page while the tab is on screen.
 *
 * The tab follows its transcript while it is shown and lets it go when it
 * is not; main follows it at the host and sends every page to the windows
 * following it on `app:transcript` (`main/ipc/transcript-follow-acts.ts`),
 * so nothing here asks again, holds a cursor, or keeps a loop. The first
 * page is the transcript from its start, each later one what moved past
 * the last, and each joins the messages held by id. Each page's status is
 * the agent's as the page was read, with why where its turn failed, which
 * the tab's end line says, what its model's context holds, which the box's
 * ring draws, and when its run and each worker it waits on began, which the
 * working line and a subagent's row count from. A page that says the
 * transcript could not be read says so, with Try again, which follows it
 * anew; the messages held stand meanwhile.
 */

/** How one read is asked at once: the agent, the cursor to read past, and the worker's call where it is a worker's, answered as the view hears it. Copy transcript reads this way. */
export type TranscriptReader = (
  params: CodingAgentMessagesParams,
) => Promise<CodingAgentMessagesAnswerView>;

/** How the window follows a transcript, lets it go, and hears its pages pushed. */
export interface TranscriptFollower {
  readonly follow: (transcript: CodingAgentTranscriptKey) => void;
  readonly unfollow: (transcript: CodingAgentTranscriptKey) => void;
  /** Hears every transcript page pushed to the window; the returned call stops hearing. */
  readonly onTranscript: (listener: (changed: CodingAgentTranscriptChanged) => void) => () => void;
}

/** The window's own follower: the follow acts out, and `app:transcript` in. */
export function windowTranscriptFollower(acts: Pick<ActHandle, "act">): TranscriptFollower {
  return {
    follow: (transcript) =>
      void acts.act(ACT_KIND.CODING_AGENTS_TRANSCRIPT_FOLLOW, transcript).catch(() => undefined),
    unfollow: (transcript) =>
      void acts.act(ACT_KIND.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, transcript).catch(() => undefined),
    onTranscript: (listener) => appBridge().onTranscript(listener),
  };
}

/** The agent's or task's id a transcript is under. */
function ownerOf(transcript: CodingAgentTranscriptKey): string {
  return transcript.kind === TRANSCRIPT_KIND.AGENT ? transcript.agentId : transcript.taskId;
}

/** Whether two keys name the same transcript. */
function sameTranscript(one: CodingAgentTranscriptKey, other: CodingAgentTranscriptKey): boolean {
  return one.kind === other.kind && ownerOf(one) === ownerOf(other) && one.callId === other.callId;
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
  /** Whether the last page read came back with nothing more on it, so every message written by then is read. */
  caughtUp: boolean;
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
  /** Whether the last page pushed came with nothing more on it, so every message written by then is held. */
  caughtUp: boolean;
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
    pages: 0,
    pageTitle: undefined,
    subagentTitles: new Map(),
    delegations: new Map(),
    subagents: new Map(),
    failed: false,
  };
}

/** A page pushed, joined to what is held: its messages by id, and where the agent stands as it says. */
function joined(was: Held, page: CodingAgentMessagesAnswerView): Held {
  if ("failure" in page) return { ...was, failed: true };
  return {
    ...was,
    messages: applyMessagesPage(was.messages, page.messages),
    failure: page.failureReason,
    usage: page.usage,
    context: page.context,
    runStartedAt: page.runStartedAt,
    pageStatus: page.status,
    caughtUp: page.messages.length === 0,
    pages: was.pages + 1,
    pageTitle: page.title ?? undefined,
    subagentTitles: new Map(
      (page.subagentTitles ?? []).map((titled) => [titled.callId, titled.title]),
    ),
    delegations: new Map(
      (page.delegations ?? []).map((started) => [started.callId, started.startedAt]),
    ),
    subagents: new Map((page.subagents ?? []).map((standing) => [standing.callId, standing])),
    failed: false,
  };
}

export function useAgentTranscript(input: {
  /** Which transcript: the agent's own, one of its workers' by the call that started it, or a task's planning worker's. */
  transcript: CodingAgentTranscriptKey;
  /** Whether the tab is on screen: the panel open on it, on the Tasks tab. */
  shown: boolean;
  follower: TranscriptFollower;
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
  const latest = useRef({ follower, onStatus, onTitle });
  latest.current = { follower, onStatus, onTitle };

  useEffect(() => {
    if (!shown) return;
    const { follower: following } = latest.current;
    const agentId = ownerOf(transcript);
    const stop = following.onTranscript((pushed) => {
      if (!sameTranscript(pushed.transcript, transcript)) return;
      const { page } = pushed;
      setHeld((was) => (sameTranscript(was.transcript, transcript) ? joined(was, page) : was));
      if ("failure" in page) return;
      latest.current.onStatus(agentId, page);
      latest.current.onTitle(agentId, page.title);
    });
    following.follow(transcript);
    return () => {
      stop();
      following.unfollow(transcript);
    };
  }, [shown, transcript, attempt]);

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

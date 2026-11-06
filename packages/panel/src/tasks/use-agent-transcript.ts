import type { AgentQueue } from "@repo/features/agent-queue-wire";
import {
  type AgentMessagesAnswerView,
  type AgentMessagesParams,
  type AgentTranscriptKey,
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptOlderParams,
  agentTranscriptOlderParamsSchema,
  TRANSCRIPT_KIND,
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
import type { DeviceLaunchStep, DeviceLaunchUnstarted } from "@repo/features/device-agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { type AppTranscript, OWN_TRANSCRIPT } from "@repo/host/app-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { askAct } from "../act.js";
import { transcriptQuery, transcriptRetryMutation } from "../live-reads.js";
import { jsonBytes, PANEL_SPAN, PANEL_SPAN_ATTRIBUTE, recordPanelSpan } from "../panel-spans.js";
import { type AgentRun, agentStillWriting } from "./agent-model.js";

export type TranscriptReader = (params: AgentMessagesParams) => Promise<AgentMessagesAnswerView>;

export type TranscriptOlderReader = (
  params: AgentTranscriptOlderParams,
) => Promise<AgentTranscriptOlderAnswer>;

const windowTranscriptOlder: TranscriptOlderReader = (params) =>
  askAct(ACT_KIND.AGENTS_TRANSCRIPT_OLDER, params);

const isOlderParams = Schema.is(agentTranscriptOlderParamsSchema);

function olderKeyOf(transcript: AgentTranscriptKey) {
  return [
    ACT_KIND.AGENTS_TRANSCRIPT_OLDER,
    transcript.agentId,
    transcript.callId ?? OWN_TRANSCRIPT,
  ];
}

function sameTranscript(one: AgentTranscriptKey, other: AgentTranscriptKey): boolean {
  return one.agentId === other.agentId && one.callId === other.callId;
}

export interface AgentTranscriptControl {
  messages: readonly AgentTranscriptMessage[];
  failure: AgentFailure | undefined;
  hostLost: { readonly host: string } | undefined;
  usage: AgentUsage | undefined;
  payer: AgentPayer | undefined;
  context: AgentContext | undefined;
  runStartedAt: number | undefined;
  pageStatus: AgentStatus | undefined;
  caughtUp: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  loadOlder: () => void;
  pages: number;
  pageTitle: string | undefined;
  subagentTitles: ReadonlyMap<string, string>;
  delegations: ReadonlyMap<string, number>;
  subagents: ReadonlyMap<string, AgentSubagentStanding>;
  queue: AgentQueue | undefined;
  launch: AgentLaunch | undefined;
  launchStopped: DeviceLaunchStep | undefined;
  launchUnstarted: DeviceLaunchUnstarted | undefined;
  reading: boolean;
  failed: boolean;
  failedWith: unknown;
  onRetry: () => void;
}

const NO_MESSAGES: readonly AgentTranscriptMessage[] = [];

interface HoldTiming {
  readonly startedAt: number;
  readonly pagesAtStart: number;
  readonly held: boolean;
  painted: boolean;
  caughtUp: boolean;
}

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

function useKeyed<Entry, Value>(
  list: readonly Entry[] | undefined,
  entryOf: (entry: Entry) => readonly [string, Value],
): ReadonlyMap<string, Value> {
  const latest = useRef(entryOf);
  latest.current = entryOf;
  return useMemo(() => new Map((list ?? []).map((entry) => latest.current(entry))), [list]);
}

export function useAgentTranscript(input: {
  transcript: AgentTranscriptKey;
  shown: boolean;
  older?: TranscriptOlderReader | undefined;
  onStatus?: ((agentId: string, run: AgentRun) => void) | undefined;
}): AgentTranscriptControl {
  const { transcript, shown, onStatus } = input;
  const held = useQuery({ ...transcriptQuery(transcript), enabled: shown }).data;
  const { mutate: retry } = useMutation(transcriptRetryMutation());
  const word = held?.word;
  const older = input.older ?? windowTranscriptOlder;
  const latest = useRef({ onStatus, older });
  latest.current = { onStatus, older };
  const olderRead = useMutation({
    mutationKey: olderKeyOf(transcript),
    mutationFn: (params: AgentTranscriptOlderParams) => latest.current.older(params),
  });
  const queryClient = useQueryClient();
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
      held: standing !== undefined && standing.pages > 0,
      painted: false,
      caughtUp: false,
    };
    timing.current = timed;
    return () => {
      if (timing.current === timed) timing.current = undefined;
    };
  }, [shown, agentId, callId]);

  useEffect(() => {
    const timed = timing.current;
    if (timed === undefined || held === undefined || held.pages === 0) return;
    if (!timed.painted) {
      timed.painted = true;
      endHoldSpan(PANEL_SPAN.TRANSCRIPT_FIRST_PAINT, timed, held);
    }
    const read = !timed.held || held.pages > timed.pagesAtStart;
    if (held.word?.caughtUp === true && read && !timed.caughtUp) {
      timed.caughtUp = true;
      endHoldSpan(PANEL_SPAN.TRANSCRIPT_CAUGHT_UP, timed, held);
    }
  }, [held]);

  useEffect(() => {
    if (shown && word !== undefined) latest.current.onStatus?.(agentId, word);
  }, [shown, word, agentId]);

  const before = held?.before;
  const asked = olderRead.variables;
  const askedHere =
    asked !== undefined && sameTranscript(asked, transcript) && asked.before === before;
  const answer = olderRead.data;
  const failedAnswer = answer !== undefined && "failure" in answer;
  const loadingOlder =
    askedHere && (olderRead.isPending || (answer !== undefined && !failedAnswer && answer.landed));
  const olderFailed = askedHere && (olderRead.isError || failedAnswer);
  const { mutate: askOlder } = olderRead;
  const loadOlder = useCallback(() => {
    if (before === undefined || loadingOlder) return;
    const out = queryClient.isMutating({
      mutationKey: olderKeyOf(transcript),
      exact: true,
      predicate: (mutation) => {
        const variables = mutation.state.variables;
        return isOlderParams(variables) && variables.before === before;
      },
    });
    if (out === 0) askOlder({ ...transcript, before });
  }, [askOlder, queryClient, transcript, before, loadingOlder]);

  const { agentId: retriedAgent, callId: retriedCall } = transcript;
  const onRetry = useCallback(() => {
    const kind = TRANSCRIPT_KIND.AGENT;
    retry(
      retriedCall === undefined
        ? { kind, agentId: retriedAgent }
        : { kind, agentId: retriedAgent, callId: retriedCall },
    );
  }, [retry, retriedAgent, retriedCall]);

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
    loadingOlder,
    olderFailed,
    loadOlder,
    pages: held?.pages ?? 0,
    pageTitle: word?.title ?? undefined,
    subagentTitles,
    delegations,
    subagents,
    queue: word?.queue,
    launch: writing ? word?.launch : undefined,
    launchStopped:
      word?.status === AGENT_STATUS.FAILED && word.launch !== AGENT_LAUNCH.WAITING
        ? word.launch
        : undefined,
    launchUnstarted: word?.status === AGENT_STATUS.FAILED ? word.launchUnstarted : undefined,
    reading: shown && !failed && messages.length === 0 && writing,
    failed,
    failedWith: held?.failure,
    onRetry,
  };
}

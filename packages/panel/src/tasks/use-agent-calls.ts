import type { CodingAgentCallsAnswerView } from "@luke/features/coding-agent-view";
import { TASKS_READ } from "@luke/features/tasks-view";
import type { TaskTranscript } from "@luke/features/transcript-wire";
import {
  type CallsRead,
  callOfLine,
  type HeardCall,
  heardCalls,
  TRANSCRIPT_REGION,
  type TranscriptCallRow,
  transcriptRegion,
} from "@luke/voice/transcript-model";
import { callInProgress } from "@luke/voice/voice-view";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCallTranscript, useStandingVoiceView } from "../use-voice-view.js";

/**
 * use-agent-calls.ts -- the calls into one agent as its tab draws them: what the record holds of each, and the call standing now as this window hears it.
 *
 * The record's calls are read when the tab opens, again as a call into the
 * agent ends, and again for a call the agent's transcript names that the
 * read does not hold, or holds unended, which a teammate's call, or a record
 * still catching up with a call's end, leaves; each such call asks once. The
 * call standing is not on record yet, so its words are the voice window's
 * report, held past its end until the record has them
 * (`transcript-model.ts`).
 */

/** One read of the calls into an agent, as the tab asks it. */
export type CallsReader = (agentId: string) => Promise<CodingAgentCallsAnswerView>;

const NOTHING_READ: CallsRead = { status: TASKS_READ.IDLE };

/** Every call into the agent, oldest first, the one heard here among them. */
export function useAgentCalls(input: {
  agentId: string;
  read: CallsReader;
  /** The agent's transcript as held, whose spoken lines name the calls they were said on. */
  messages: readonly { readonly id: string; readonly metadata?: unknown }[];
  /** The reader's own account, whose calls name nobody. */
  readerId: string | undefined;
}): readonly TranscriptCallRow[] {
  const { agentId, messages, readerId } = input;
  const view = useStandingVoiceView();
  const callTranscript = useCallTranscript();
  // Note that only a read that answered is held, so a read out, or one that
  // did not answer, draws the tab nothing new: the calls heard here stand
  // either way, and the next call's end asks again.
  const [read, setRead] = useState<{ agentId: string; transcript: TaskTranscript | undefined }>({
    agentId,
    transcript: undefined,
  });
  const recorded = read.agentId === agentId ? read.transcript : undefined;
  const held: CallsRead =
    recorded === undefined ? NOTHING_READ : { status: TASKS_READ.READY, transcript: recorded };
  const [reads, setReads] = useState(0);
  const latest = useRef(input.read);
  latest.current = input.read;

  useEffect(() => {
    let live = true;
    latest.current(agentId).then((answer) => {
      if (live && !("failure" in answer)) setRead({ agentId, transcript: answer.transcript });
    });
    return () => {
      live = false;
    };
  }, [agentId, reads]);

  // The call heard into this agent, kept past its end until the record has it.
  const [heard, setHeard] = useState<readonly HeardCall[]>([]);
  const call = view.call;
  useEffect(() => {
    setHeard((kept) => {
      const next = heardCalls({
        held: kept,
        voice: { call, callTranscript },
        agentId,
        now: Date.now(),
      });
      // No call heard, as before, draws nothing anew.
      return next.length === 0 && kept.length === 0 ? kept : next;
    });
  }, [call, callTranscript, agentId]);

  // A call into the agent ending is read back from the record.
  const ours = callInProgress(view) && call?.agentId === agentId;
  const stood = useRef(ours);
  useEffect(() => {
    if (stood.current && !ours) setReads((count) => count + 1);
    stood.current = ours;
  }, [ours]);

  // A call the transcript names that the read holds not, or holds unended, asks once.
  const asked = useRef(new Set<string>());
  const recordedCalls = recorded?.calls;
  useEffect(() => {
    const ended = new Map(
      (recordedCalls ?? []).map((each) => [each.id, each.endedAt !== undefined]),
    );
    const live = ours ? callTranscript?.voiceSessionId : undefined;
    const owed = new Set(
      messages.flatMap((message) => {
        const session = callOfLine(message);
        return session === undefined || session === live || ended.get(session) === true
          ? []
          : [session];
      }),
    );
    const fresh = [...owed].filter((session) => !asked.current.has(session));
    if (fresh.length === 0 || recordedCalls === undefined) return;
    for (const session of fresh) asked.current.add(session);
    setReads((count) => count + 1);
  }, [messages, recordedCalls, ours, callTranscript]);

  const lukeEndedCall = view.lukeEndedCall;
  const calls = useMemo(() => {
    const region = transcriptRegion({ transcript: held, heard, lukeEndedCall, readerId });
    return region.kind === TRANSCRIPT_REGION.READY ? region.calls : NO_CALLS;
  }, [held, heard, lukeEndedCall, readerId]);
  return calls;
}

const NO_CALLS: readonly TranscriptCallRow[] = [];

import type { CodingAgentChangesAnswerView } from "@sidecar/hosted/coding-agent-view";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHANGES_READ, type ChangesRead } from "./changes-model";

/**
 * use-agent-changes.ts -- one agent's changes, as its Changes tab draws them: read when the tab first shows, again when the developer asks, and once more as the agent ends.
 *
 * The changes are its pull request's files, read from GitHub afresh by the
 * service on each ask, so nothing here reads on a clock: the tab asks as it
 * first comes on screen, when the developer presses Retry or Refresh, and
 * the moment the agent ends, since that is when what it published has
 * settled. A refresh leaves the files drawn standing until its answer
 * lands; a read that failed says so, with a retry, in their place. An
 * answer for another agent, or one overtaken by a later ask, is dropped.
 */

/** How one read is asked: the agent, answered as the view hears it. */
export type ChangesReader = (agentId: string) => Promise<CodingAgentChangesAnswerView>;

/** What the tab draws, and its one door: read the changes again. */
export interface AgentChangesControl {
  read: ChangesRead;
  /** Whether a read is out while the last answer still stands. */
  refreshing: boolean;
  onRefresh: () => void;
}

/** A read's answer as the tab draws it. */
function readOf(answer: CodingAgentChangesAnswerView): ChangesRead {
  if ("failure" in answer) return { kind: CHANGES_READ.FAILED };
  if ("unavailable" in answer) return { kind: CHANGES_READ.UNAVAILABLE, why: answer.unavailable };
  return { kind: CHANGES_READ.READY, changes: answer.changes };
}

export function useAgentChanges(input: {
  agentId: string;
  /** Whether the tab is on screen. */
  shown: boolean;
  /** Whether the agent has ended, the moment of which reads the changes again. */
  ended: boolean;
  read: ChangesReader;
}): AgentChangesControl {
  const { agentId, shown, ended, read } = input;
  const [held, setHeld] = useState<{ agentId: string; read: ChangesRead }>({
    agentId,
    read: { kind: CHANGES_READ.READING },
  });
  const [out, setOut] = useState(false);
  if (held.agentId !== agentId) setHeld({ agentId, read: { kind: CHANGES_READ.READING } });
  const latest = useRef(read);
  latest.current = read;
  // Every ask is numbered, so only the latest one's answer is drawn.
  const asked = useRef(0);
  const readFor = useRef<{ agentId: string; ended: boolean } | undefined>(undefined);

  const ask = useCallback(() => {
    asked.current += 1;
    const ask = asked.current;
    setOut(true);
    const settle = (next: ChangesRead) => {
      if (ask !== asked.current) return;
      setOut(false);
      setHeld((was) => (was.agentId === agentId ? { agentId, read: next } : was));
    };
    latest.current(agentId).then(
      (answer) => settle(readOf(answer)),
      () => settle({ kind: CHANGES_READ.FAILED }),
    );
  }, [agentId]);

  useEffect(() => {
    if (!shown) return;
    const before = readFor.current;
    if (before !== undefined && before.agentId === agentId && before.ended === ended) return;
    readFor.current = { agentId, ended };
    ask();
  }, [agentId, shown, ended, ask]);

  const onRefresh = useCallback(() => {
    // A failure gives way to the wait at once; files drawn stand until the answer lands.
    setHeld((was) =>
      was.read.kind === CHANGES_READ.READY
        ? was
        : { agentId, read: { kind: CHANGES_READ.READING } },
    );
    ask();
  }, [agentId, ask]);

  const current = held.agentId === agentId ? held.read : { kind: CHANGES_READ.READING };
  return {
    read: current,
    refreshing: out && current.kind === CHANGES_READ.READY,
    onRefresh,
  };
}

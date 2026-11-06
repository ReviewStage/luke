import type { AgentPartView } from "@repo/features/agent-view";
import { ACT_KIND } from "@repo/host/acts";
import type { WireValue } from "@repo/wire";
import { queryOptions, skipToken, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import type { AgentPartCut } from "./agent-model.js";

/**
 * whole-parts.tsx -- a transcript's parts its page carried cut, read whole as the reader opens one.
 *
 * A followed page carries a long command output or thought as its two ends
 * alone (`cutParts`), so a transcript weighs what its words do rather than
 * what every command printed. The part's fold reads the part whole as it
 * opens, through the door the tab hands down, and draws the reading while it
 * waits; a part that grew since, as a thought still streaming does, is read
 * again. A part no door reaches, or whose read fails, stays at its two ends,
 * and so does one whose read answers some other part than the one cut, as
 * an index read across a deploy that retired a tool would.
 */

/** Where a transcript's cut parts are read whole: an agent's, or a worker's under its delegation call. */
export interface WholePartDoor {
  readonly agentId: string;
  readonly callId?: string | undefined;
}

const WholePartsContext = createContext<WholePartDoor | undefined>(undefined);

/** Hands the transcript under it the door its cut parts are read whole through. */
export const WholePartsProvider = WholePartsContext.Provider;

/** The door to an agent's parts, or a worker's where `callId` names the delegation that started it. */
export function useWholePartDoor(agentId: string, callId?: string): WholePartDoor {
  return useMemo(() => ({ agentId, callId }), [agentId, callId]);
}

/**
 * A cut part read whole, as of the size its page said: a part at one size
 * never changes, so a read is held for the window's life, and one that grew
 * is a read of its own. A failed read is answered at once and stays at its
 * two ends.
 */
function wholePartQueryOptions(door: WholePartDoor | undefined, cut: AgentPartCut) {
  const { messageId, index, bytes } = cut;
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_PART, door?.agentId, door?.callId ?? null, messageId, index, bytes],
    queryFn:
      door === undefined
        ? skipToken
        : () =>
            askAct(ACT_KIND.AGENTS_PART, {
              agentId: door.agentId,
              messageId,
              index,
              ...(door.callId === undefined ? undefined : { callId: door.callId }),
            }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Where a cut part's whole read stands: not asked, under way, read, or failed, which leaves it at its ends. */
export const WHOLE_PART = {
  CUT: "cut",
  READING: "reading",
  WHOLE: "whole",
  FAILED: "failed",
} as const;

type WholePartState = (typeof WHOLE_PART)[keyof typeof WHOLE_PART];

/** A cut part as its fold draws it: where its whole read stands, its two ends and size, and what asks for it whole. */
export interface CutBody {
  readonly state: Exclude<WholePartState, typeof WHOLE_PART.WHOLE>;
  readonly bytes: number;
  readonly head: string;
  readonly tail: string;
  /** Asks for the part whole, once: what its fold calls as it opens. */
  readonly onOpen: () => void;
}

/** Where a cut part's whole read stands: a part no door reaches, or whose read fails or answers another part than the one cut, stays at its ends. */
function wholePartRead(
  opened: boolean,
  reachable: boolean,
  whole: UseQueryResult<AgentPartView>,
  isCutPart: (part: WireValue) => boolean,
):
  | { readonly state: Exclude<WholePartState, typeof WHOLE_PART.WHOLE> }
  | { readonly state: typeof WHOLE_PART.WHOLE; readonly part: WireValue } {
  if (!opened) return { state: WHOLE_PART.CUT };
  if (!reachable || whole.isError) return { state: WHOLE_PART.FAILED };
  if (whole.isPending) return { state: WHOLE_PART.READING };
  const answer = whole.data;
  return "part" in answer && isCutPart(answer.part)
    ? { state: WHOLE_PART.WHOLE, part: answer.part }
    : { state: WHOLE_PART.FAILED };
}

/**
 * A cut part's whole read: the part once read, or the body its fold draws
 * until then. Note that a read is held as of the size its page said, so a
 * part that grew since is drawn cut again and read again as its fold stands
 * open.
 */
export function useWholePart(
  cut: AgentPartCut,
  /** Whether a part read is the one cut: the same call, or a thought. */
  isCutPart: (part: WireValue) => boolean,
): { readonly part: WireValue } | { readonly body: CutBody } {
  const door = useContext(WholePartsContext);
  const { bytes } = cut;
  // Note that the fold opened at one size is not opened at another, so a part that grew is drawn cut again.
  const [openedAt, setOpenedAt] = useState<number>();
  const opened = openedAt === bytes;
  const whole = useQuery({
    ...wholePartQueryOptions(door, cut),
    enabled: opened,
  });
  const onOpen = useCallback(() => setOpenedAt(bytes), [bytes]);
  const read = wholePartRead(opened, door !== undefined, whole, isCutPart);
  if (read.state === WHOLE_PART.WHOLE) return { part: read.part };
  return { body: { state: read.state, bytes, head: cut.head, tail: cut.tail, onOpen } };
}

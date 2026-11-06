import type { AgentPartView } from "@repo/features/agent-view";
import { ACT_KIND } from "@repo/host/acts";
import type { WireValue } from "@repo/wire";
import { queryOptions, skipToken, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import type { AgentPartCut } from "./agent-model.js";

export interface WholePartDoor {
  readonly agentId: string;
  readonly callId?: string | undefined;
}

const WholePartsContext = createContext<WholePartDoor | undefined>(undefined);

export const WholePartsProvider = WholePartsContext.Provider;

export function useWholePartDoor(agentId: string, callId?: string): WholePartDoor {
  return useMemo(() => ({ agentId, callId }), [agentId, callId]);
}

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

export const WHOLE_PART = {
  CUT: "cut",
  READING: "reading",
  WHOLE: "whole",
  FAILED: "failed",
} as const;

type WholePartState = (typeof WHOLE_PART)[keyof typeof WHOLE_PART];

export interface CutBody {
  readonly state: Exclude<WholePartState, typeof WHOLE_PART.WHOLE>;
  readonly bytes: number;
  readonly head: string;
  readonly tail: string;
  readonly onOpen: () => void;
}

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

export function useWholePart(
  cut: AgentPartCut,
  isCutPart: (part: WireValue) => boolean,
): { readonly part: WireValue } | { readonly body: CutBody } {
  const door = useContext(WholePartsContext);
  const { bytes } = cut;
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

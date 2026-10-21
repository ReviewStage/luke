import type { CodingAgentPartView } from "@luke/features/coding-agent-view";
import { ACT_KIND } from "@luke/host/acts";
import type { WireValue } from "@luke/wire";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAct } from "../act.js";
import type { AgentPartCut } from "./coding-agent-model.js";

/**
 * whole-parts.tsx -- a transcript's parts its page carried cut, read whole as the reader opens one.
 *
 * A followed page carries a long command output or thought as its two ends
 * alone (`cutParts`), so a transcript weighs what its words do rather than
 * what every command printed. The part's fold reads the part whole as it
 * opens, through the door the tab hands down, and draws the reading while it
 * waits; a part that grew since, as a thought still streaming does, is read
 * again. A part no door reaches, or whose read fails, stays at its two ends.
 */

/** Where a transcript's cut parts are read whole: an agent's, or a worker's under its delegation call. */
export interface WholePartDoor {
  readonly read: (messageId: string, index: number) => Promise<CodingAgentPartView>;
}

const WholePartsContext = createContext<WholePartDoor | undefined>(undefined);

/** Hands the transcript under it the door its cut parts are read whole through. */
export const WholePartsProvider = WholePartsContext.Provider;

/** The door to an agent's parts, or a worker's where `callId` names the delegation that started it. */
export function useWholePartDoor(agentId: string, callId?: string): WholePartDoor {
  const { act } = useAct();
  const read = useCallback(
    (messageId: string, index: number) =>
      act(ACT_KIND.CODING_AGENTS_PART, {
        agentId,
        messageId,
        index,
        ...(callId === undefined ? undefined : { callId }),
      }),
    [act, agentId, callId],
  );
  return useMemo(() => ({ read }), [read]);
}

/** Where a cut part's whole read stands: not asked, under way, read, or failed, which leaves it at its ends. */
export const WHOLE_PART = {
  CUT: "cut",
  READING: "reading",
  WHOLE: "whole",
  FAILED: "failed",
} as const;

type WholePartState = (typeof WHOLE_PART)[keyof typeof WHOLE_PART];

/** A cut part's read, as of the size it was read at. */
type WholePartRead =
  | { readonly bytes: number; readonly state: Exclude<WholePartState, typeof WHOLE_PART.WHOLE> }
  | { readonly bytes: number; readonly state: typeof WHOLE_PART.WHOLE; readonly part: WireValue };

/** A cut part as its fold draws it: where its whole read stands, its two ends and size, and what asks for it whole. */
export interface CutBody {
  readonly state: Exclude<WholePartState, typeof WHOLE_PART.WHOLE>;
  readonly bytes: number;
  readonly head: string;
  readonly tail: string;
  /** Asks for the part whole, once: what its fold calls as it opens. */
  readonly onOpen: () => void;
}

/**
 * A cut part's whole read: the part once read, or the body its fold draws
 * until then. Note that a read is held as of the size its page said, so a
 * part that grew since is drawn cut again and read again as its fold stands
 * open.
 */
export function useWholePart(
  cut: AgentPartCut,
): { readonly part: WireValue } | { readonly body: CutBody } {
  const door = useContext(WholePartsContext);
  const [held, setHeld] = useState<WholePartRead>({ bytes: cut.bytes, state: WHOLE_PART.CUT });
  const read: WholePartRead =
    held.bytes === cut.bytes ? held : { bytes: cut.bytes, state: WHOLE_PART.CUT };
  const { messageId, index, bytes } = cut;
  const unasked = read.state === WHOLE_PART.CUT;
  const onOpen = useCallback(() => {
    if (!unasked) return;
    if (door === undefined) {
      setHeld({ bytes, state: WHOLE_PART.FAILED });
      return;
    }
    setHeld({ bytes, state: WHOLE_PART.READING });
    door.read(messageId, index).then(
      (answer) =>
        setHeld(
          "part" in answer
            ? { bytes, state: WHOLE_PART.WHOLE, part: answer.part }
            : { bytes, state: WHOLE_PART.FAILED },
        ),
      () => setHeld({ bytes, state: WHOLE_PART.FAILED }),
    );
  }, [door, messageId, index, bytes, unasked]);
  if (read.state === WHOLE_PART.WHOLE) return { part: read.part };
  return { body: { state: read.state, bytes, head: cut.head, tail: cut.tail, onOpen } };
}

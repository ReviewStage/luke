import type { Failure } from "@repo/features/failure-remedy";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { MessageFailedMark } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { createContext, type ReactNode, useContext } from "react";
import { failureShown } from "../failure-report.js";

const UNDELIVERED_WORDS = "Not delivered";

const ACT_WORDS = { RETRY: "Retry", EDIT: "Edit", DELETE: "Delete" } as const;

interface SentLineMarks {
  readonly undelivered: ReadonlySet<string>;
  readonly closed: string | undefined;
  readonly unsent: ReadonlySet<string>;
  readonly notes: ReadonlyMap<string, Failure>;
  readonly sending: ReadonlySet<string>;
  readonly retry: (id: string) => void;
  readonly takeBack: (id: string) => void;
  readonly drop: (id: string) => void;
}

const NO_MARKS: SentLineMarks = {
  undelivered: new Set(),
  closed: undefined,
  unsent: new Set(),
  notes: new Map(),
  sending: new Set(),
  retry: () => undefined,
  takeBack: () => undefined,
  drop: () => undefined,
};

const MarksContext = createContext<SentLineMarks>(NO_MARKS);

interface LineCause {
  readonly code: typeof FAILURE_CONDITION.REFUSED | typeof FAILURE_CONDITION.NOT_KEPT;
}

const LINE_CAUSES = {
  [FAILURE_CONDITION.REFUSED]: new Map<string, LineCause>(),
  [FAILURE_CONDITION.NOT_KEPT]: new Map<string, LineCause>(),
} as const;

function lineCause(messageId: string, code: LineCause["code"]): LineCause {
  const kept = LINE_CAUSES[code].get(messageId);
  if (kept !== undefined) return kept;
  const made = { code };
  LINE_CAUSES[code].set(messageId, made);
  return made;
}

export const UndeliveredLines = MarksContext.Provider;

export function useUndeliveredLines(): ReadonlySet<string> {
  return useContext(MarksContext).undelivered;
}

export function useUnsentLines(): ReadonlySet<string> {
  return useContext(MarksContext).unsent;
}

export function useLineSending(messageId: string): boolean {
  return useContext(MarksContext).sending.has(messageId);
}

export function useLineMarked(messageId: string): boolean {
  const marks = useContext(MarksContext);
  return marks.undelivered.has(messageId) || marks.unsent.has(messageId);
}

export function useLineStatus(messageId: string): string | undefined {
  return useLineMarked(messageId) ? UNDELIVERED_WORDS : undefined;
}

export function UndeliveredMark({ messageId }: { messageId: string }): ReactNode {
  const marks = useContext(MarksContext);
  if (marks.undelivered.has(messageId)) {
    return (
      <MessageFailedMark
        label={UNDELIVERED_WORDS}
        reason={marks.closed ?? UNDELIVERED_WORDS}
        groups={[]}
        failure={failureShown({
          surface: FAILURE_SURFACE.AGENT_SEND,
          cause: lineCause(messageId, FAILURE_CONDITION.REFUSED),
          refused: true,
        })}
      />
    );
  }
  if (!marks.unsent.has(messageId)) return null;
  return (
    <MessageFailedMark
      label={UNDELIVERED_WORDS}
      reason={marks.notes.get(messageId)?.text ?? UNDELIVERED_WORDS}
      groups={[
        [
          { label: ACT_WORDS.RETRY, icon: <GLYPH.RETRY />, onSelect: () => marks.retry(messageId) },
          {
            label: ACT_WORDS.EDIT,
            icon: <GLYPH.RENAME />,
            onSelect: () => marks.takeBack(messageId),
          },
        ],
        [
          {
            label: ACT_WORDS.DELETE,
            icon: <GLYPH.DELETE />,
            danger: true,
            onSelect: () => marks.drop(messageId),
          },
        ],
      ]}
      failure={failureShown({
        surface: FAILURE_SURFACE.AGENT_SEND,
        cause: lineCause(messageId, FAILURE_CONDITION.NOT_KEPT),
      })}
    />
  );
}

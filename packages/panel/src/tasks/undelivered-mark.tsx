import { FAILURE_CONDITION, FAILURE_SURFACE } from "@luke/features/shown-failure";
import { FailureNote } from "@luke/ui";
import { createContext, type ReactNode, useContext } from "react";
import { failureShown } from "../failure-report.js";

/**
 * undelivered-mark.tsx -- the quiet mark under a line the developer sent that did not go: "Not delivered" where the agent refused it for good, "Not sent" with Retry where it was refused for now, each a `FailureNote`.
 *
 * A message to an agent whose session has ended is refused, and its box
 * closes on it (`use-agent-composer.ts`). The line stays in the transcript
 * where it went rather than vanishing, its words not drawn again in the
 * closed box, and wears this mark under its bubble, so the developer sees
 * what did not go and carries it on with Continue in new agent. A message
 * refused for now while the developer had already written on in the box
 * keeps its words on its line the same way, and its mark offers Retry,
 * which sends it again where it stands. The note stands directly under the
 * bubble, and the line marked so fades its bubble and its files
 * (`useLineMarked`, `tasks.css`'s `.is-user[data-undelivered]`). The tab hands its transcript the
 * lines so marked (`SentLineMarks`), by the id each was drawn under, and
 * the lines still on their way, whose files are drawn going up.
 */

/** What the marks say. */
const UNDELIVERED_WORDS = "Not delivered";
const UNSENT_WORDS = "Not sent";

/** The lines of a transcript that did not go, by the id each was drawn under, and the Retry of one refused for now. */
interface SentLineMarks {
  /** The lines the agent refused for good. */
  readonly undelivered: ReadonlySet<string>;
  /** The lines refused for now that keep their words, each offering Retry. */
  readonly unsent: ReadonlySet<string>;
  /** The lines on their way, whose row has not been read back yet. */
  readonly sending: ReadonlySet<string>;
  readonly retry: (id: string) => void;
}

const NO_MARKS: SentLineMarks = {
  undelivered: new Set(),
  unsent: new Set(),
  sending: new Set(),
  retry: () => undefined,
};

const MarksContext = createContext<SentLineMarks>(NO_MARKS);

/** What a line that did not go is reported under: its condition, as its code, one for each line. */
interface LineCause {
  readonly code: typeof FAILURE_CONDITION.REFUSED | typeof FAILURE_CONDITION.NOT_KEPT;
}

/**
 * Each line's cause by its id, refused for good or for now, so a line that
 * did not go is a failure of its own and two such lines are two, while one
 * line drawn again is the same.
 */
const LINE_CAUSES = {
  [FAILURE_CONDITION.REFUSED]: new Map<string, LineCause>(),
  [FAILURE_CONDITION.NOT_KEPT]: new Map<string, LineCause>(),
} as const;

/** The cause the line drawn under `messageId` is reported under, kept for it. */
function lineCause(messageId: string, code: LineCause["code"]): LineCause {
  const kept = LINE_CAUSES[code].get(messageId);
  if (kept !== undefined) return kept;
  const made = { code };
  LINE_CAUSES[code].set(messageId, made);
  return made;
}

/** Hands an agent's transcript the lines that did not go. */
export const UndeliveredLines = MarksContext.Provider;

/** The ids of the lines the agent refused for good, none of which is the brief its transcript opens on. */
export function useUndeliveredLines(): ReadonlySet<string> {
  return useContext(MarksContext).undelivered;
}

/** Whether the line drawn under `messageId` is still on its way. */
export function useLineSending(messageId: string): boolean {
  return useContext(MarksContext).sending.has(messageId);
}

/** Whether the line drawn under `messageId` did not go, which its mark says under it and its bubble wears faded. */
export function useLineMarked(messageId: string): boolean {
  const marks = useContext(MarksContext);
  return marks.undelivered.has(messageId) || marks.unsent.has(messageId);
}

/** The mark under a line that did not go; nothing under any other. */
export function UndeliveredMark({ messageId }: { messageId: string }): ReactNode {
  const marks = useContext(MarksContext);
  if (marks.undelivered.has(messageId)) {
    return (
      <FailureNote
        failure={failureShown({
          surface: FAILURE_SURFACE.AGENT_SEND,
          cause: lineCause(messageId, FAILURE_CONDITION.REFUSED),
          refused: true,
        })}
      >
        {UNDELIVERED_WORDS}
      </FailureNote>
    );
  }
  if (!marks.unsent.has(messageId)) return null;
  return (
    <FailureNote
      failure={failureShown({
        surface: FAILURE_SURFACE.AGENT_SEND,
        cause: lineCause(messageId, FAILURE_CONDITION.NOT_KEPT),
      })}
      onRetry={() => marks.retry(messageId)}
    >
      {UNSENT_WORDS}
    </FailureNote>
  );
}

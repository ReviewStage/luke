import { FailureNote } from "@luke/ui";
import { createContext, type ReactNode, useContext } from "react";

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
 * which sends it again where it stands. The tab hands its transcript the
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

/** The mark under a line that did not go; nothing under any other. */
export function UndeliveredMark({ messageId }: { messageId: string }): ReactNode {
  const marks = useContext(MarksContext);
  if (marks.undelivered.has(messageId)) {
    return (
      <div className="agent-undelivered" data-undelivered="">
        <FailureNote>{UNDELIVERED_WORDS}</FailureNote>
      </div>
    );
  }
  if (!marks.unsent.has(messageId)) return null;
  return (
    <div className="agent-undelivered" data-unsent="">
      <FailureNote onRetry={() => marks.retry(messageId)}>{UNSENT_WORDS}</FailureNote>
    </div>
  );
}

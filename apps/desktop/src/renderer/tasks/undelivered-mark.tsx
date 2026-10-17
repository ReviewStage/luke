import { CircleAlertIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";

/**
 * undelivered-mark.tsx -- the quiet mark under a line the developer sent that the agent refused for good: "Not delivered", in the danger red.
 *
 * A message to an agent whose session has ended is refused, and its box
 * closes on it (`use-agent-composer.ts`). The line stays in the transcript
 * where it went rather than vanishing, its words not drawn again in the
 * closed box, and wears this mark under its bubble, so the developer sees
 * what did not go and carries it on with Continue in new agent. The tab
 * hands its transcript the lines so refused (`UndeliveredLines`), by the
 * id each was drawn under.
 */

/** What the mark says. */
const UNDELIVERED_WORDS = "Not delivered";

const UndeliveredContext = createContext<ReadonlySet<string>>(new Set());

/** Hands an agent's transcript the ids of the lines the agent refused for good. */
export const UndeliveredLines = UndeliveredContext.Provider;

/** The mark under a line the agent refused for good; nothing under any other. */
export function UndeliveredMark({ messageId }: { messageId: string }): ReactNode {
  const undelivered = useContext(UndeliveredContext);
  if (!undelivered.has(messageId)) return null;
  return (
    <p className="agent-undelivered" data-undelivered="">
      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {UNDELIVERED_WORDS}
    </p>
  );
}

import type { Failure } from "@repo/features/failure-remedy";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { MessageFailedMark } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { createContext, type ReactNode, useContext } from "react";
import { failureShown } from "../failure-report.js";

/**
 * undelivered-mark.tsx -- the red alert beside a line the developer sent that did not go, and the "Not delivered" its time is led by, as a chat app marks a message that did not go: refused for now, its menu offers Retry, Edit, and Delete; refused for good, it says why.
 *
 * A message refused for now stays in the transcript where it went rather
 * than coming back into the box (`use-agent-composer.ts`), its bubble faded,
 * a red alert at its side (`MessageFailedMark`), and its time led by "Not
 * delivered" in the danger tone (`MessageLine`'s `status`), so one glyph and
 * one word say it without a row of buttons under every such line. The
 * alert's menu is headed by why it did not go and offers Retry, which sends
 * it again as the newest line, Edit, which takes its words back into the
 * box, and Delete, each on that line alone, as a chat app's do. A message
 * to an agent whose session has ended is refused for good, and its box
 * closes on it: its line is marked the same way, its menu saying why with
 * nothing to press, since Continue in new agent carries its words on. The
 * line marked so fades its bubble and its files (`useLineMarked`,
 * `tasks.css`'s `.is-user[data-undelivered]`). The tab hands its transcript
 * the lines so marked (`SentLineMarks`), by the id each was drawn under, and
 * the lines still on their way, whose files are drawn going up.
 */

/** What a line that did not go says, on its time line and as its alert's name. */
const UNDELIVERED_WORDS = "Not delivered";

/** The acts a line refused for now offers, in its alert's menu. */
const ACT_WORDS = { RETRY: "Retry", EDIT: "Edit", DELETE: "Delete" } as const;

/** The lines of a transcript that did not go, by the id each was drawn under, why, and the acts on one refused for now. */
interface SentLineMarks {
  /** The lines the agent refused for good. */
  readonly undelivered: ReadonlySet<string>;
  /** Why the agent refused them for good, the box's own reason as it closed; none while it takes messages. */
  readonly closed: string | undefined;
  /** The lines refused for now, each offering Retry, Edit, and Delete. */
  readonly unsent: ReadonlySet<string>;
  /** Why each line refused for now did not go, by its id. */
  readonly notes: ReadonlyMap<string, Failure>;
  /** The lines on their way, whose row has not been read back yet. */
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

/** The ids of the lines refused for now that keep their words. */
export function useUnsentLines(): ReadonlySet<string> {
  return useContext(MarksContext).unsent;
}

/** Whether the line drawn under `messageId` is still on its way. */
export function useLineSending(messageId: string): boolean {
  return useContext(MarksContext).sending.has(messageId);
}

/** Whether the line drawn under `messageId` did not go, which its mark says beside it and its bubble wears faded. */
export function useLineMarked(messageId: string): boolean {
  const marks = useContext(MarksContext);
  return marks.undelivered.has(messageId) || marks.unsent.has(messageId);
}

/** What the time under a line that did not go is led by; nothing under any other. */
export function useLineStatus(messageId: string): string | undefined {
  return useLineMarked(messageId) ? UNDELIVERED_WORDS : undefined;
}

/** The red alert beside a line that did not go, its menu saying why and offering what mends it; nothing beside any other. */
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

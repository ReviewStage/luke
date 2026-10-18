import { callHeading, useMinute } from "./task-time";

/**
 * sent-time.tsx -- when a line sent to an agent was sent, set after who sent it in the line under its bubble or card: "Dean · Today, 3:42 PM", or the time alone for the reader's own.
 *
 * The words are a finished turn's line's (`WorkedFor`), a call's day and
 * its clock, moving on the window's minute, so a sent message, the plan's
 * card, and the replay card's line under it all say when the same way.
 */

/** When one of the developer's lines was sent, in the words a finished turn's line ends on (`WorkedFor`), after who sent it where anyone is named. */
export function SentTime({ at, named }: { at: number; named: boolean }): React.JSX.Element {
  const now = useMinute();
  return (
    <span className="message-sent-at">
      {named ? <span aria-hidden="true">·</span> : null}
      <time dateTime={new Date(at).toISOString()}>{callHeading(at, now)}</time>
    </span>
  );
}

import { useLayoutEffect, useRef } from "react";
import {
  callHeading,
  followsNewest,
  SPEAKER_LABEL,
  TRANSCRIPT_EMPTY_LINE,
  TRANSCRIPT_REGION,
  type TranscriptCallRow,
  type TranscriptRegion,
} from "./transcript-model";

/**
 * plan-transcript.tsx -- the open plan's Transcript tab: what was said on its calls with Luke, grouped by call, the call standing now growing at the bottom.
 *
 * The list keeps to its newest line while it is scrolled there, so a live
 * call reads like a chat; scrolling up to read an earlier line leaves it
 * where it is until the developer scrolls back down. Every word here is the
 * developer's or Luke's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** One call: its day and time, whether it stands now, and each speaker's turns. */
function TranscriptCall({
  call,
  now,
}: {
  call: TranscriptCallRow;
  now: number;
}): React.JSX.Element {
  return (
    <li className="plan-transcript-call">
      <header className="plan-transcript-call-header">
        <span>{callHeading(call.startedAt, now)}</span>
        {call.live ? <span className="plan-transcript-live">Live</span> : null}
      </header>
      <ol className="plan-transcript-lines">
        {call.lines.map((line) => (
          <li key={line.key} className="plan-transcript-line" data-speaker={line.speaker}>
            <span className="plan-transcript-speaker">{SPEAKER_LABEL[line.speaker]}</span>
            <p className="plan-transcript-text">{line.text}</p>
          </li>
        ))}
      </ol>
    </li>
  );
}

/** The calls, kept scrolled to the newest line while the developer has not scrolled away from it. */
function TranscriptCalls({
  region,
}: {
  region: Extract<TranscriptRegion, { kind: typeof TRANSCRIPT_REGION.READY }>;
}): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // Note that this runs after every render, because a line growing a word
  // changes the height as much as a new line does.
  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  });
  const now = Date.now();
  return (
    <div
      ref={list}
      className="plan-transcript-scroll"
      onScroll={(event) => {
        following.current = followsNewest(event.currentTarget);
      }}
    >
      {region.earlierOmitted ? (
        <p className="plan-transcript-note">Earlier lines are not shown.</p>
      ) : null}
      <ol className="plan-transcript-calls">
        {region.calls.map((call) => (
          <TranscriptCall key={call.key} call={call} now={now} />
        ))}
      </ol>
    </div>
  );
}

export function PlanTranscript({
  region,
  onRetry,
}: {
  region: TranscriptRegion;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <section className="plan-transcript ph-no-capture" aria-label="Transcript">
      {region.kind === TRANSCRIPT_REGION.READY ? (
        <TranscriptCalls region={region} />
      ) : (
        <div
          className="plan-transcript-state"
          aria-busy={region.kind === TRANSCRIPT_REGION.READING}
        >
          {region.kind === TRANSCRIPT_REGION.READING ? <p>Reading the transcript…</p> : null}
          {region.kind === TRANSCRIPT_REGION.EMPTY ? <p>{TRANSCRIPT_EMPTY_LINE}</p> : null}
          {region.kind === TRANSCRIPT_REGION.FAILED ? (
            <>
              <p role="alert">The transcript could not be read.</p>
              <button type="button" className="plan-button" onClick={onRetry}>
                Try again
              </button>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

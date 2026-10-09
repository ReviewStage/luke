import type { UIMessage } from "ai";
import type { Components } from "streamdown";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "../ai-elements/message";
import {
  callHeading,
  messageText,
  speakerLabel,
  TRANSCRIPT_EMPTY_LINE,
  TRANSCRIPT_REGION,
  type TranscriptCallRow,
  type TranscriptRegion,
} from "./transcript-model";

/**
 * plan-transcript.tsx -- the open plan's Transcript tab: what was said on its calls with Luke, grouped by call, the call standing now growing at the bottom.
 *
 * The calls are drawn with the AI Elements components (`../ai-elements/`),
 * each line one of the SDK's messages: the list keeps to its newest line
 * while it is scrolled there, so a live call reads like a chat, and
 * scrolling up to read an earlier line leaves it where it is until the
 * developer scrolls back down. Every word here is the developer's or Luke's,
 * so the root is left out of the screen recording (`ph-no-capture`) as a
 * second line behind the recording's text masking.
 */

/**
 * How spoken words are drawn: as markdown, but never as an image, because
 * an image is a request to wherever its address points the moment the tab
 * opens, and nothing anyone said on a call should make one.
 */
const SPOKEN_COMPONENTS: Components = { img: () => null };

/** One line: who said it, and the words. */
function TranscriptMessage({ message }: { message: UIMessage }): React.JSX.Element {
  return (
    <Message from={message.role}>
      <span className="plan-transcript-speaker" data-speaker={message.role}>
        {speakerLabel(message.role)}
      </span>
      <MessageContent>
        <MessageResponse mode="static" components={SPOKEN_COMPONENTS}>
          {messageText(message)}
        </MessageResponse>
      </MessageContent>
    </Message>
  );
}

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
      <div className="plan-transcript-messages">
        {call.messages.map((message) => (
          <TranscriptMessage key={message.id} message={message} />
        ))}
      </div>
    </li>
  );
}

/** The calls, kept scrolled to the newest line while the developer has not scrolled away from it. */
function TranscriptCalls({
  region,
}: {
  region: Extract<TranscriptRegion, { kind: typeof TRANSCRIPT_REGION.READY }>;
}): React.JSX.Element {
  const now = Date.now();
  // Note that the scroll box has no top padding, because a sticky call
  // header sticks below it and would leave the lines scrolled under it
  // showing in that band; the list carries the room instead. Its sides keep
  // the window's content inset, so the words start under the panel's first tab.
  return (
    <Conversation>
      <ConversationContent className="px-(--content-inset) pt-0">
        {region.earlierOmitted ? (
          <p className="plan-transcript-note">Earlier lines are not shown.</p>
        ) : null}
        <ol className="plan-transcript-calls">
          {region.calls.map((call) => (
            <TranscriptCall key={call.key} call={call} now={now} />
          ))}
        </ol>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
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
        <ConversationEmptyState aria-busy={region.kind === TRANSCRIPT_REGION.READING}>
          {region.kind === TRANSCRIPT_REGION.READING ? (
            <p className="m-0">Reading the transcript…</p>
          ) : null}
          {region.kind === TRANSCRIPT_REGION.EMPTY ? (
            <p className="m-0">{TRANSCRIPT_EMPTY_LINE}</p>
          ) : null}
          {region.kind === TRANSCRIPT_REGION.FAILED ? (
            <>
              <p className="m-0" role="alert">
                The transcript could not be read.
              </p>
              <button type="button" className="toolbar-button" onClick={onRetry}>
                Try again
              </button>
            </>
          ) : null}
        </ConversationEmptyState>
      )}
    </section>
  );
}

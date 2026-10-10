import { WingFace } from "@sidecar/panel";
import { MESSAGE_ROLE } from "@sidecar/wire";
import { Checkpoint } from "../ai-elements/checkpoint";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Message, MessageContent } from "../ai-elements/message";
import { CopyMessageAction } from "./copy-message";
import { TranscriptNote, TranscriptWords } from "./transcript-blocks";
import {
  callHeading,
  messageText,
  type SpeakerTurn,
  speakerLabel,
  speakerTurns,
  TRANSCRIPT_EMPTY_LINE,
  TRANSCRIPT_REGION,
  type TranscriptCallRow,
  type TranscriptRegion,
  turnText,
} from "./transcript-model";

/**
 * plan-transcript.tsx -- the open plan's Transcript tab: what was said on its calls with Luke, one call after another, the call standing now growing at the bottom.
 *
 * The calls are drawn as every transcript is (`transcript-blocks.tsx`
 * over `../ai-elements/`), the Work tab and a coding agent's tab alike:
 * each call begins at a Checkpoint saying its day and time, and whether it
 * stands now; each run of lines from one speaker is one Message, the
 * developer's at the right in a bubble and Luke's at the left under his
 * mark, running the column's width; and a copy of the turn's words waits
 * under it. What is spoken is words alone: what Luke read and ran on the
 * call is the Work tab's. The list keeps to its newest line while it is
 * scrolled there, so a live call reads like a chat, and scrolling up to
 * read an earlier line leaves it where it is until the developer scrolls
 * back down. Every word here is the developer's or Luke's, so the root is
 * left out of the screen recording (`ph-no-capture`) as a second line
 * behind the recording's text masking.
 */

/** What a call's checkpoint says while the call stands. */
const LIVE_LABEL = "Live";

/** Who is speaking, above the turn: Luke under his mark, the developer named for a reader who cannot see which side the bubble is on. */
function Speaker({ role }: { role: SpeakerTurn["role"] }): React.JSX.Element {
  if (role === MESSAGE_ROLE.USER) {
    return <span className="sr-only">{speakerLabel(role)}</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-luke">
      <span className="transcript-luke-mark" aria-hidden="true">
        <WingFace />
      </span>
      <span>{speakerLabel(role)}</span>
    </span>
  );
}

/** One turn: the speaker, each of their lines in a row as markdown, and a copy of them. */
function TranscriptTurn({
  turn,
  copyText,
}: {
  turn: SpeakerTurn;
  copyText: (words: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <Message from={turn.role} data-speaker={turn.role}>
      <Speaker role={turn.role} />
      <MessageContent>
        {turn.messages.map((message) => (
          <TranscriptWords key={message.id} text={messageText(message)} />
        ))}
      </MessageContent>
      <CopyMessageAction words={turnText(turn.messages)} copyText={copyText} />
    </Message>
  );
}

/** One call: the checkpoint it begins at, then each speaker's turns. */
function TranscriptCall({
  call,
  now,
  copyText,
}: {
  call: TranscriptCallRow;
  now: number;
  copyText: (words: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <>
      <Checkpoint
        trailing={
          call.live ? (
            <span className="flex items-center gap-1.5 text-developer">
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {LIVE_LABEL}
            </span>
          ) : null
        }
      >
        {callHeading(call.startedAt, now)}
      </Checkpoint>
      {speakerTurns(call.messages).map((turn) => (
        <TranscriptTurn key={turn.key} turn={turn} copyText={copyText} />
      ))}
    </>
  );
}

/** The calls, kept scrolled to the newest line while the developer has not scrolled away from it. */
function TranscriptCalls({
  region,
  copyText,
}: {
  region: Extract<TranscriptRegion, { kind: typeof TRANSCRIPT_REGION.READY }>;
  copyText: (words: string) => Promise<void>;
}): React.JSX.Element {
  const now = Date.now();
  return (
    <Conversation>
      {/* No top padding, because a sticky checkpoint would leave what scrolled under it showing in that band. */}
      <ConversationContent className="pt-0">
        {region.earlierOmitted ? (
          <TranscriptNote>Earlier lines are not shown.</TranscriptNote>
        ) : null}
        {region.calls.map((call) => (
          <TranscriptCall key={call.key} call={call} now={now} copyText={copyText} />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

export function PlanTranscript({
  region,
  onRetry,
  copyText,
}: {
  region: TranscriptRegion;
  onRetry: () => void;
  /** Puts a turn's words on the clipboard; a refusal rejects. */
  copyText: (words: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <section className="plan-transcript ph-no-capture" aria-label="Transcript">
      {region.kind === TRANSCRIPT_REGION.READY ? (
        <TranscriptCalls region={region} copyText={copyText} />
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

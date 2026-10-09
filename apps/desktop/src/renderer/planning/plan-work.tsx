import { PLAN_WORK_STATE, type PlanWorkTurn } from "@sidecar/hosted/planning-view";
import type { Components } from "streamdown";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { MessageResponse } from "../ai-elements/message";
import { ThinkingDots } from "../thinking-dots";
import { callHeading } from "./transcript-model";
import {
  WORK_BLOCK,
  WORK_EMPTY_LINE,
  type WorkBlock,
  type WorkCallRow,
  type WorkTurnRow,
  workRowsOf,
} from "./work-model";

/**
 * plan-work.tsx -- the open plan's Work tab: what Luke's planning model wrote and ran on the plan's calls, turn by turn, read the way an agent's own transcript reads.
 *
 * Each turn opens under the time it began, and its rows are
 * `work-model.ts`'s: the model's words, its reasoning where it has any, and
 * each call it made as one line that opens onto the call's input and what it
 * answered. Calls next to one another fold under one line once the model
 * has moved on. Everything here is the planning model's or the developer's
 * repository's, a command's output included, so the root is left out of
 * the screen recording (`ph-no-capture`) as a second line behind its text
 * masking.
 */

/** How the model's words are drawn: as markdown, but never as an image, which would be a request to wherever it points. */
const WORDS_COMPONENTS: Components = { img: () => null };

/** What a turn's state says beside its time. */
const TURN_STATE_WORD = {
  [PLAN_WORK_STATE.RUNNING]: "Working",
  [PLAN_WORK_STATE.DONE]: "Done",
  [PLAN_WORK_STATE.FAILED]: "Stopped",
} as const;

/** A call's line: what it did, its subject apart, and its state, opening onto its input and its answer. */
function WorkCall({ call }: { call: WorkCallRow }): React.JSX.Element {
  return (
    <details className="work-call" data-state={call.state}>
      <summary className="work-call-line">
        <span className="work-call-mark" data-running={String(call.running)} aria-hidden="true" />
        <span className="work-call-verb">{call.verb}</span>
        {call.subject === undefined ? null : call.subjectIsCode ? (
          <code className="work-call-subject">{call.subject}</code>
        ) : (
          <span className="work-call-subject">{call.subject}</span>
        )}
      </summary>
      <div className="work-call-body">
        <p className="work-call-heading">Input</p>
        <pre className="work-call-text">{call.input}</pre>
        {call.output === undefined ? null : (
          <>
            <p className="work-call-heading">
              {call.state === PLAN_WORK_STATE.FAILED ? "Error" : "Output"}
            </p>
            <pre className="work-call-text">{call.output}</pre>
          </>
        )}
      </div>
    </details>
  );
}

/** One block of a turn. */
function WorkBlockView({ block }: { block: WorkBlock }): React.JSX.Element {
  switch (block.kind) {
    case WORK_BLOCK.TEXT:
      return (
        <MessageResponse mode="static" components={WORDS_COMPONENTS} className="work-text">
          {block.text}
        </MessageResponse>
      );
    case WORK_BLOCK.REASONING:
      return (
        <details className="work-fold">
          <summary className="work-fold-line">Thought</summary>
          <p className="work-reasoning">{block.text}</p>
        </details>
      );
    case WORK_BLOCK.CALL:
      return <WorkCall call={block.call} />;
    case WORK_BLOCK.WORKER:
      return (
        <div className="work-worker" data-state={block.call.state}>
          <WorkCall call={block.call} />
          {block.call.running ? (
            <p className="work-worker-note">
              <ThinkingDots /> The worker is on it
            </p>
          ) : null}
        </div>
      );
    case WORK_BLOCK.GROUP:
      return (
        <details className="work-fold" open={block.open}>
          <summary className="work-fold-line">
            {block.running ? <ThinkingDots /> : null}
            {block.calls.length === 1 ? "1 tool called" : `${block.calls.length} tools called`}
          </summary>
          <div className="work-fold-body">
            {block.calls.map((call) => (
              <WorkCall key={call.id} call={call} />
            ))}
          </div>
        </details>
      );
    case WORK_BLOCK.FOLDED:
      return (
        <details className="work-fold">
          <summary className="work-fold-line">{block.summary}</summary>
          <div className="work-fold-body">
            {block.blocks.map((inner) => (
              <WorkBlockView key={inner.key} block={inner} />
            ))}
          </div>
        </details>
      );
  }
}

/** One turn: when it began and how far it got, then its blocks. */
function WorkTurn({ turn, now }: { turn: WorkTurnRow; now: number }): React.JSX.Element {
  return (
    <li className="work-turn">
      <header className="work-turn-header">
        <span>{callHeading(turn.startedAt, now)}</span>
        <span className="work-turn-state" data-state={turn.state}>
          {turn.state === PLAN_WORK_STATE.RUNNING ? <ThinkingDots /> : null}
          {TURN_STATE_WORD[turn.state]}
        </span>
      </header>
      {turn.earlierOmitted ? <p className="work-note">Earlier steps are not shown.</p> : null}
      <div className="work-blocks">
        {turn.blocks.map((block) => (
          <WorkBlockView key={block.key} block={block} />
        ))}
      </div>
    </li>
  );
}

export function PlanWork({
  turns,
  callLive,
}: {
  turns: readonly PlanWorkTurn[] | undefined;
  callLive: boolean;
}): React.JSX.Element {
  const rows = workRowsOf(turns, callLive);
  const now = Date.now();
  return (
    <section className="plan-work ph-no-capture" aria-label="Work">
      {rows.length === 0 ? (
        <ConversationEmptyState>
          <p className="m-0">{WORK_EMPTY_LINE}</p>
        </ConversationEmptyState>
      ) : (
        <Conversation>
          <ConversationContent>
            <ol className="work-turns">
              {rows.map((turn) => (
                <WorkTurn key={turn.key} turn={turn} now={now} />
              ))}
            </ol>
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}
    </section>
  );
}

import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_KIND,
  INBOX_REPLY,
  type InboxItem,
  type InboxReplyKind,
} from "@sidecar/hosted/inbox-wire";
import { Fragment, useState } from "react";
import { AgentGlyph } from "./agent-tab";
import { agentTabLabel } from "./coding-agent-model";
import { EMPTY_INBOX_DRAFT, type InboxDraft, inboxReply, settledWords } from "./inbox-model";
import { momentText, sinceText, useMinute } from "./plan-time";
import { cardTitle } from "./tool-call-model";
import { TranscriptWords } from "./transcript-blocks";
import type { CodingAgentsControl } from "./use-coding-agents";
import type { PlanInboxControl } from "./use-plan-inbox";

/**
 * inbox-board.tsx -- the plan's Inbox tab: everything its coding agents need of the developer, one card each, answered in place and handed back to the agent that posted it.
 *
 * A card names the agent that posted it and when, its title, the context
 * the agent wrote in Markdown, and the control its kind asks for: the
 * options of a choice, one perhaps recommended, with room for a note or an
 * answer of the developer's own; Approve and Decline for an approval; a box
 * for an open question; Done and Can't do this for a task the developer does
 * by hand. A card whose agent need not hear back says so, since answering
 * it messages nobody. What waits stands first; what is settled, answered or
 * taken back by its agent, folds under it. The agent's name opens its tab.
 * Every card shows words an agent wrote, so the board is out of the session
 * recording (`ph-no-capture`).
 */

/** What an empty inbox says. */
const NOTHING_WAITS =
  "Nothing waits on you. When a coding agent needs a decision or something done by hand, it lands here instead of in its transcript.";

/** What a card's note box asks for, by the item's kind. */
const NOTE_PLACEHOLDER = {
  [INBOX_KIND.CHOICE]: "Add a note, or answer in your own words",
  [INBOX_KIND.APPROVAL]: "Add a note for the agent (optional)",
  [INBOX_KIND.QUESTION]: "Your answer",
  [INBOX_KIND.TASK]: "Add a note for the agent (optional)",
} as const;

/** The two presses each kind answered by a press offers: the one that holds back, then the one that goes ahead. */
const PRESSES = {
  [INBOX_KIND.APPROVAL]: [
    { reply: INBOX_REPLY.DECLINED, label: "Decline" },
    { reply: INBOX_REPLY.APPROVED, label: "Approve" },
  ],
  [INBOX_KIND.TASK]: [
    { reply: INBOX_REPLY.NOT_DONE, label: "Can't do this" },
    { reply: INBOX_REPLY.DONE, label: "Done" },
  ],
} as const;

/** Who posted the item and when, the name opening the agent's tab. */
function Poster({
  item,
  agent,
  models,
  now,
  onOpenAgent,
}: {
  item: InboxItem;
  agent: CodingAgentSummary | undefined;
  models: CodingAgentsControl["models"];
  now: number;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  return (
    <div className="inbox-asker">
      {agent === undefined ? null : <AgentGlyph agent={agent} />}
      <button type="button" className="inbox-agent" onClick={() => onOpenAgent(item.agentId)}>
        {agent === undefined ? "Coding agent" : agentTabLabel(agent, models)}
      </button>
      <time className="inbox-time" title={momentText(item.postedAt)}>
        {sinceText(item.postedAt, now)}
      </time>
    </div>
  );
}

/** A choice's options, each pressed to pick it, the agent's recommendation marked. */
function ChoiceOptions({
  item,
  draft,
  disabled,
  onDraft,
}: {
  item: InboxItem;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  return (
    <div className="inbox-options">
      {(item.options ?? []).map((option) => {
        const picked = draft.choice === option.label;
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={picked}
            className="inbox-option"
            disabled={disabled}
            onClick={() => onDraft({ ...draft, choice: picked ? undefined : option.label })}
          >
            <span className="inbox-option-label">
              {option.label}
              {item.recommended === option.label ? (
                <span className="inbox-recommended">Recommended</span>
              ) : null}
            </span>
            {option.detail === undefined ? null : (
              <span className="inbox-option-detail">{option.detail}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The presses that send a card: its kind's two where it is answered by a press, Send for the rest. */
function SendPresses({
  item,
  draft,
  sending,
  onAnswer,
}: {
  item: InboxItem;
  draft: InboxDraft;
  sending: boolean;
  onAnswer: (press?: InboxReplyKind) => void;
}): React.JSX.Element {
  if (item.kind === INBOX_KIND.APPROVAL || item.kind === INBOX_KIND.TASK) {
    const [back, ahead] = PRESSES[item.kind];
    return (
      <div className="inbox-presses">
        <button
          type="button"
          className="toolbar-button"
          disabled={sending}
          onClick={() => onAnswer(back.reply)}
        >
          {back.label}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={sending}
          onClick={() => onAnswer(ahead.reply)}
        >
          {ahead.label}
        </button>
      </div>
    );
  }
  const ready = inboxReply(item, draft) !== undefined;
  return (
    <div className="inbox-presses">
      <button
        type="button"
        className="primary-button"
        disabled={sending || !ready}
        onClick={() => onAnswer()}
      >
        {sending ? "Sending…" : "Send to agent"}
      </button>
    </div>
  );
}

/** One item waiting on the developer, answered in place. Note that the card is keyed by the item's revision, so a change of the agent's starts it afresh. */
function OpenCard({
  item,
  agent,
  models,
  now,
  sending,
  note,
  onAnswer,
  onOpenAgent,
}: {
  item: InboxItem;
  agent: CodingAgentSummary | undefined;
  models: CodingAgentsControl["models"];
  now: number;
  sending: boolean;
  note: string | undefined;
  onAnswer: PlanInboxControl["onAnswer"];
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<InboxDraft>(EMPTY_INBOX_DRAFT);
  return (
    <article className="inbox-card" data-item-id={item.id}>
      <Poster item={item} agent={agent} models={models} now={now} onOpenAgent={onOpenAgent} />
      <h3 className="inbox-title">{cardTitle(item.title)}</h3>
      {item.details === undefined || item.details.trim() === "" ? null : (
        <div className="inbox-details">
          <TranscriptWords text={item.details} />
        </div>
      )}
      {item.kind === INBOX_KIND.CHOICE ? (
        <ChoiceOptions item={item} draft={draft} disabled={sending} onDraft={setDraft} />
      ) : null}
      <textarea
        className="plan-field-input inbox-note"
        aria-label={NOTE_PLACEHOLDER[item.kind]}
        placeholder={NOTE_PLACEHOLDER[item.kind]}
        value={draft.note}
        disabled={sending}
        onChange={(event) => setDraft({ ...draft, note: event.target.value })}
      />
      <div className="inbox-foot">
        {note === undefined ? (
          item.needsReply ? null : (
            <p className="inbox-quiet">The agent isn't messaged; it reads this when it checks.</p>
          )
        ) : (
          <p className="inbox-failure" role="alert">
            {note}
          </p>
        )}
        <SendPresses
          item={item}
          draft={draft}
          sending={sending}
          onAnswer={(press) => onAnswer(item, draft, press)}
        />
      </div>
    </article>
  );
}

/** One item settled: what the developer answered, or why its agent took it back. */
function SettledCard({
  item,
  agent,
  models,
  now,
  onOpenAgent,
}: {
  item: InboxItem;
  agent: CodingAgentSummary | undefined;
  models: CodingAgentsControl["models"];
  now: number;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const words = settledWords(item);
  return (
    <article className="inbox-card inbox-card-settled" data-item-id={item.id}>
      <Poster item={item} agent={agent} models={models} now={now} onOpenAgent={onOpenAgent} />
      <h3 className="inbox-title">{cardTitle(item.title)}</h3>
      <p className="inbox-answer">
        <strong>{words.lead}</strong>
        {words.note === undefined ? null : ` · ${words.note}`}
      </p>
    </article>
  );
}

/** The board: what waits on the developer, then what is settled. */
export function InboxBoard({
  control,
  agents,
  onOpenAgent,
}: {
  control: PlanInboxControl;
  agents: CodingAgentsControl;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const now = useMinute();
  const { open, settled } = control.board;
  const agentOf = (item: InboxItem) => agents.agents?.find((agent) => agent.id === item.agentId);
  const empty = open.length === 0 && settled.length === 0;
  return (
    <div className="inbox-board ph-no-capture">
      <header className="inbox-head">
        <h2 className="inbox-heading">Inbox</h2>
        <p className="inbox-count">
          {open.length === 0 ? "Nothing waiting" : `${open.length} waiting on you`}
        </p>
      </header>
      {control.failed ? (
        <p className="side-panel-empty" role="alert">
          The inbox could not be read.{" "}
          <button type="button" className="toolbar-button" onClick={control.onRetry}>
            Try again
          </button>
        </p>
      ) : control.reading ? (
        <p className="side-panel-empty">Reading the inbox…</p>
      ) : empty ? (
        <p className="side-panel-empty">{NOTHING_WAITS}</p>
      ) : null}
      {open.map((item) => (
        <Fragment key={item.id}>
          <OpenCard
            key={item.revision}
            item={item}
            agent={agentOf(item)}
            models={agents.models}
            now={now}
            sending={control.sending.has(item.id)}
            note={control.notes.get(item.id)}
            onAnswer={control.onAnswer}
            onOpenAgent={onOpenAgent}
          />
        </Fragment>
      ))}
      {settled.length === 0 ? null : (
        <details className="inbox-settled">
          <summary>Settled · {settled.length}</summary>
          {settled.map((item) => (
            <SettledCard
              key={item.id}
              item={item}
              agent={agentOf(item)}
              models={agents.models}
              now={now}
              onOpenAgent={onOpenAgent}
            />
          ))}
        </details>
      )}
    </div>
  );
}

import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_KIND,
  INBOX_REPLY,
  type InboxItem,
  type InboxReplyKind,
} from "@sidecar/hosted/inbox-wire";
import { Fragment, useState } from "react";
import { ConversationEmptyState } from "../ai-elements/conversation";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { Plan, PlanContent, PlanHeader, PlanTitle } from "../ai-elements/plan";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { BusyLabel, SPINNER_SIZE, Spinner } from "../spinner";
import { Tooltip } from "../tooltip";
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
 * The tab is drawn from the transcript's own pieces, so an item reads as
 * one more card of the agent's: each open item is a card the shape of the
 * transcript's (`ai-elements/plan.tsx`), naming the agent that posted it
 * and when, its title, the context the agent wrote in Markdown, and the
 * agent composer's box (`ai-elements/prompt-input.tsx`) for the answer.
 * A choice's options stand above the box, one perhaps recommended; an
 * approval and a task are answered by two presses in the box's footer, the
 * one that holds back and the one that goes ahead, as a confirm's are; a
 * question and a choice by the box's own Send. A card whose agent need not
 * hear back says so, since answering it messages nobody. What waits stands
 * first; what is settled, answered or taken back by its agent, folds under
 * one line as a finished turn's steps fold, each a closed card saying what
 * came of it. The tab's own label names it and counts what waits, so no
 * head repeats either. The agent's name opens its tab. Every card shows
 * words an agent wrote, so the board is out of the session recording
 * (`ph-no-capture`).
 */

/** What an empty inbox says. */
const NOTHING_WAITS = "Nothing is waiting on you.";

/** What a card's box asks for, by the item's kind. */
const NOTE_PLACEHOLDER = {
  [INBOX_KIND.CHOICE]: "Add a note, or answer in your own words",
  [INBOX_KIND.APPROVAL]: "Add a note for the agent",
  [INBOX_KIND.QUESTION]: "Your answer",
  [INBOX_KIND.TASK]: "Add a note for the agent",
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

/** What the box's Send is called. */
const SEND = "Send to agent";

/** Who posted the item and when: the agent's mark, its name opening its tab, and how long ago. */
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
    <div className="flex items-center gap-2 px-3 pt-2 text-muted-foreground">
      {agent === undefined ? null : <AgentGlyph agent={agent} />}
      <button
        type="button"
        className="plan-edit-link font-medium"
        onClick={() => onOpenAgent(item.agentId)}
      >
        {agent === undefined ? "Coding agent" : agentTabLabel(agent, models)}
      </button>
      <time
        className="tab-card-time"
        dateTime={new Date(item.postedAt).toISOString()}
        title={momentText(item.postedAt)}
      >
        {sinceText(item.postedAt, now)}
      </time>
    </div>
  );
}

/** A choice's options, each pressed to pick it, the agent's recommendation said after its label. */
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
    <div className="flex flex-col gap-1">
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
            <span>
              <span className="font-medium">{option.label}</span>
              {item.recommended === option.label ? (
                <span className="text-muted-foreground"> · Recommended</span>
              ) : null}
            </span>
            {option.detail === undefined ? null : (
              <span className="text-muted-foreground">{option.detail}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The presses that send a card, in the box's footer: its kind's two where it is answered by a press, Send for the rest. */
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
      <div className="flex shrink-0 gap-(--control-gap)">
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
          <BusyLabel busy={sending} label="Sending">
            {ahead.label}
          </BusyLabel>
        </button>
      </div>
    );
  }
  return (
    <Tooltip label={SEND}>
      <PromptInputSubmit
        aria-label={SEND}
        status={sending ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.READY}
        disabled={sending || inboxReply(item, draft) === undefined}
      />
    </Tooltip>
  );
}

/** One item waiting on the developer, answered in place. */
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
  const pressed = item.kind === INBOX_KIND.APPROVAL || item.kind === INBOX_KIND.TASK;
  return (
    <article
      className="overflow-clip rounded-lg border border-border bg-muted text-[12.5px]"
      data-item-id={item.id}
    >
      <Poster item={item} agent={agent} models={models} now={now} onOpenAgent={onOpenAgent} />
      <div className="flex flex-col gap-2 px-3 pt-1 pb-3 text-[13px] leading-normal">
        <h3 className="m-0 font-medium text-foreground" data-inbox-title="">
          {cardTitle(item.title)}
        </h3>
        {item.details === undefined || item.details.trim() === "" ? null : (
          <div data-inbox-details="">
            <TranscriptWords text={item.details} />
          </div>
        )}
        {item.kind === INBOX_KIND.CHOICE ? (
          <ChoiceOptions item={item} draft={draft} disabled={sending} onDraft={setDraft} />
        ) : null}
        <PromptInput
          // A press answers an approval or a task, so its box's Enter sends nothing.
          onSubmit={() => (pressed ? undefined : onAnswer(item, draft))}
        >
          <PromptInputTextarea
            aria-label={NOTE_PLACEHOLDER[item.kind]}
            placeholder={NOTE_PLACEHOLDER[item.kind]}
            value={draft.note}
            disabled={sending}
            onChange={(event) => setDraft({ ...draft, note: event.currentTarget.value })}
          />
          <PromptInputFooter>
            <PromptInputTools className="px-1 text-[12px] text-muted-foreground">
              {item.needsReply ? null : (
                <span data-inbox-quiet="">Answering doesn't message the agent.</span>
              )}
            </PromptInputTools>
            <SendPresses
              item={item}
              draft={draft}
              sending={sending}
              onAnswer={(press) => onAnswer(item, draft, press)}
            />
          </PromptInputFooter>
        </PromptInput>
        {note === undefined ? null : (
          <p className="agent-note" role="alert">
            {note}
          </p>
        )}
      </div>
    </article>
  );
}

/** One item settled, as a closed card: what came of it before its title, and the note and the item's context inside. */
function SettledCard({
  item,
  agent,
}: {
  item: InboxItem;
  agent: CodingAgentSummary | undefined;
}): React.JSX.Element {
  const words = settledWords(item);
  return (
    <Plan data-item-id={item.id} aria-label={cardTitle(item.title)}>
      <PlanHeader>
        {agent === undefined ? null : <AgentGlyph agent={agent} />}
        <PlanTitle label={words.lead}>{cardTitle(item.title)}</PlanTitle>
      </PlanHeader>
      <PlanContent className="flex flex-col gap-2">
        {words.note === undefined ? null : <p className="m-0">{words.note}</p>}
        {item.details === undefined ? null : (
          <div className="text-muted-foreground">
            <TranscriptWords text={item.details} />
          </div>
        )}
      </PlanContent>
    </Plan>
  );
}

/** The board: what waits on the developer, then what is settled under one fold. */
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
  if (open.length === 0 && settled.length === 0) {
    return (
      <ConversationEmptyState>
        {control.failed ? (
          <>
            <p className="m-0" role="alert">
              The inbox could not be read.
            </p>
            <button type="button" className="toolbar-button" onClick={control.onRetry}>
              Try again
            </button>
          </>
        ) : control.reading ? (
          <Spinner label="Loading inbox" size={SPINNER_SIZE.REGION} />
        ) : (
          <p className="m-0">{NOTHING_WAITS}</p>
        )}
      </ConversationEmptyState>
    );
  }
  return (
    <div className="inbox-board ph-no-capture min-h-0 flex-1 space-y-3 overflow-y-auto pt-(--section-gap) pb-5">
      {open.length === 0 ? (
        <p className="m-0 text-[12.5px] text-muted-foreground">{NOTHING_WAITS}</p>
      ) : null}
      {open.map((item) => (
        // Note that the card is keyed by the item's revision inside, so a change of the agent's starts it afresh.
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
        <Fold className="text-[12.5px]" data-inbox-settled="">
          <FoldSummary className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <FoldChevron />
            <span>Settled · {settled.length}</span>
          </FoldSummary>
          <FoldBody className="flex flex-col gap-2 pt-1">
            {settled.map((item) => (
              <SettledCard key={item.id} item={item} agent={agentOf(item)} />
            ))}
          </FoldBody>
        </Fold>
      )}
      {control.failed ? (
        <p className="agent-note" role="alert">
          The inbox could not be read.{" "}
          <button type="button" className="toolbar-button" onClick={control.onRetry}>
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}

import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  type InboxChoice,
  type InboxField,
  type InboxForm,
  type InboxItem,
  type InboxReadResponse,
  type InboxReplyKind,
  knownBlock,
  knownResponse,
} from "@sidecar/hosted/inbox-wire";
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
import { RetryButton } from "../retry-button";
import { BusyLabel, SPINNER_SIZE, Spinner } from "../spinner";
import { Tooltip } from "../tooltip";
import { AgentGlyph } from "./agent-tab";
import { agentTabLabel, opensOnGitHub } from "./coding-agent-model";
import {
  fieldValueOf,
  type InboxDraft,
  inboxReply,
  settledWords,
  withChoice,
  withValue,
} from "./inbox-model";
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
 * and when, its title, the blocks of context the agent wrote, Markdown as
 * the transcript draws it and a link as the transcript draws one, opened
 * on GitHub alone, and the agent composer's box
 * (`ai-elements/prompt-input.tsx`) for the note. What the item asks for
 * stands between the blocks and the box: a choice's options, one perhaps
 * recommended, pressed one at a time or several where the choice allows; a
 * form's fields, each the control Settings draws for its type; nothing for
 * the rest. An approval, a task, and an item asking nothing are answered
 * by presses in the box's footer, the one that holds back and the one that
 * goes ahead, as a confirm's are; words, a choice, and a form by the box's
 * own Send. A block or a response of a type this build does not know, one
 * a newer service wrote, is drawn as a line naming a newer Luke, so the
 * rest of the inbox still reads. A card whose agent need not hear back
 * says so, since answering it messages nobody. What waits stands first;
 * what is settled, answered or taken back by its agent, folds under one
 * line as a finished turn's steps fold, each a closed card saying what came
 * of it. The tab's own label names it and counts what waits, so no head
 * repeats either. The agent's name opens its tab. Every card shows words an
 * agent wrote, so the board is out of the session recording
 * (`ph-no-capture`).
 */

/** What an empty inbox says. */
const NOTHING_WAITS = "Nothing is waiting on you.";

/** What a card's box asks for, by what the item asks; a text's own placeholder stands where the agent wrote one. */
const NOTE_PLACEHOLDER = {
  [INBOX_RESPONSE.CHOICE]: "Add a note, or answer in your own words",
  [INBOX_RESPONSE.APPROVAL]: "Add a note for the agent",
  [INBOX_RESPONSE.TEXT]: "Your answer",
  [INBOX_RESPONSE.TASK]: "Add a note for the agent",
  [INBOX_RESPONSE.FORM]: "Add a note for the agent",
  [INBOX_RESPONSE.NONE]: "Add a note for the agent",
} as const;

/** The presses each response answered by a press offers: the one that holds back where there is one, then the one that goes ahead. */
const PRESSES = {
  [INBOX_RESPONSE.APPROVAL]: {
    back: { reply: INBOX_REPLY.DECLINED, label: "Decline" },
    ahead: { reply: INBOX_REPLY.APPROVED, label: "Approve" },
  },
  [INBOX_RESPONSE.TASK]: {
    back: { reply: INBOX_REPLY.NOT_DONE, label: "Can't do this" },
    ahead: { reply: INBOX_REPLY.DONE, label: "Done" },
  },
  [INBOX_RESPONSE.NONE]: {
    back: undefined,
    ahead: { reply: INBOX_REPLY.ACKNOWLEDGED, label: "Got it" },
  },
} as const;

/** What a card says of a block or a response this build does not know. */
const NEWER_LUKE = {
  BLOCK: "Open this in a newer Luke to see the rest.",
  RESPONSE: "Answer this in a newer Luke.",
} as const;

/** What the box's Send is called. */
const SEND = "Send to agent";

/** The presses that answer the response in the box's footer, or nothing where its Send does. */
function pressesOf(
  response: InboxReadResponse,
): (typeof PRESSES)[keyof typeof PRESSES] | undefined {
  if (!knownResponse(response)) return undefined;
  switch (response.type) {
    case INBOX_RESPONSE.APPROVAL:
    case INBOX_RESPONSE.TASK:
    case INBOX_RESPONSE.NONE:
      return PRESSES[response.type];
    default:
      return undefined;
  }
}

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

/** A link block: a press where it opens on GitHub, as a transcript's links do, else its label with the address beside it to copy. */
function LinkBlock({
  url,
  label,
  openGitHub,
}: {
  url: string;
  label: string;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  if (opensOnGitHub(url)) {
    return (
      <a
        href={url}
        className="agent-link"
        onClick={(event) => {
          event.preventDefault();
          openGitHub(url);
        }}
      >
        {label}
      </a>
    );
  }
  return (
    <span className="agent-link-inert" title={url}>
      {label} <span className="select-text text-muted-foreground">{url}</span>
    </span>
  );
}

/** The item's context: each block in turn, drawn as its type is, and a line for one this build does not know. */
function Blocks({
  item,
  openGitHub,
}: {
  item: InboxItem;
  openGitHub: (url: string) => void;
}): React.JSX.Element | null {
  if (item.blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-inbox-blocks="">
      {item.blocks.map((block, index) => {
        // Blocks have no key of their own, and are never reordered: a change to an item draws them whole again.
        const key = index;
        if (!knownBlock(block)) {
          return (
            <p key={key} className="m-0 text-muted-foreground" data-inbox-unknown="">
              {NEWER_LUKE.BLOCK}
            </p>
          );
        }
        if (block.type === INBOX_BLOCK.MARKDOWN) {
          return (
            <div key={key} data-inbox-markdown="">
              <TranscriptWords text={block.text} />
            </div>
          );
        }
        return (
          <p key={key} className="m-0" data-inbox-link="">
            <LinkBlock url={block.url} label={block.label} openGitHub={openGitHub} />
          </p>
        );
      })}
    </div>
  );
}

/** A choice's options, each pressed to pick it, the agent's recommendation said after its label; several stay pressed where the choice allows. */
function ChoiceOptions({
  choice,
  draft,
  disabled,
  onDraft,
}: {
  choice: InboxChoice;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const multiple = choice.multiple === true;
  return (
    <div className="flex flex-col gap-1" data-inbox-choice={multiple ? "multiple" : "one"}>
      {choice.options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={draft.choices.includes(option.label)}
          className="inbox-option"
          disabled={disabled}
          onClick={() => onDraft(withChoice(draft, option.label, multiple))}
        >
          <span>
            <span className="font-medium">{option.label}</span>
            {choice.recommended === option.label ? (
              <span className="text-muted-foreground"> · Recommended</span>
            ) : null}
          </span>
          {option.detail === undefined ? null : (
            <span className="text-muted-foreground">{option.detail}</span>
          )}
        </button>
      ))}
      {multiple ? (
        <p className="m-0 text-[12px] text-muted-foreground">Pick any that apply.</p>
      ) : null}
    </div>
  );
}

/** A field's name over or beside its control, saying where it must be filled. */
function FieldName({ field }: { field: InboxField }): React.JSX.Element {
  return (
    <span className="settings-copy">
      <strong>{field.label}</strong>
      {field.required === true ? <small>Required</small> : null}
    </span>
  );
}

/** One field of a form: the control Settings draws for its type, holding what the developer put in it. */
function FormField({
  field,
  draft,
  disabled,
  onDraft,
}: {
  field: InboxField;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const value = fieldValueOf(draft, field.label);
  const set = (next: string | number | boolean | undefined) =>
    onDraft(withValue(draft, field.label, next));
  switch (field.type) {
    case INBOX_FIELD.TEXT:
    case INBOX_FIELD.NUMBER: {
      const number = field.type === INBOX_FIELD.NUMBER;
      return (
        <label className="flex flex-col gap-1" data-inbox-field={field.type}>
          <FieldName field={field} />
          <input
            className="settings-input"
            type={number ? "number" : "text"}
            maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
            value={value === undefined ? "" : String(value)}
            disabled={disabled}
            onChange={(event) => {
              const typed = event.currentTarget.value;
              if (typed === "") return set(undefined);
              const parsed = event.currentTarget.valueAsNumber;
              set(number ? (Number.isFinite(parsed) ? parsed : undefined) : typed);
            }}
          />
        </label>
      );
    }
    case INBOX_FIELD.SELECT:
      return (
        <div className="settings-row settings-row-wrapping" data-inbox-field={field.type}>
          <FieldName field={field} />
          <fieldset className="settings-segments" aria-label={field.label}>
            {(field.options ?? []).map((option) => (
              <button
                key={option}
                type="button"
                className="settings-segment"
                aria-pressed={value === option}
                disabled={disabled}
                onClick={() => set(value === option ? undefined : option)}
              >
                {option}
              </button>
            ))}
          </fieldset>
        </div>
      );
    case INBOX_FIELD.BOOLEAN:
      return (
        <div className="settings-row" data-inbox-field={field.type}>
          <FieldName field={field} />
          <button
            type="button"
            role="switch"
            aria-checked={value === true}
            aria-label={field.label}
            className="switch"
            disabled={disabled}
            onClick={() => set(value !== true)}
          >
            <span className="switch-thumb" />
          </button>
        </div>
      );
  }
}

/** A form's fields, in the agent's order. */
function FormFields({
  form,
  draft,
  disabled,
  onDraft,
}: {
  form: InboxForm;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2" data-inbox-form="">
      {form.fields.map((field) => (
        <FormField
          key={field.label}
          field={field}
          draft={draft}
          disabled={disabled}
          onDraft={onDraft}
        />
      ))}
    </div>
  );
}

/** The presses that send a card, in the box's footer: its response's where it is answered by a press, Send for the rest. */
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
  const presses = pressesOf(item.response);
  if (presses !== undefined) {
    const { back, ahead } = presses;
    return (
      <div className="flex shrink-0 gap-(--control-gap)">
        {back === undefined ? null : (
          <button
            type="button"
            className="toolbar-button"
            disabled={sending}
            onClick={() => onAnswer(back.reply)}
          >
            {back.label}
          </button>
        )}
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

/** What the card's box asks for: the agent's own placeholder on a text, its response's words otherwise. */
function placeholderOf(response: InboxReadResponse): string {
  if (!knownResponse(response)) return "";
  if (response.type === INBOX_RESPONSE.TEXT && response.placeholder !== undefined) {
    return response.placeholder;
  }
  return NOTE_PLACEHOLDER[response.type];
}

/** The controls an item's response puts between its blocks and its box: a choice's options, a form's fields, nothing for the rest. */
function ResponseControls({
  item,
  draft,
  disabled,
  onDraft,
}: {
  item: InboxItem;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element | null {
  const response = item.response;
  if (!knownResponse(response)) return null;
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      return (
        <ChoiceOptions choice={response} draft={draft} disabled={disabled} onDraft={onDraft} />
      );
    case INBOX_RESPONSE.FORM:
      return <FormFields form={response} draft={draft} disabled={disabled} onDraft={onDraft} />;
    default:
      return null;
  }
}

/** One item waiting on the developer, answered in place. */
function OpenCard({
  item,
  agent,
  models,
  now,
  sending,
  note,
  draftOf,
  onDraft,
  onAnswer,
  onOpenAgent,
  openGitHub,
}: {
  item: InboxItem;
  agent: CodingAgentSummary | undefined;
  models: CodingAgentsControl["models"];
  now: number;
  sending: boolean;
  note: string | undefined;
  draftOf: PlanInboxControl["draftOf"];
  onDraft: PlanInboxControl["onDraft"];
  onAnswer: PlanInboxControl["onAnswer"];
  onOpenAgent: (agentId: string) => void;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const draft = draftOf(item);
  const setDraft = (next: InboxDraft) => onDraft(item, next);
  const known = knownResponse(item.response);
  const byPress = pressesOf(item.response) !== undefined;
  const placeholder = placeholderOf(item.response);
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
        <Blocks item={item} openGitHub={openGitHub} />
        <ResponseControls item={item} draft={draft} disabled={sending} onDraft={setDraft} />
        {known ? (
          <PromptInput
            // A press answers an approval, a task, and an item asking nothing, so its box's Enter sends nothing.
            onSubmit={() => (byPress ? undefined : onAnswer(item, draft))}
          >
            <PromptInputTextarea
              aria-label={placeholder}
              placeholder={placeholder}
              maxLength={INBOX_BOUNDS.MAX_NOTE_CHARS}
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
        ) : (
          <p className="m-0 text-muted-foreground" data-inbox-unknown="">
            {NEWER_LUKE.RESPONSE}
          </p>
        )}
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
  openGitHub,
}: {
  item: InboxItem;
  agent: CodingAgentSummary | undefined;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const words = settledWords(item);
  return (
    <Plan data-item-id={item.id} aria-label={cardTitle(item.title)}>
      <PlanHeader>
        {agent === undefined ? null : <AgentGlyph agent={agent} />}
        <PlanTitle label={words.lead}>{cardTitle(item.title)}</PlanTitle>
      </PlanHeader>
      <PlanContent className="flex flex-col gap-2">
        {words.note === undefined ? null : <p className="m-0 whitespace-pre-line">{words.note}</p>}
        {item.blocks.length === 0 ? null : (
          <div className="text-muted-foreground">
            <Blocks item={item} openGitHub={openGitHub} />
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
  openGitHub,
}: {
  control: PlanInboxControl;
  agents: CodingAgentsControl;
  onOpenAgent: (agentId: string) => void;
  /** Opens a link block's page on GitHub, the one address the window opens in the browser. */
  openGitHub: (url: string) => void;
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
            <RetryButton onRetry={control.onRetry} />
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
        <OpenCard
          key={item.id}
          item={item}
          agent={agentOf(item)}
          models={agents.models}
          now={now}
          sending={control.sending.has(item.id)}
          note={control.notes.get(item.id)}
          draftOf={control.draftOf}
          onDraft={control.onDraft}
          onAnswer={control.onAnswer}
          onOpenAgent={onOpenAgent}
          openGitHub={openGitHub}
        />
      ))}
      {settled.length === 0 ? null : (
        <Fold className="text-[12.5px]" data-inbox-settled="">
          <FoldSummary className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <FoldChevron />
            <span>Settled · {settled.length}</span>
          </FoldSummary>
          <FoldBody className="flex flex-col gap-2 pt-1">
            {settled.map((item) => (
              <SettledCard
                key={item.id}
                item={item}
                agent={agentOf(item)}
                openGitHub={openGitHub}
              />
            ))}
          </FoldBody>
        </Fold>
      )}
      {control.failed ? (
        <div className="agent-note agent-failure" role="alert">
          <p className="m-0">The inbox could not be read.</p>
          <RetryButton onRetry={control.onRetry} />
        </div>
      ) : null}
    </div>
  );
}

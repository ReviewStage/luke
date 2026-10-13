import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentBrief,
  type CodingAgentContext,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  type CodingAgentUsage,
  hasWordsOrFiles,
} from "@sidecar/hosted/coding-agent-wire";
import { INTEGRATION_NAME, type IntegrationProvider } from "@sidecar/hosted/integration-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { PlusIcon } from "@sidecar/panel";
import { useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { FailureNote } from "../failure-note";
import { FAILURE_REASON, type Failure } from "../failure-remedy";
import { imageFiles } from "../feedback-images";
import { useIntegrationStatuses } from "../integration-statuses";
import { Tooltip } from "../tooltip";
import { AgentContextRing } from "./agent-context";
import { AgentModelChip } from "./agent-model-chip";
import { ChangesChip, PublishedChip, type PublishedDoors } from "./agent-published";
import { AgentServersButton, type AgentServersControl } from "./agent-servers";
import { lapsedServer } from "./agent-servers-model";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips";
import { readFiles, withFiles } from "./attached-files";
import { DictateButton, DictationStrip } from "./dictation-strip";
import { type SkillSource, useSkillPicker } from "./skill-picker";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentModelControl } from "./use-agent-model";
import { DICTATION_PHASE, useDictation } from "./use-dictation";

/**
 * agent-composer.tsx -- the message box pinned under an agent's transcript: one card, two chips at its foot, one button, and a note under it when a message or a change did not go or a server's sign-in expired.
 *
 * The box is the shared composer card (../ai-elements/prompt-input.tsx),
 * the one the New Plan page draws, at its default type. Its foot is laid
 * out as ChatGPT's and Codex's are: at the left the "+" that attaches
 * files and, once the agent has pushed, the pull request's or the branch's
 * chip, which opens it on GitHub (`agent-published.tsx`); at the right,
 * in this order, the model chip naming what the agent runs on, which opens
 * the menu that changes it for the next step (`agent-model-chip.tsx`),
 * the ring that shows, once a step has ended, how full the agent's model's
 * context is and opens what fills it (`agent-context.tsx`), the
 * microphone, and the round button. The box takes a message to the agent:
 * Enter sends it, Shift+Enter is a new line, and Escape leaves the box. A
 * message sent while a turn runs steers it, so the agent sees it at its
 * next step; sent idle, it opens a new turn. The box reads the same
 * whatever the agent is doing: one size, the same chips, no hint under it,
 * and one placeholder asking for a follow up, since a started agent's
 * conversation opens on its plan or task, because the tab's glyph and the transcript's "Working…"
 * line already say where the agent stands. The one thing that follows the agent's state is
 * the button at the card's right, the way every chat draws it: Send while
 * there are words or files, disabled while there are neither and the agent
 * is idle, and Stop while there are neither and a turn runs, which is the
 * one Stop the tab has. A message that did not go stays in the box with why under the card
 * and what mends it (`../failure-note.tsx`): Retry, which sends it again
 * under the same key, so a send whose answer was lost reaches the agent
 * once, or the GitHub sign-in a refusal needs, after which it is sent again
 * by itself; an agent that takes no message any more keeps the box,
 * disabled, with the reason under it; a change of model that did not take
 * says why in the same place, and with nothing else to say there, a server
 * the agent has on whose sign-in expired is offered to reconnect. The box takes
 * focus as the tab opens unless the developer is typing somewhere else, so
 * opening a tab never takes the caret out of the plan. A draft agent's tab
 * draws the same box over a start rather than a message, asking for the
 * first message of its still empty conversation, and its model chip once
 * the choice it starts on is known.
 *
 * Files go with a message the way every chat takes them: the "+" at the
 * foot's left opens the system's file picker, an image pasted into the box
 * is taken, and files dropped on the card are, each drawn as a chip above
 * the words with its way off (`attached-file-chips.tsx`). A file that
 * cannot come says why under the card while the rest still come
 * (`attached-files.ts`). A message is words, files, or both, as the wire
 * takes it (`hasWordsOrFiles`), so files alone send too.
 *
 * Words can be spoken into the box as well: the microphone left of the
 * round button records in place of the foot's controls until ✓ or Enter sends the clip
 * to be heard and the words land at the caret, or ✕ or Escape drops it
 * (`use-dictation.ts`, `dictation-strip.tsx`). Why a dictation left nothing
 * is said in the same note a file's refusal is.
 *
 * A `/` at the start of a word opens the list of the skills the plan's
 * repository keeps, at the caret, and the one chosen is written into the
 * words as `/name`, drawn as a chip, which the agent loads before it acts
 * (`skill-picker.tsx`).
 */

/** What the box says it takes: the first message of an empty conversation, then a follow up. */
const PLACEHOLDER = {
  FIRST: "Ask to make changes",
  FOLLOW_UP: "Send a follow up",
} as const;

/** The buttons' names, which are their tooltips too. */
const BUTTON = {
  SEND: "Send",
  STOP: "Stop",
  STOPPING: "Stopping…",
  ATTACH: "Attach files",
} as const;

/** Whether a drag carries files, which is all the card takes from one. */
function carriesFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/** Whether the developer is typing somewhere the box must not take focus from: a field or an editor elsewhere. */
function typingElsewhere(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active.isContentEditable
  );
}

export function AgentComposer({
  status,
  composer,
  model,
  models,
  readModels,
  usage,
  servers,
  context,
  brief,
  published,
  doors,
  onStop,
  followsUp,
  keywords = [],
  skills,
}: {
  status: CodingAgentStatus;
  composer: AgentComposerControl;
  /** What the agent runs on and its chip's change; nothing while it is not yet known, which draws no chip. */
  model: AgentModelControl | undefined;
  /** The catalog as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  readModels: () => void;
  /** What the agent has cost, said at the chip's menu's foot; nothing before a turn settled. */
  usage: CodingAgentUsage | undefined;
  /** The MCP servers the agent is handed and their switches. */
  servers: AgentServersControl;
  /** What the agent's model's context holds, which the ring draws; nothing before a step ended, which draws no ring. */
  context?: CodingAgentContext | undefined;
  /** What the agent was handed, which names the brief's part of the context. */
  brief?: CodingAgentBrief | undefined;
  /** What the agent published, once the service has said; nothing before. */
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** Stops the agent; the promise settles once the service has answered. */
  onStop: () => Promise<void>;
  /** Whether the conversation already holds a message, so the box takes a follow up rather than the first. */
  followsUp: boolean;
  /** The words a dictation is likely to say, read off the plan (`dictation-keywords.ts`). */
  keywords?: readonly string[] | undefined;
  /** Where the skills a `/` offers are read from (`skill-picker.tsx`); nothing where the box offers none. */
  skills?: SkillSource | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [stopping, setStopping] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  // How many hand-offs are still being read, during which Send waits, so no
  // message goes without a file the developer already handed the box.
  const [reading, setReading] = useState(0);
  // Note that files are read through a ref, because reading them takes a
  // while and the box they land in is whichever render is current by then.
  const latest = useRef(composer);
  latest.current = composer;
  // Note that Stop stands only once a turn runs, because the service cancels
  // the turn under way and a starting agent has none yet to cancel.
  const stoppable = status === CODING_AGENT_STATUS.RUNNING;
  const closed = composer.closed !== undefined;
  const held = composer.sending || closed;
  const empty = !hasWordsOrFiles(composer.draft.trim(), composer.attachments);
  const showsStop = empty && stoppable && !composer.sending;
  const { act } = useAct();
  const statuses = useIntegrationStatuses();
  // The browser opens on the integration's sign-in, whose outcome the window's return reads.
  const reconnect = (provider: IntegrationProvider) =>
    act(ACT_KIND.INTEGRATIONS_CONNECT, { provider }).then(
      (answer) => ("failure" in answer ? undefined : statuses.signInBegun(provider)),
      () => undefined,
    );
  const lapsed = lapsedServer({ statusOf: statuses.statusOf, disabled: servers.disabled });
  const words =
    composer.closed ?? refusal ?? (composer.note === undefined ? model?.note : undefined);
  const note: Failure | undefined =
    words !== undefined
      ? { reason: FAILURE_REASON.OTHER, text: words }
      : (composer.note ??
        (lapsed === undefined
          ? undefined
          : {
              reason: FAILURE_REASON.RECONNECT_INTEGRATION,
              text: `${INTEGRATION_NAME[lapsed]}'s sign-in expired.`,
              provider: lapsed,
            }));
  // Retry is the composer's own: a change of model that did not take is made again from the chip.
  const retries = note !== undefined && note === composer.note;
  const placeholder = followsUp ? PLACEHOLDER.FOLLOW_UP : PLACEHOLDER.FIRST;

  const dictation = useDictation({
    field,
    draft: () => latest.current.draft,
    setDraft: (next) => latest.current.setDraft(next),
    maxLength: CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS,
    keywords,
    onNote: setRefusal,
  });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  const skillPicker = useSkillPicker({
    field,
    draft: composer.draft,
    setDraft: (next) => latest.current.setDraft(next),
    source: skills,
    maxLength: CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS,
  });

  // The box takes focus as the tab opens, unless the caret is somewhere the developer is typing.
  useEffect(() => {
    if (!typingElsewhere()) field.current?.focus();
  }, []);

  const onFieldKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (dictation.onFieldKey(event)) return;
    if (skillPicker.onKeyDown(event)) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      event.currentTarget.blur();
    }
  };

  const stop = () => {
    setStopping(true);
    onStop().finally(() => setStopping(false));
  };

  const attach = (files: readonly File[]) => {
    if (files.length === 0 || held) return;
    setReading((count) => count + 1);
    readFiles(files)
      .then((read) => {
        // Taken after whatever the box holds as the read lands, so neither a
        // read that landed first nor a chip taken off meanwhile is undone.
        setRefusal(withFiles(latest.current.attachments, read).refusal);
        latest.current.setAttachments((now) => withFiles(now, read).attachments);
      })
      .finally(() => setReading((count) => count - 1));
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is a drop target alone; the keys it hears come from its own field and buttons.
    <div
      className="agent-composer"
      data-status={status}
      data-dropping={dropping ? "" : undefined}
      onDragOver={(event) => {
        if (!carriesFiles(event) || held) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // A drag moving onto one of the card's own children has not left it.
        const into = event.relatedTarget;
        if (!(into instanceof Node && event.currentTarget.contains(into))) setDropping(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        attach(Array.from(event.dataTransfer.files));
      }}
    >
      <PromptInput
        onSubmit={() => {
          setRefusal(undefined);
          composer.send();
        }}
      >
        <AttachedFileChips
          files={attachmentChips(composer.attachments)}
          onRemove={
            held
              ? undefined
              : (index) => {
                  setRefusal(undefined);
                  composer.setAttachments((now) => now.filter((_, at) => at !== index));
                }
          }
        />
        <div className="agent-composer-field">
          {skillPicker.chips}
          <PromptInputTextarea
            ref={field}
            className="ph-no-capture agent-composer-input"
            aria-label="Message to the agent"
            placeholder={placeholder}
            maxLength={CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS}
            value={composer.draft}
            disabled={held}
            readOnly={dictating}
            {...skillPicker.fieldProps}
            onChange={(event) => {
              composer.setDraft(event.currentTarget.value);
              skillPicker.onCaret();
            }}
            onKeyDown={onFieldKey}
            onSelect={skillPicker.onCaret}
            onBlur={skillPicker.onBlur}
            onScroll={skillPicker.onScroll}
            onPaste={(event) => {
              // Only images are taken from the clipboard; text pastes as it always does.
              const pasted = imageFiles(event.clipboardData.files);
              if (pasted.length === 0) return;
              event.preventDefault();
              attach(pasted);
            }}
          />
          {skillPicker.menu}
        </div>
        <PromptInputFooter>
          {dictating ? (
            <DictationStrip dictation={dictation} />
          ) : (
            <>
              <PromptInputTools>
                <Tooltip label={BUTTON.ATTACH}>
                  <button
                    type="button"
                    className="icon-button agent-composer-attach"
                    aria-label={BUTTON.ATTACH}
                    disabled={held}
                    onClick={() => picker.current?.click()}
                  >
                    <PlusIcon />
                  </button>
                </Tooltip>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    const picked = Array.from(event.currentTarget.files ?? []);
                    // Cleared so the same file can be picked again after it was taken off.
                    event.currentTarget.value = "";
                    attach(picked);
                  }}
                />
                <PublishedChip published={published} doors={doors} />
                <ChangesChip published={published} doors={doors} />
              </PromptInputTools>
              <div className="agent-composer-actions">
                {model === undefined ? null : (
                  <AgentModelChip
                    model={model}
                    models={models}
                    readModels={readModels}
                    usage={usage}
                  />
                )}
                <AgentServersButton servers={servers} statuses={statuses} />
                <AgentContextRing context={context} brief={brief} />
                <DictateButton dictation={dictation} disabled={held} />
                {showsStop ? (
                  <Tooltip label={stopping ? BUTTON.STOPPING : BUTTON.STOP}>
                    <PromptInputSubmit
                      type="button"
                      status={
                        stopping ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.STREAMING
                      }
                      aria-label={stopping ? BUTTON.STOPPING : BUTTON.STOP}
                      disabled={stopping}
                      onClick={stop}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip label={BUTTON.SEND}>
                    <PromptInputSubmit
                      aria-label={BUTTON.SEND}
                      status={
                        composer.sending ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.READY
                      }
                      disabled={held || empty || reading > 0}
                    />
                  </Tooltip>
                )}
              </div>
            </>
          )}
        </PromptInputFooter>
      </PromptInput>
      {note !== undefined ? (
        <FailureNote
          failure={note}
          className="agent-note agent-composer-note"
          onRetry={retries ? composer.retry : undefined}
          onRemedy={lapsed === undefined ? undefined : () => reconnect(lapsed)}
        />
      ) : null}
    </div>
  );
}

import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentBrief,
  type CodingAgentContext,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  type CodingAgentUsage,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { PlusIcon } from "@sidecar/panel";
import { useEffect, useRef, useState } from "react";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { imageFiles } from "../feedback-images";
import { Tooltip } from "../tooltip";
import { AgentContextRing } from "./agent-context";
import { AgentModelChip } from "./agent-model-chip";
import { PublishedChip, type PublishedDoors } from "./agent-published";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips";
import { attachFiles } from "./attached-files";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentModelControl } from "./use-agent-model";

/**
 * agent-composer.tsx -- the message box pinned under an agent's transcript: one card, two chips at its foot, one button, and a note under it when a message or a change did not go.
 *
 * The box is the shared composer card (../ai-elements/prompt-input.tsx),
 * the one the New Plan page draws, at its default type. Along its foot's
 * left stand the chips: the model chip naming what the agent runs on,
 * which opens the menu that changes it for the next step
 * (`agent-model-chip.tsx`), beside it, once a step has ended, the ring
 * that shows how full the agent's model's context is and opens what fills
 * it (`agent-context.tsx`), and after them, once the agent has pushed, the
 * pull request's or the branch's chip, which opens it on GitHub
 * (`agent-published.tsx`). The box takes a message to the agent:
 * Enter sends it, Shift+Enter is a new line, and Escape leaves the box. A
 * message sent while a turn runs steers it, so the agent sees it at its
 * next step; sent idle, it opens a new turn. The box reads the same
 * whatever the agent is doing: one size, the same chips, no hint under it,
 * and one placeholder asking for a follow up, since a started agent's
 * conversation opens on its plan or task, because the tab's glyph and the transcript's "Working…"
 * line already say where the agent stands. The one thing that follows the agent's state is
 * the button at the card's right, the way every chat draws it: Send while
 * there are words, disabled while there are none and the agent is idle, and
 * Stop while there are none and a turn runs, which is the one Stop the tab
 * has. A message that did not go stays in the box with why under the card
 * and Retry, which sends it again under the same key, so a send whose
 * answer was lost reaches the agent once; an agent that takes no message
 * any more keeps the box, disabled, with the reason under it; a change of
 * model that did not take says why in the same place. The box takes
 * focus as the tab opens unless the developer is typing somewhere else, so
 * opening a tab never takes the caret out of the plan. A draft agent's tab
 * draws the same box over a start rather than a message, asking for the
 * first message of its still empty conversation, and its model chip once
 * the choice it starts on is known.
 *
 * Files go with a message the way every chat takes them: the "+" left of
 * the button opens the system's file picker, an image pasted into the box
 * is taken, and files dropped on the card are, each drawn as a chip above
 * the words with its way off (`attached-file-chips.tsx`). A file that
 * cannot come says why under the card while the rest still come
 * (`attached-files.ts`). Words still carry every message, so files with no
 * words keep Send disabled and the placeholder asks for a message to send
 * them with.
 */

/** What the box says it takes: the first message of an empty conversation, then a follow up. */
const PLACEHOLDER = {
  FIRST: "Ask to make changes",
  FOLLOW_UP: "Send a follow up",
  FILES: "Add a message to send these files",
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
  context,
  brief,
  published,
  doors,
  onStop,
  followsUp,
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
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [stopping, setStopping] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  // Note that files are read through a ref, because reading them takes a
  // while and the box they land in is whichever render is current by then.
  const latest = useRef(composer);
  latest.current = composer;
  // Note that Stop stands only once a turn runs, because the service cancels
  // the turn under way and a starting agent has none yet to cancel.
  const stoppable = status === CODING_AGENT_STATUS.RUNNING;
  const closed = composer.closed !== undefined;
  const held = composer.sending || closed;
  const empty = composer.draft.trim() === "";
  const showsStop = empty && stoppable && !composer.sending;
  const note = composer.closed ?? refusal ?? composer.note ?? model?.note;
  // Retry is the composer's own: a change of model that did not take is made again from the chip.
  const retries =
    composer.closed === undefined && refusal === undefined && composer.note !== undefined;
  let placeholder: string = followsUp ? PLACEHOLDER.FOLLOW_UP : PLACEHOLDER.FIRST;
  if (composer.attachments.length > 0) placeholder = PLACEHOLDER.FILES;

  // The box takes focus as the tab opens, unless the caret is somewhere the developer is typing.
  useEffect(() => {
    if (!typingElsewhere()) field.current?.focus();
  }, []);

  const onFieldKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    attachFiles(latest.current.attachments, files).then((taken) => {
      latest.current.setAttachments(taken.attachments);
      setRefusal(taken.refusal);
    });
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
                  composer.setAttachments(composer.attachments.filter((_, at) => at !== index));
                }
          }
        />
        <PromptInputTextarea
          ref={field}
          className="ph-no-capture"
          aria-label="Message to the agent"
          placeholder={placeholder}
          maxLength={CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS}
          value={composer.draft}
          disabled={held}
          onChange={(event) => composer.setDraft(event.currentTarget.value)}
          onKeyDown={onFieldKey}
          onPaste={(event) => {
            // Only images are taken from the clipboard; text pastes as it always does.
            const pasted = imageFiles(event.clipboardData.files);
            if (pasted.length === 0) return;
            event.preventDefault();
            attach(pasted);
          }}
        />
        <PromptInputFooter>
          <PromptInputTools>
            {model === undefined ? null : (
              <AgentModelChip model={model} models={models} readModels={readModels} usage={usage} />
            )}
            <AgentContextRing context={context} brief={brief} />
            <PublishedChip published={published} doors={doors} />
          </PromptInputTools>
          <div className="agent-composer-actions">
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
            {showsStop ? (
              <Tooltip label={stopping ? BUTTON.STOPPING : BUTTON.STOP}>
                <PromptInputSubmit
                  type="button"
                  status={stopping ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.STREAMING}
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
                  disabled={held || empty}
                />
              </Tooltip>
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
      {note !== undefined ? (
        <p className="agent-note agent-composer-note" role="alert">
          <span>{note}</span>
          {retries ? (
            <button type="button" className="toolbar-button" onClick={composer.retry}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

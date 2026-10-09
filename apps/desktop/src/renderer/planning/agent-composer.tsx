import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import { useEffect, useRef, useState } from "react";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { Tooltip } from "../tooltip";
import type { AgentComposerControl } from "./use-agent-composer";

/**
 * agent-composer.tsx -- the message box pinned under an agent's transcript: one card, one button, and a note under it when a message did not go.
 *
 * Built on AI Elements' PromptInput. The box takes a message to the agent:
 * Enter sends it, Shift+Enter is a new line, and Escape leaves the box. A
 * message sent while a turn runs steers it, so the agent sees it at its
 * next step; sent idle, it opens a new turn. The box reads the same
 * whatever the agent is doing: one placeholder, one size, no hint under it,
 * because the header and the transcript's "Working…" line already say
 * where the agent stands. The one thing that follows the agent's state is
 * the button at the card's right, the way every chat draws it: Send while
 * there are words, disabled while there are none and the agent is idle, and
 * Stop while there are none and a turn runs, which is the one Stop the tab
 * has. A message that did not go stays in the box with why under the card
 * and Retry, which sends it again under the same key, so a send whose
 * answer was lost reaches the agent once; an agent that takes no message
 * any more keeps the box, disabled, with the reason under it. The box takes
 * focus as the tab opens unless the developer is typing somewhere else, so
 * opening a tab never takes the caret out of the plan.
 */

/** What the box says it takes, whatever the agent is doing. */
const PLACEHOLDER = "Message the agent…";

/** The one button's names, which are its tooltips too. */
const BUTTON = { SEND: "Send", STOP: "Stop", STOPPING: "Stopping…" } as const;

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
  onStop,
}: {
  status: CodingAgentStatus;
  composer: AgentComposerControl;
  /** Stops the agent; the promise settles once the service has answered. */
  onStop: () => Promise<void>;
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const [stopping, setStopping] = useState(false);
  // Note that Stop stands only once a turn runs, because the service cancels
  // the turn under way and a starting agent has none yet to cancel.
  const stoppable = status === CODING_AGENT_STATUS.RUNNING;
  const closed = composer.closed !== undefined;
  const held = composer.sending || closed;
  const empty = composer.draft.trim() === "";
  const showsStop = empty && stoppable && !composer.sending;
  const note = composer.closed ?? composer.note;

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

  return (
    <div className="agent-composer" data-status={status}>
      <PromptInput className="agent-composer-form" onSubmit={() => composer.send()}>
        <PromptInputTextarea
          ref={field}
          className="ph-no-capture"
          aria-label="Message to the agent"
          placeholder={PLACEHOLDER}
          maxLength={CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS}
          value={composer.draft}
          disabled={held}
          onChange={(event) => composer.setDraft(event.currentTarget.value)}
          onKeyDown={onFieldKey}
        />
        <PromptInputFooter>
          <PromptInputTools />
          {showsStop ? (
            <Tooltip label={stopping ? BUTTON.STOPPING : BUTTON.STOP}>
              <PromptInputSubmit
                type="button"
                status={PROMPT_INPUT_STATUS.STREAMING}
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
        </PromptInputFooter>
      </PromptInput>
      {note !== undefined ? (
        <p className="agent-note agent-composer-note" role="alert">
          <span>{note}</span>
          {closed ? null : (
            <button type="button" className="plan-button" onClick={composer.retry}>
              Retry
            </button>
          )}
        </p>
      ) : null}
    </div>
  );
}

import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_DELIVERY,
  CODING_AGENT_STATUS,
  type CodingAgentDelivery,
  type CodingAgentMessage,
  type CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import { ChevronDownIcon, StopIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
} from "../ai-elements/queue";
import { Keycaps } from "../keycaps";
import { Tooltip } from "../tooltip";
import { agentStillWriting, messageWords } from "./coding-agent-model";
import type { AgentComposerControl } from "./use-agent-composer";

/**
 * agent-composer.tsx -- the message box pinned under an agent's transcript: the lines queued above it, the box, and the Stop and the send beside each other.
 *
 * Built on AI Elements' PromptInput and Queue. The box takes a message to
 * the agent: Enter sends it, Shift+Enter is a new line, and Escape leaves
 * the box. While the agent runs, a message sent now joins the turn under
 * way at its next step, and ⌥Enter — or the menu on the send's chevron —
 * queues it for after the turn instead; a line under the box says the two
 * keys. The lines queued stand above the box as compact rows marked Queued,
 * in order, until their turn opens and they join the transcript. Idle, the
 * box asks for changes or a follow-up, and a send opens a new turn. The
 * Stop is the one Stop the tab has, the square beside the send while a turn
 * runs. A message that did not go stays in the box with why under it and
 * Retry; an agent that takes no message any more shows the reason in the
 * box's place. The box takes focus as the tab opens unless the developer is
 * typing somewhere else, so opening a tab never takes the caret out of the
 * plan.
 */

/** What the box says it takes, by whether the agent may still write. */
const PLACEHOLDER = {
  RUNNING: "Message the agent…",
  IDLE: "Ask for changes or a follow-up…",
} as const;

/** The two ways a message goes while a turn runs, as the menu lists them. */
const DELIVERY_CHOICE = [
  { delivery: CODING_AGENT_DELIVERY.STEER, label: "Send now" },
  { delivery: CODING_AGENT_DELIVERY.QUEUE, label: "Queue for after this turn" },
] as const satisfies readonly { delivery: CodingAgentDelivery; label: string }[];

/** The word on a queued row. */
const QUEUED_MARK = "Queued";

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

/** The lines waiting for the turn under way to end, in order. */
function QueuedLines({ queued }: { queued: readonly CodingAgentMessage[] }): React.JSX.Element {
  return (
    <Queue className="agent-composer-queue" aria-label="Queued messages">
      <QueueList>
        {queued.map((message) => (
          <QueueItem key={message.id} data-queued-id={message.id}>
            <QueueItemIndicator />
            <QueueItemContent>{messageWords(message)}</QueueItemContent>
            <span className="agent-composer-queued-mark">{QUEUED_MARK}</span>
          </QueueItem>
        ))}
      </QueueList>
    </Queue>
  );
}

/**
 * The menu on the send's chevron: how the message goes. Focus lands on its
 * first item as it opens; the arrows move it, Escape and Tab close it and
 * hand focus back to the chevron, and a press outside closes it.
 */
function SendMenu({
  id,
  onPick,
  onClose,
  opener,
}: {
  id: string;
  onPick: (delivery: CodingAgentDelivery) => void;
  onClose: (returnFocus: boolean) => void;
  opener: HTMLElement | null;
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (menu.current?.contains(target) || opener?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", pressed, true);
    return () => document.removeEventListener("pointerdown", pressed, true);
  }, [onClose, opener]);

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The menu is the nearest open layer, so Escape closes it alone and leaves the box and the plan behind it.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === "Tab") {
      onClose(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={menu}
      id={id}
      className="plan-menu agent-composer-menu"
      role="menu"
      aria-label="How to send"
      onKeyDown={onKey}
    >
      {DELIVERY_CHOICE.map((choice) => (
        <button
          key={choice.delivery}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="plan-menu-item"
          data-delivery={choice.delivery}
          onClick={() => {
            onClose(true);
            onPick(choice.delivery);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function AgentComposer({
  status,
  composer,
  queued,
  onStop,
}: {
  status: CodingAgentStatus;
  composer: AgentComposerControl;
  /** The lines waiting for the turn under way to end, in order. */
  queued: readonly CodingAgentMessage[];
  /** Stops the agent; the promise settles once the service has answered. */
  onStop: () => Promise<void>;
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const menuId = useId();
  const running = agentStillWriting(status);
  // Note that Stop stands only once a turn runs, because the service cancels
  // the turn under way and a starting agent has none yet to cancel.
  const stoppable = status === CODING_AGENT_STATUS.RUNNING;
  const closed = composer.closed !== undefined;
  const held = composer.sending || closed;
  const empty = composer.draft.trim() === "";

  // The box takes focus as the tab opens, unless the caret is somewhere the developer is typing.
  useEffect(() => {
    if (!typingElsewhere()) field.current?.focus();
  }, []);

  // The menu makes no sense once the turn has ended: a send then opens a new one either way.
  if (menuOpen && !running) setMenuOpen(false);

  const send = (delivery: CodingAgentDelivery) => {
    // An idle agent takes either as its next turn, so idle sends go the plain way.
    composer.send(running ? delivery : CODING_AGENT_DELIVERY.STEER);
  };

  const closeMenu = (returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) chevron.current?.focus();
  };

  const onFieldKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.currentTarget.blur();
      return;
    }
    // ⌥Enter queues while a turn runs; the plain Enter is the field's own, which submits.
    if (event.key === "Enter" && event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (!held) send(CODING_AGENT_DELIVERY.QUEUE);
    }
  };

  const submitStatus = composer.sending ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.READY;

  return (
    <div className="agent-composer" data-status={status}>
      {queued.length > 0 ? <QueuedLines queued={queued} /> : null}
      {closed ? (
        <p className="agent-composer-closed" role="status">
          {composer.closed}
        </p>
      ) : (
        <PromptInput
          className="agent-composer-form"
          onSubmit={() => send(CODING_AGENT_DELIVERY.STEER)}
        >
          <PromptInputTextarea
            ref={field}
            className="ph-no-capture"
            aria-label="Message to the agent"
            placeholder={running ? PLACEHOLDER.RUNNING : PLACEHOLDER.IDLE}
            maxLength={CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS}
            value={composer.draft}
            disabled={held}
            onChange={(event) => composer.setDraft(event.currentTarget.value)}
            onKeyDown={onFieldKey}
          />
          <PromptInputFooter>
            <p className="agent-composer-hint" aria-hidden={running ? undefined : "true"}>
              {running ? (
                <>
                  <Keycaps caps={["↵"]} /> send now
                  <span className="agent-tab-separator"> · </span>
                  <Keycaps caps={["⌥", "↵"]} /> queue
                </>
              ) : null}
            </p>
            <PromptInputTools>
              {stoppable ? (
                <Tooltip label={stopping ? "Stopping…" : "Stop"}>
                  <PromptInputButton
                    className="agent-composer-stop"
                    aria-label={stopping ? "Stopping…" : "Stop"}
                    disabled={stopping}
                    onClick={() => {
                      setStopping(true);
                      onStop().finally(() => setStopping(false));
                    }}
                  >
                    <StopIcon />
                  </PromptInputButton>
                </Tooltip>
              ) : null}
              <div className="agent-composer-send">
                <PromptInputSubmit
                  aria-label={running ? "Send now" : "Send"}
                  status={submitStatus}
                  disabled={held || empty}
                />
                {running ? (
                  <PromptInputButton
                    ref={chevron}
                    className="agent-composer-chevron"
                    aria-label="How to send"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-controls={menuOpen ? menuId : undefined}
                    disabled={held || empty}
                    onClick={() => setMenuOpen(!menuOpen)}
                  >
                    <ChevronDownIcon />
                  </PromptInputButton>
                ) : null}
                {menuOpen ? (
                  <SendMenu
                    id={menuId}
                    opener={chevron.current}
                    onPick={send}
                    onClose={closeMenu}
                  />
                ) : null}
              </div>
            </PromptInputTools>
          </PromptInputFooter>
        </PromptInput>
      )}
      {composer.note !== undefined ? (
        <p className="agent-note agent-composer-note" role="alert">
          {composer.note}{" "}
          <button type="button" className="plan-button" onClick={composer.retry}>
            Retry
          </button>
        </p>
      ) : null}
    </div>
  );
}

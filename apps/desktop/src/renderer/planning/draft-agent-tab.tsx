import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { useEffect, useRef, useState } from "react";
import { ConversationEmptyState } from "../ai-elements/conversation";
import { AgentComposer } from "./agent-composer";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentDraft, CodingAgentsControl } from "./use-coding-agents";

/**
 * draft-agent-tab.tsx -- the tab of a coding agent not yet started: an empty transcript and the composer, whose first message starts the agent on it.
 *
 * Opened from the side panel's "+", it is drawn as an agent's tab is with
 * nothing yet said: where the transcript would be, one line on what a send
 * does, and under it the composer, focused as the tab opens, with the model
 * chip on the account's default once that is read. Nothing reaches the
 * service until the first send, which starts the agent with those words as
 * its task, never the plan, on the model the chip names where the developer
 * changed it and else on the account's default, in the plan's repository;
 * the tab then gives way to the agent's own. The words and the choice are
 * the draft's, held by its owner, so they wait while the tab is away. A
 * send that did not start it
 * leaves the words in the box with why under it and Retry, which asks again
 * under the draft's own key. Closing the tab lets the draft go, and since
 * nothing was started, nothing is left behind.
 */

/** What a draft agent's tab is named until its first message starts it. */
export const DRAFT_TAB_LABEL = "New agent";

/** What stands where the transcript will be, before the first send. */
const DRAFT_LINE = "Describe a task. The agent starts when you send it.";

/** A draft has nothing to stop and has published nothing, so its box's Stop and doors answer nothing. */
const NOTHING_TO_STOP = () => Promise.resolve();
const NO_DOORS = { openGitHub: () => undefined, copy: () => undefined };

export function DraftAgentTab({
  draft,
  control,
}: {
  draft: AgentDraft;
  control: CodingAgentsControl;
}): React.JSX.Element {
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  // The account's default as read, which the chip names until the developer makes a choice of their own.
  const [fallback, setFallback] = useState<AgentDraft["choice"]>(undefined);
  // Note that the control is read through a ref, because the panel hands a
  // new one on every render and an answer lands on whichever is current.
  const latest = useRef(control);
  latest.current = control;

  useEffect(() => {
    let live = true;
    latest.current.readDefault().then((answer) => {
      if (live && !("failure" in answer)) setFallback(answer.choice);
    });
    return () => {
      live = false;
    };
  }, []);

  const send = () => {
    const task = draft.task.trim();
    if (task === "" || sending) return;
    setSending(true);
    setNote(undefined);
    latest.current.startTask(draft.id, task, draft.choice).then((failed) => {
      setSending(false);
      setNote(failed);
    });
  };
  const composer: AgentComposerControl = {
    draft: draft.task,
    setDraft: (task) => control.onDraftChange({ task }),
    sending: sending || control.start.busy,
    note,
    closed: undefined,
    send,
    retry: send,
    sent: [],
  };
  const choice = draft.choice ?? fallback;

  return (
    <section className="agent-tab ph-no-capture" aria-label={DRAFT_TAB_LABEL}>
      <ConversationEmptyState>
        <p className="m-0">{DRAFT_LINE}</p>
      </ConversationEmptyState>
      <footer className="agent-tab-foot">
        <AgentComposer
          status={CODING_AGENT_STATUS.STARTING}
          composer={composer}
          model={
            choice === undefined
              ? undefined
              : {
                  choice,
                  note: undefined,
                  choose: (next) => control.onDraftChange({ choice: next }),
                }
          }
          models={control.models}
          readModels={control.readModels}
          published={undefined}
          usage={undefined}
          doors={NO_DOORS}
          onStop={NOTHING_TO_STOP}
          followsUp={false}
        />
      </footer>
    </section>
  );
}

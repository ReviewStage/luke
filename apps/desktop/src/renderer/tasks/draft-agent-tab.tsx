import { CODING_AGENT_STATUS, hasWordsOrFiles } from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { useEffect, useRef, useState } from "react";
import { AgentComposer } from "./agent-composer";
import { ArchivedComposerNote } from "./archived-task";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentDraft, CodingAgentsControl } from "./use-coding-agents";

/**
 * draft-agent-tab.tsx -- the tab of a coding agent not yet started: an empty transcript and the composer, whose first message starts the agent on it.
 *
 * Opened from the plan's column's "+", it is drawn as an agent's tab is with
 * nothing yet said: nothing where the transcript would be, since the
 * composer's placeholder is the one prompt, and at the tab's foot the
 * composer, focused as the tab opens, with the model
 * chip on the account's default once that is read. Nothing reaches the
 * service until the first send, which starts the agent with those words, the
 * files attached, or both as its prompt, never the plan, on the model
 * the chip names where the developer
 * changed it and else on the account's default, in the plan's repository;
 * the tab then gives way to the agent's own. The words and the choice are
 * the draft's, held by its owner, as are the files, so they wait while the
 * tab is away. A
 * send that did not start it
 * leaves the words in the box with why under it and what mends it: Retry,
 * which asks again under the draft's own key, or, for a repository out of
 * reach, the press its reason names, a move of the plan asking again by
 * itself once it lands. Closing the tab lets the draft go, and since
 * nothing was started, nothing is left behind. While the plan is archived,
 * nothing starts on it, so the box gives way to the note that offers
 * Unarchive, and the words written wait in the draft until it is back.
 */

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
  const [note, setNote] = useState<Failure | undefined>(undefined);
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
    const prompt = draft.prompt.trim();
    if (!hasWordsOrFiles(prompt, draft.attachments) || sending) return;
    setSending(true);
    setNote(undefined);
    latest.current
      .startPrompt(draft.id, prompt, draft.choice, draft.attachments, draft.disabledServers)
      .then((failed) => {
        setSending(false);
        setNote(failed);
      });
  };
  const composer: AgentComposerControl = {
    draft: draft.prompt,
    setDraft: (prompt) => control.onDraftChange({ prompt }),
    attachments: draft.attachments,
    setAttachments: control.onDraftAttachments,
    sending: sending || control.start.busy,
    note,
    closed: undefined,
    send,
    retry: send,
    sent: [],
  };
  const choice = draft.choice ?? fallback;
  if (control.onUnarchive !== undefined) {
    return (
      <section className="agent-tab ph-no-capture" aria-label={TAB_WORDS.NEW_AGENT}>
        <footer className="agent-tab-foot">
          <ArchivedComposerNote onUnarchive={control.onUnarchive} />
        </footer>
      </section>
    );
  }

  return (
    <section className="agent-tab ph-no-capture" aria-label={TAB_WORDS.NEW_AGENT}>
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
          servers={{
            disabled: draft.disabledServers,
            onSwitch: (next) => control.onDraftChange({ disabledServers: next }),
            onOpenSettings: control.onOpenIntegrations,
          }}
          doors={NO_DOORS}
          onStop={NOTHING_TO_STOP}
          followsUp={false}
          keywords={control.keywords}
          skills={control.readSkills}
        />
      </footer>
    </section>
  );
}

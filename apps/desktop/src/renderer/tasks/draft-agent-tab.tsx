import { CODING_AGENT_STATUS, hasWordsOrFiles } from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { useEffect, useRef, useState } from "react";
import { AgentComposer } from "./agent-composer";
import type { TranscriptCards } from "./agent-tab";
import { ArchivedComposerNote } from "./archived-task";
import { ForkChip } from "./fork-action";
import { forkChoice } from "./fork-model";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentDraft, CodingAgentsControl } from "./use-coding-agents";

/**
 * draft-agent-tab.tsx -- the tab of a coding agent not yet started: an empty transcript and the composer, whose first message starts the agent on it.
 *
 * Opened from the task's column's "+", it is drawn as an agent's tab is with
 * nothing yet said: nothing where the transcript would be, since the
 * composer's placeholder is the one prompt, and at the tab's foot the
 * composer, focused as the tab opens, with the model
 * chip on the account's default once that is read. Nothing reaches the
 * service until the first send, which starts the agent with those words, the
 * files attached, or both as its prompt, never the plan, on the model
 * the chip names where the developer
 * changed it and else on the account's default, in the task's repository;
 * the tab then gives way to the agent's own. The words and the choice are
 * the draft's, held by its owner, as are the files, so they wait while the
 * tab is away. A
 * send that did not start it
 * leaves the words in the box with why under it and what mends it: Retry,
 * which asks again under the draft's own key, or, for a repository out of
 * reach, the press its reason names, a move of the task asking again by
 * itself once it lands. Closing the tab lets the draft go, and since
 * nothing was started, nothing is left behind. While the task is archived,
 * nothing starts on it, so the box gives way to the note that offers
 * Unarchive, and the words written wait in the draft until it is back.
 *
 * A draft may fork one of the task's agents at one of its messages
 * (`fork-action.tsx`): a chip over the box names the source and the message,
 * the model chip starts on the source's model and effort, and a send forks
 * the source there with the box's words and files as the developer's note,
 * an empty box forking alone. The chip's × lets the fork go, leaving an
 * ordinary draft with its words.
 */

/** A draft has nothing to stop and has published nothing, so its box's Stop and doors answer nothing. */
const NOTHING_TO_STOP = () => Promise.resolve();
const NO_DOORS = { openGitHub: () => undefined, copy: () => undefined };

export function DraftAgentTab({
  draft,
  control,
  cards,
}: {
  draft: AgentDraft;
  control: CodingAgentsControl;
  /** The cards a fork's source chip hangs, as its tab's own chip does; none where the place draws none. */
  cards?: TranscriptCards | undefined;
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

  const { fork } = draft;
  const source =
    fork === undefined
      ? undefined
      : [...(control.agents ?? []), ...(control.archived ?? [])].find(
          (agent) => agent.id === fork.agentId,
        );
  const send = () => {
    const prompt = draft.prompt.trim();
    if (sending || (fork === undefined && !hasWordsOrFiles(prompt, draft.attachments))) return;
    setSending(true);
    setNote(undefined);
    const { id, choice, attachments, disabledServers } = draft;
    const started =
      fork === undefined
        ? latest.current.startPrompt(id, prompt, choice, attachments, disabledServers)
        : latest.current.startFork(id, fork, prompt, choice, attachments, disabledServers);
    started.then((failed) => {
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
  // A fork runs on its source's model and effort until the developer picks another.
  const choice = draft.choice ?? (source === undefined ? fallback : forkChoice(source));
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
        {fork === undefined ? null : (
          <ForkChip fork={fork} source={source} cards={cards} onDrop={control.onDropFork} />
        )}
        <AgentComposer
          status={CODING_AGENT_STATUS.STARTING}
          sendsEmpty={fork !== undefined}
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

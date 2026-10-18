import { CODING_AGENT_STATUS, hasWordsOrFiles } from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { useEffect, useRef, useState } from "react";
import { ConversationEmptyState } from "../ai-elements/conversation";
import { AgentComposer } from "./agent-composer";
import type { TranscriptCards } from "./agent-tab";
import { ArchivedComposerNote } from "./archived-task";
import { agentTabLabel } from "./coding-agent-model";
import { ForkChip } from "./fork-action";
import { forkChoice, startingWords } from "./fork-model";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentDraft, CodingAgentsControl } from "./use-coding-agents";
import { useWorkingNow, WorkingLine } from "./working-time";

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
 * ordinary draft with its words. A draft may continue one of the agents
 * on its whole transcript the same way, its chip naming the source alone.
 * While a fork's or a continue's Start is out, which copies the source's
 * work before the new agent starts and may take a while, the tab stands on
 * a working line saying so, counting from the send, over the held box;
 * once it lands the tab gives way to the new agent's, and a Start that did
 * not land leaves the line for the note and Retry under the box, the words
 * kept.
 *
 * A draft New task handed over (`sendsOnOpen`, `use-coding-agents.ts`'s
 * `onHandDraft`) holds the words, files, and model New task's box held, and
 * the tab sends it by itself as soon as the task can start an agent, once:
 * the tab gives way to the agent's as it starts, and a Start the service
 * refused leaves the developer on the draft with the words in the box, why
 * under it, and Retry, as a send of their own would.
 */

/** A draft has nothing to stop and has published nothing, so its box's Stop and doors answer nothing. */
const NOTHING_TO_STOP = () => Promise.resolve();
const NO_DOORS = { openGitHub: () => undefined, copy: () => undefined };

/** What a fork's working line names its source as where the task does not list it. */
const UNLISTED_SOURCE = "the agent";

/** The working line a fork's or a continue's draft stands on while its Start is out, saying the stage it is likely at and counting from the send. */
function StartingLine({
  source,
  sentAt,
}: {
  source: string | undefined;
  sentAt: number;
}): React.JSX.Element {
  const now = useWorkingNow();
  return (
    <WorkingLine
      startedAt={sentAt}
      words={startingWords(source ?? UNLISTED_SOURCE, now === undefined ? undefined : now - sentAt)}
    />
  );
}

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
  // When a fork's or a continue's Start went, which its working line counts from; none while none is out.
  const [sentAt, setSentAt] = useState<number | undefined>(undefined);
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
    if (fork !== undefined) setSentAt(Date.now());
    const { id, choice, attachments, disabledServers } = draft;
    const started =
      fork === undefined
        ? latest.current.startPrompt(id, prompt, choice, attachments, disabledServers)
        : latest.current.startFork(id, fork, prompt, choice, attachments, disabledServers);
    started.then((failed) => {
      setSending(false);
      setSentAt(undefined);
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
  // A draft New task handed over sends itself once the task can start an
  // agent; the mark is let go first, so a refusal waits on Retry.
  const handed = draft.sendsOnOpen === true && control.start.available;
  const sendHanded = useRef(send);
  sendHanded.current = send;
  useEffect(() => {
    if (!handed) return;
    latest.current.onDraftChange({ sendsOnOpen: undefined });
    sendHanded.current();
  }, [handed]);
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
      {sentAt === undefined || fork === undefined ? null : (
        <ConversationEmptyState>
          <StartingLine
            source={source === undefined ? undefined : agentTabLabel(source, control.models)}
            sentAt={sentAt}
          />
        </ConversationEmptyState>
      )}
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

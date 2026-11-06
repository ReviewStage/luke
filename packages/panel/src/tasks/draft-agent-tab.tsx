import { AGENT_STATUS, hasWordsOrFiles } from "@repo/features/agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import { EXPERIMENT } from "@repo/settings";
import { useSecond } from "@repo/ui";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAgentDefault } from "../account-choices.js";
import { ConversationEmptyState } from "../ai-elements/conversation.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { AgentComposer, COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { agentName, unrunnableChoice } from "./agent-model.js";
import type { TranscriptCards } from "./agent-tab.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import { ArchivedComposerNote } from "./archived-note.js";
import { ConnectAgentBanner } from "./connect-agent-banner.js";
import { ForkChip } from "./fork-action.js";
import { forkChoice, startingWords } from "./fork-model.js";
import { NewTaskRunsOnChip, useStartRunsOn } from "./runs-on.js";
import type { AgentComposerControl, ComposerNote } from "./use-agent-composer.js";
import type { AgentDraft, AgentsControl } from "./use-agents.js";
import { WorkingLine } from "./working-time.js";

const NOTHING_TO_STOP = () => Promise.resolve(false);
const NO_DOORS = { openGitHub: () => undefined, copy: () => undefined };

const NO_DEVICES: readonly MacOffer[] = [];

const UNLISTED_SOURCE = "the agent";

function StartingLine({
  source,
  sentAt,
}: {
  source: string | undefined;
  sentAt: number;
}): React.JSX.Element {
  const now = useSecond();
  return (
    <WorkingLine
      startedAt={sentAt}
      words={startingWords(source ?? UNLISTED_SOURCE, now - sentAt)}
    />
  );
}

export function DraftAgentTab({
  draft,
  control,
  cards,
}: {
  draft: AgentDraft;
  control: AgentsControl;
  cards?: TranscriptCards | undefined;
}): React.JSX.Element {
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | undefined>(undefined);
  const [note, setNote] = useState<ComposerNote | undefined>(undefined);
  const shownNote = note ?? draft.refused;
  const fallback = useAgentDefault().choice;
  const latest = useRef(control);
  latest.current = control;

  const { fork } = draft;
  const source =
    fork === undefined
      ? undefined
      : [...(control.agents ?? []), ...(control.archived ?? [])].find(
          (agent) => agent.id === fork.agentId,
        );
  const choice = draft.choice ?? (source === undefined ? fallback : forkChoice(source));
  const unpaid =
    control.models === undefined || choice === undefined
      ? undefined
      : unrunnableChoice(control.models, choice);
  const placesOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.BRING_YOUR_OWN_HOST) })
      .data === true;
  useEffect(() => {
    if (placesOn && latest.current.macs === undefined) latest.current.readModels();
  }, [placesOn]);
  const devices = (placesOn ? control.macs : undefined) ?? NO_DEVICES;
  const [device, choosePlace] = useStartRunsOn(
    devices,
    draft.runsOn,
    {
      source,
      agents: [...(control.agents ?? []), ...(control.archived ?? [])],
      me: control.me,
    },
    (runsOn) => control.onDraftChange({ runsOn }),
  );
  const send = () => {
    const prompt = draft.prompt.trim();
    if (sending || unpaid !== undefined) return;
    if (fork === undefined && !hasWordsOrFiles(prompt, draft.attachments)) return;
    setSending(true);
    setNote(undefined);
    if (draft.refused !== undefined) latest.current.onDraftChange({ refused: undefined });
    if (fork !== undefined) setSentAt(Date.now());
    const { id, choice, attachments, disabledServers } = draft;
    const runsOn = placesOn ? draft.runsOn : undefined;
    const started =
      fork === undefined
        ? latest.current.startPrompt(id, prompt, choice, attachments, disabledServers, runsOn)
        : latest.current.startFork(id, fork, prompt, choice, attachments, disabledServers, runsOn);
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
    note: shownNote,
    closed: undefined,
    send,
    retry: send,
    sent: [],
  };

  if (control.onUnarchive !== undefined) {
    return (
      <AgentTabFrame label={TAB_WORDS.NEW_AGENT}>
        <AgentTabFoot>
          <ArchivedComposerNote onUnarchive={control.onUnarchive} />
        </AgentTabFoot>
      </AgentTabFrame>
    );
  }

  return (
    <AgentTabFrame label={TAB_WORDS.NEW_AGENT}>
      {sentAt === undefined || fork === undefined ? null : (
        <ConversationEmptyState>
          <StartingLine
            source={source === undefined ? undefined : agentName(source, control.models)}
            sentAt={sentAt}
          />
        </ConversationEmptyState>
      )}
      <AgentTabFoot>
        {fork === undefined ? null : (
          <ForkChip fork={fork} source={source} cards={cards} onDrop={control.onDropFork} />
        )}
        {unpaid === undefined || control.models === undefined ? null : (
          <div className={COMPOSER_DOCK_CLASS}>
            <ConnectAgentBanner models={control.models} unpaid={unpaid} />
          </div>
        )}
        <AgentComposer
          status={AGENT_STATUS.STARTING}
          sendsEmpty={fork !== undefined}
          composer={composer}
          sendable={unpaid === undefined}
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
          modelsFailed={control.modelsFailed}
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
          tools={
            placesOn
              ? (narrow) => (
                  <NewTaskRunsOnChip
                    devices={devices}
                    device={device}
                    disabled={sending}
                    narrow={narrow}
                    onChoose={choosePlace}
                  />
                )
              : undefined
          }
        />
      </AgentTabFoot>
    </AgentTabFrame>
  );
}

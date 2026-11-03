import type { TasksRepositoriesAnswer } from "@repo/features/tasks-view";
import {
  SETTINGS_SECTION_FRAME,
  SettingsSection,
  STATUS_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useCallback, useEffect, useState } from "react";
import { PersonSectionFrame } from "../desktop/person-frame.js";
import { AgentAuthSection } from "../settings/agent-auth-section.js";
import { MODELS_READ } from "../tasks/use-agents.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { GitHubSetup } from "./setup-github.js";

/**
 * setup-sections.tsx -- Home's Finish setting up: what setup left undone that an agent needs, above New task's composer, for an account with no task yet.
 *
 * An agent and GitHub are read as Home opens; each one missing is a part of
 * the section, which stays, ticked, once it is done, so nothing moves under
 * the pointer. With neither missing there is no section, and Home stands as
 * it does for anyone.
 */

/** The Agents rows' API keys, which the section reads no further. */
const IGNORE_KEYS = () => undefined;

/** What was missing as Home opened: an agent, GitHub, or neither. */
interface Missing {
  readonly agent: boolean;
  readonly github: boolean;
}

/** Whether a read answered a repository the workspace reaches; nothing for a read that failed. */
function reachesOf(answer: TasksRepositoriesAnswer): boolean | undefined {
  return "repositories" in answer ? answer.repositories.repositories.length > 0 : undefined;
}

/** Finish setting up, where an agent or GitHub is missing; nothing otherwise, or while either is still read. */
export function SetupSections({ tasks }: { tasks: TasksControl }): React.JSX.Element | null {
  const { workspaceId, models, modelsRead, readModels, repositoriesIn } = tasks.newTask;
  const [missing, setMissing] = useState<Missing | undefined>(undefined);
  const [agent, setAgent] = useState(false);
  const [reached, setReached] = useState(false);
  const onConnected = useCallback((connected: boolean) => setAgent(connected), []);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  // The models are read on asking, so Home asks; a read that fails asks for no agent here, New task saying why instead.
  useEffect(() => {
    if (modelsRead.state === MODELS_READ.UNREAD) readModels();
  }, [modelsRead.state, readModels]);
  const agentMissing =
    models !== undefined
      ? !models.some((model) => model.credentialMissing !== true)
      : modelsRead.state === MODELS_READ.FAILED
        ? false
        : undefined;

  // What is missing is read once, as Home opens, so a part done here stays standing, ticked.
  useEffect(() => {
    if (missing !== undefined || agentMissing === undefined || workspaceId === undefined) return;
    let live = true;
    repositoriesIn(workspaceId)
      .read()
      .then(
        (answer) => {
          if (live) setMissing({ agent: agentMissing, github: !(reachesOf(answer) ?? true) });
        },
        () => {
          if (live) setMissing({ agent: agentMissing, github: false });
        },
      );
    return () => {
      live = false;
    };
  }, [missing, agentMissing, workspaceId, repositoriesIn]);

  if (missing === undefined || workspaceId === undefined) return null;
  if (!missing.agent && !missing.github) return null;
  const left = Number(missing.agent && !agent) + Number(missing.github && !reached);
  return (
    <div className="mb-page-section-gap">
      <PersonSectionFrame
        label="Finish setting up"
        title="Finish setting up"
        {...(left > 0 ? { count: left, tone: STATUS_TONE.ATTENTION } : {})}
      >
        {missing.agent ? (
          <SettingsSection frame={SETTINGS_SECTION_FRAME.ROWS} title="Connect an agent">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Agents run on your own Claude or Codex plan.
            </Text>
            <AgentAuthSection signedIn onKeys={IGNORE_KEYS} onConnected={onConnected} />
          </SettingsSection>
        ) : null}
        {missing.github ? (
          <SettingsSection frame={SETTINGS_SECTION_FRAME.ROWS} title="Connect GitHub">
            <GitHubSetup
              workspaceId={workspaceId}
              repositories={repositoriesIn(workspaceId)}
              onReached={onReached}
            />
          </SettingsSection>
        ) : null}
      </PersonSectionFrame>
    </div>
  );
}

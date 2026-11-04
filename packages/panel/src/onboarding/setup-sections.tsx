import type { TasksRepositoriesAnswer } from "@repo/features/tasks-view";
import { SETTINGS_SECTION_FRAME, SettingsSection, TEXT_TONE, TEXT_VARIANT, Text } from "@repo/ui";
import { useEffect, useState } from "react";
import { AgentConnectSection } from "../settings/agent-auth-section.js";
import { MODELS_READ } from "../tasks/use-agents.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { GitHubSetup } from "./setup-github.js";

/**
 * setup-sections.tsx -- Home's Finish setting up: what setup left undone that an agent needs, above New task's composer, for an account with no task yet.
 *
 * An agent and GitHub are read as Home opens; each one missing is a section
 * of its own, Connect an agent and Connect GitHub, which stays, its rows
 * saying it is connected, once it is done, so nothing moves under the
 * pointer. An agent connects in place, as onboarding's step connects one,
 * since this is that step taken up later; Settings › Agents keeps the dialog. With neither missing there is nothing, and Home stands as it does
 * for anyone.
 */

/** Whether an agent is connected, which its rows say for themselves. */
const IGNORE_CONNECTED = () => undefined;

/** Whether GitHub reaches a repository, which its card says for itself. */
const IGNORE_REACHED = () => undefined;

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
  return (
    <section
      className="mb-page-section-gap flex flex-col gap-page-section-gap"
      aria-label="Finish setting up"
    >
      {missing.agent ? (
        <SettingsSection frame={SETTINGS_SECTION_FRAME.NONE} title="Connect an agent">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Run agents on your ChatGPT or Claude plan, or an API key.
          </Text>
          <AgentConnectSection onConnected={IGNORE_CONNECTED} />
        </SettingsSection>
      ) : null}
      {missing.github ? (
        <SettingsSection frame={SETTINGS_SECTION_FRAME.NONE} title="Connect GitHub">
          <GitHubSetup
            key={workspaceId}
            workspaceId={workspaceId}
            repositories={repositoriesIn(workspaceId)}
            onReached={IGNORE_REACHED}
          />
        </SettingsSection>
      ) : null}
    </section>
  );
}

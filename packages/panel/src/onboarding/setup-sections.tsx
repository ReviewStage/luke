import { LIVE_READ } from "@repo/features/live-wire";
import { SETTINGS_SECTION_FRAME, SettingsSection, TEXT_TONE, TEXT_VARIANT, Text } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useEffect, useState } from "react";
import { AgentConnectSection } from "../settings/agent-auth-section.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
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

/** Finish setting up, where an agent or GitHub is missing; nothing otherwise, or while either is still read. */
export function SetupSections({ tasks }: { tasks: TasksControl }): React.JSX.Element | null {
  const { workspaceId, models, modelsFailed } = tasks.newTask;
  const [missing, setMissing] = useState<Missing | undefined>(undefined);
  // The models are the ones the host holds for the account; a read that fails asks for no agent here, New task saying why instead.
  const agentMissing =
    models !== undefined
      ? !models.some((model) => model.credentialMissing !== true)
      : modelsFailed
        ? false
        : undefined;

  // What is missing is decided once, as Home opens, so a part done here stays standing, ticked; a read that never answered asks nothing of GitHub.
  const reached = useHostRead(
    LIVE_READ.REPOSITORY_LISTS,
    missing === undefined ? workspaceId : undefined,
  );
  useEffect(() => {
    if (missing !== undefined || agentMissing === undefined) return;
    if (reached.status === HOST_READ_STATUS.LOADING) return;
    const github = reached.rows !== undefined && reached.rows.repositories.length === 0;
    setMissing({ agent: agentMissing, github });
  }, [missing, agentMissing, reached.rows, reached.status]);

  if (missing === undefined || workspaceId === undefined) return null;
  if (!missing.agent && !missing.github) return null;
  // Note that its words show in a screen recording, because they are the app's own, but for a person's, which each part masks.
  return (
    <ReplayUnmask>
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
            <GitHubSetup key={workspaceId} workspaceId={workspaceId} onReached={IGNORE_REACHED} />
          </SettingsSection>
        ) : null}
      </section>
    </ReplayUnmask>
  );
}

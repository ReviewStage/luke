import type { TasksRepositoriesAnswer } from "@repo/features/tasks-view";
import {
  BUTTON_VARIANT,
  Button,
  FILL_ELEMENT,
  Fill,
  PROGRESS_COUNT_LOOK,
  ProductMark,
  ProgressCount,
  SETTINGS_SECTION_FRAME,
  SettingsPage,
  SettingsSection,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useCallback, useEffect, useState } from "react";
import { AgentAuthSection } from "../settings/agent-auth-section.js";
import { MODELS_READ } from "../tasks/use-agents.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { GitHubSetup } from "./setup-github.js";

/**
 * setup-checklist.tsx -- a new account's welcome: what setup left undone that an agent needs, then the way to a first task.
 *
 * It stands where the welcome stands, for an account with no task yet. An
 * agent and GitHub are read as the page opens; each one missing is a
 * section of its own, which stays, ticked, once it is done, so nothing
 * moves under the pointer. With both done the page is the welcome alone:
 * the mark, one line, and New task, whose dialog starts the task.
 */

/** The Agents rows' API keys, which the checklist reads no further. */
const IGNORE_KEYS = () => undefined;

/** What was missing as the page opened: an agent, GitHub, or neither; nothing while either is still read. */
interface Missing {
  readonly agent: boolean;
  readonly github: boolean;
}

/** Whether a read answered a repository the workspace reaches; nothing for a read still out or one that failed. */
function reachesOf(answer: TasksRepositoriesAnswer): boolean | undefined {
  return "repositories" in answer ? answer.repositories.repositories.length > 0 : undefined;
}

/** The welcome alone: the mark, one line, and New task. */
function Welcome({ onNewTask }: { onNewTask: () => void }): React.JSX.Element {
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="home-welcome items-center justify-center-safe gap-block-gap overflow-y-auto p-page-inset text-center"
      aria-label="Welcome"
    >
      <span
        className="home-welcome-mark mb-tight-gap flex size-welcome-tile items-center justify-center rounded-ui-14 bg-muted text-foreground [&_.ui-product-mark]:size-welcome-mark!"
        aria-hidden="true"
      >
        <ProductMark />
      </span>
      <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
        Start your first task
      </Text>
      <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onNewTask}>
        New task
      </Button>
    </Fill>
  );
}

/** A new account's welcome, with what setup left undone above New task. */
export function SetupChecklist({ tasks }: { tasks: TasksControl }): React.JSX.Element | null {
  const { workspaceId, models, modelsRead, readModels, repositoriesIn } = tasks.newTask;
  const [missing, setMissing] = useState<Missing | undefined>(undefined);
  const [agent, setAgent] = useState(false);
  const [reached, setReached] = useState(false);
  const onConnected = useCallback((connected: boolean) => setAgent(connected), []);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  // The models are read on asking, so the welcome asks; a read that fails asks for no agent here, New task saying why instead.
  useEffect(() => {
    if (modelsRead.state === MODELS_READ.UNREAD) readModels();
  }, [modelsRead.state, readModels]);
  const agentMissing =
    models !== undefined
      ? !models.some((model) => model.credentialMissing !== true)
      : modelsRead.state === MODELS_READ.FAILED
        ? false
        : undefined;

  // What is missing is read once, as the page opens, so a section done here stays standing, ticked.
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
  if (!missing.agent && !missing.github) return <Welcome onNewTask={tasks.onNewTask} />;
  const total = Number(missing.agent) + Number(missing.github);
  const done = Number(missing.agent && agent) + Number(missing.github && reached);
  return (
    <SettingsPage
      title="Finish setting up"
      actions={
        <span className="flex items-center gap-control-gap">
          <ProgressCount
            done={done}
            total={total}
            label={`${done} of ${total} done`}
            look={PROGRESS_COUNT_LOOK.BADGE}
          />
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={done < total}
            onClick={tasks.onNewTask}
          >
            Start your first task
          </Button>
        </span>
      }
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
    </SettingsPage>
  );
}

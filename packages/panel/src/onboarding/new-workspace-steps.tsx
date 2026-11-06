import { AuthPage, AuthStepFoot, ProductMark } from "@repo/ui";
import { isComposingKey } from "@repo/ui/composing-key";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { GITHUB_PURPOSE, GitHubSetup } from "./setup-github.js";
import { TeamForm, useTeamForm } from "./setup-team.js";

/**
 * new-workspace-steps.tsx -- New workspace, from the sidebar's switcher or a phone's account menu: setup's team and GitHub cards, alone in the window, then the workspace made.
 *
 * Making a workspace is a step into somewhere new, so it takes the window as
 * Linear's, Slack's, and Notion's do, on setup's own cards (`setup-steps.tsx`)
 * so the two never drift apart: the workspace named, its photo, and who to
 * invite, made on Create; then GitHub, installed on the workspace just made,
 * which may be skipped. Back from GitHub finds the first card's fields over
 * the workspace made, where Continue saves a new name, photo, or invitation. The agent and the tools are left out, since they
 * are the account's and setup asked for them already. A quiet Cancel stands
 * where setup's Sign out does, and Escape presses it: before Create it makes
 * nothing; after it the workspace stands and is listed, so it reads Close,
 * and leaving at any step lands on the new workspace's Home. A photo or an
 * invitation refused holds the first card on what was refused, as setup's
 * does, rather than a toast the window would bury.
 */

/** The flow's two cards, in order. */
const STEP = {
  TEAM: 0,
  GITHUB: 1,
} as const;

type Step = (typeof STEP)[keyof typeof STEP];

const TOTAL = Object.keys(STEP).length;

/** What the flow is handed: the tasks, whose workspace it lists once made, and the press that puts it away. */
interface NewWorkspaceStepsProps {
  tasks: TasksControl;
  onClose: () => void;
}

/**
 * New workspace's cards over the window. Note that its words show in a
 * screen recording, because they are the app's own, but for a person's,
 * which each card masks where it draws them, as setup's do.
 */
export function NewWorkspaceSteps(props: NewWorkspaceStepsProps): React.JSX.Element {
  return (
    <ReplayUnmask>
      <NewWorkspaceStep {...props} />
    </ReplayUnmask>
  );
}

/** The card the flow stands at. */
function NewWorkspaceStep({ tasks, onClose }: NewWorkspaceStepsProps): React.JSX.Element {
  const [at, setAt] = useState<Step>(STEP.TEAM);
  const [made, setMade] = useState<string | undefined>(undefined);
  const [reached, setReached] = useState(false);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  // The caret lands in the name as the cards open, since the name is all Create needs.
  const nameField = useRef<HTMLInputElement | null>(null);
  useEffect(() => nameField.current?.focus(), []);
  const { onChooseWorkspace, onGoHome } = tasks;
  const teamForm = useTeamForm({
    made,
    madeName: tasks.newTask.workspaces.find((workspace) => workspace.id === made)?.name,
    onCreated: (workspaceId) => {
      setMade(workspaceId);
      onChooseWorkspace(workspaceId);
    },
    onDone: (failed) => {
      if (failed.length === 0) setAt(STEP.GITHUB);
    },
  });
  const { busy } = teamForm;
  // Note that leaving once the workspace is made lands on its Home, as setup's Finish does, rather than on the task the switch reopened.
  const leave = useCallback(() => {
    if (busy) return;
    onClose();
    if (made !== undefined) onGoHome();
  }, [busy, made, onClose, onGoHome]);
  // Escape presses the corner's way out. Note that it listens ahead of the window's own Escape, which would otherwise step the history behind the cards.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isComposingKey(event) || event.defaultPrevented) return;
      event.preventDefault();
      leave();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leave]);
  const exit = { label: made === undefined ? "Cancel" : "Close", onPress: leave };

  if (at === STEP.GITHUB && made !== undefined) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title="Connect GitHub"
        description={GITHUB_PURPOSE}
        foot={
          <AuthStepFoot
            at={STEP.GITHUB + 1}
            total={TOTAL}
            onBack={() => setAt(STEP.TEAM)}
            onSkip={reached ? undefined : leave}
            next={reached ? { label: "Open workspace", onPress: leave } : undefined}
          />
        }
      >
        <GitHubSetup key={made} workspaceId={made} onReached={onReached} />
      </AuthPage>
    );
  }
  // Note that Create is the card's way on until the workspace is made, and Continue after it, which saves what changed, as setup's team card does.
  return (
    <AuthPage
      mark={<ProductMark />}
      exit={exit}
      title={made === undefined ? "Create a workspace" : "Your new workspace"}
      description="Tasks, agents, and repositories, shared with your team."
      foot={
        <AuthStepFoot
          at={STEP.TEAM + 1}
          total={TOTAL}
          next={{
            label: made === undefined ? "Create" : "Continue",
            onPress: teamForm.create,
            disabled: !teamForm.ready,
            busy,
            busyLabel: made === undefined ? "Creating" : "Saving",
          }}
        />
      }
    >
      <TeamForm form={teamForm} nameRef={nameField} disabled={busy} />
    </AuthPage>
  );
}

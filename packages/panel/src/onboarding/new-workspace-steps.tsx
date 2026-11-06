import { AuthPage, AuthStepFoot, ProductMark } from "@repo/ui";
import { isComposingKey } from "@repo/ui/composing-key";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { GITHUB_PURPOSE, GitHubSetup } from "./setup-github.js";
import { TeamForm, useTeamForm } from "./setup-team.js";

const STEP = {
  TEAM: 0,
  GITHUB: 1,
} as const;

type Step = (typeof STEP)[keyof typeof STEP];

const TOTAL = Object.keys(STEP).length;

interface NewWorkspaceStepsProps {
  tasks: TasksControl;
  onClose: () => void;
}

export function NewWorkspaceSteps(props: NewWorkspaceStepsProps): React.JSX.Element {
  return (
    <ReplayUnmask>
      <NewWorkspaceStep {...props} />
    </ReplayUnmask>
  );
}

function NewWorkspaceStep({ tasks, onClose }: NewWorkspaceStepsProps): React.JSX.Element {
  const [at, setAt] = useState<Step>(STEP.TEAM);
  const [made, setMade] = useState<string | undefined>(undefined);
  const [reached, setReached] = useState(false);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  const nameField = useRef<HTMLInputElement | null>(null);
  useEffect(() => nameField.current?.focus(), []);
  const { onChooseWorkspace, onGoHome } = tasks;
  const teamForm = useTeamForm({
    made:
      made === undefined
        ? undefined
        : { id: made, name: tasks.newTask.workspaces.find((one) => one.id === made)?.name },
    onCreated: (workspaceId) => {
      setMade(workspaceId);
      onChooseWorkspace(workspaceId);
    },
    onDone: (failed) => {
      if (failed.length === 0) setAt(STEP.GITHUB);
    },
  });
  const { busy } = teamForm;
  const leave = useCallback(() => {
    if (busy) return;
    onClose();
    if (made !== undefined) onGoHome();
  }, [busy, made, onClose, onGoHome]);
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
  return (
    <AuthPage
      mark={<ProductMark />}
      exit={exit}
      title={made === undefined ? "Create a workspace" : "Your new workspace"}
      description={
        made === undefined
          ? "Tasks, agents, and repositories, shared with your team."
          : "Change its name or photo, or invite more of your team."
      }
      foot={
        <AuthStepFoot
          at={STEP.TEAM + 1}
          total={TOTAL}
          next={{
            label: teamForm.label,
            onPress: teamForm.create,
            disabled: !teamForm.ready,
            busy,
            busyLabel: teamForm.busyLabel,
          }}
        />
      }
    >
      <TeamForm form={teamForm} nameRef={nameField} disabled={busy} />
    </AuthPage>
  );
}

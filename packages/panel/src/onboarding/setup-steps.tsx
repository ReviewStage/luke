import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import {
  APP_SETTING_SCHEMA,
  SETUP_AUDIENCE,
  type SetupAudience,
  type SetupPlace,
  setupPlaceFrom,
  setupPlaceStored,
} from "@repo/settings";
import { AuthPage, AuthStepFoot, ChoiceList, type ChoiceOption, ProductMark } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { welcomed } from "../desktop/desktop-welcome.js";
import { signOutSayingFailure } from "../settings/account-section.js";
import { AgentConnectSection } from "../settings/agent-auth-section.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";
import { keptKey, useKept } from "../use-kept.js";
import { GITHUB_PURPOSE, GitHubSetup } from "./setup-github.js";
import { SETUP_GATE, SETUP_STEP, type SetupGate, setupGate, setupSteps } from "./setup-model.js";
import { TeamForm, useTeamForm } from "./setup-team.js";
import { TOOLS_PURPOSE, ToolRows } from "./setup-tools.js";

const SETUP_FINISHED = keptKey(
  "app.setupFinished",
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

const SETUP_START: SetupPlace = { audience: SETUP_AUDIENCE.ME, at: 0 };
const INVITED_START: SetupPlace = { audience: SETUP_AUDIENCE.INVITED, at: 0 };

function invitedOf(tasks: TasksControl): boolean | undefined {
  const { workspaces } = tasks.newTask;
  if (workspaces.length === 0) return tasks.workspacesFailed ? false : undefined;
  return workspaces.some((workspace) => workspace.personal !== true);
}

export function useSetupGate(
  tasks: TasksControl,
  accountId: string | undefined,
  finishedHere: boolean,
): SetupGate {
  const [finishedOnDevice] = useKept(SETUP_FINISHED, []);
  const [startedHere, setStartedHere] = useState<string>();
  const settings = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data;
  const finishedOnAccount = settings?.setupFinished === true;
  const finished =
    finishedHere ||
    finishedOnAccount ||
    (accountId !== undefined && finishedOnDevice.includes(accountId));
  const { models, modelsFailed } = tasks.newTask;
  const fresh = welcomed(tasks);
  const agent =
    models !== undefined
      ? models.some((model) => model.credentialMissing !== true)
      : modelsFailed
        ? true
        : undefined;
  const gate = setupGate({
    id: accountId,
    fresh,
    finished,
    accountRead: settings?.accountRead === true,
    started:
      accountId !== undefined &&
      (startedHere === accountId || setupPlaceFrom(settings?.setupPlace) !== undefined),
    invited: invitedOf(tasks),
    agent,
  });
  useEffect(() => {
    if (gate === SETUP_GATE.OWED && accountId !== undefined) setStartedHere(accountId);
  }, [gate, accountId]);
  return gate;
}

const AUDIENCES: readonly ChoiceOption<SetupAudience>[] = [
  { value: SETUP_AUDIENCE.ME, label: "Just me" },
  { value: SETUP_AUDIENCE.TEAM, label: "With my team" },
];

export function SetupSteps(props: SetupStepsProps): React.JSX.Element {
  return (
    <ReplayUnmask>
      <SetupStep {...props} />
    </ReplayUnmask>
  );
}

interface SetupStepsProps {
  tasks: TasksControl;
  accountId: string;
  onFinish: () => void;
}

function SetupStep({ tasks, accountId, onFinish }: SetupStepsProps): React.JSX.Element {
  const { mutate: updateSetting } = useMutation(actMutation(ACT_KIND.SETTING_UPDATE));
  const { mutateAsync: signOut } = useMutation(actMutation(ACT_KIND.ACCOUNT_SIGN_OUT));
  const [, , keepFinished] = useKept(SETUP_FINISHED, []);
  const stored = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.setupPlace;
  const kept = setupPlaceFrom(stored);
  const start = invitedOf(tasks) === true ? INVITED_START : SETUP_START;
  const place = kept ?? start;
  const { audience, team } = place;
  const personal = tasks.newTask.workspaces.find((workspace) => workspace.personal === true)?.id;
  const written = useRef<SetupPlace | undefined>(undefined);
  useEffect(() => {
    written.current = setupPlaceFrom(stored);
  }, [stored]);
  const keep = useCallback(
    (next: SetupPlace) => {
      written.current = next;
      updateSetting({ field: APP_SETTING_SCHEMA.setupPlace.field, value: setupPlaceStored(next) });
    },
    [updateSetting],
  );
  const move = (change: Partial<SetupPlace>) => keep({ ...(written.current ?? place), ...change });
  const setAudience = (chosen: SetupAudience) => {
    move({ audience: chosen });
    const listed = chosen === SETUP_AUDIENCE.TEAM ? team : personal;
    if (team !== undefined && listed !== undefined) tasks.onChooseWorkspace(listed);
  };
  const setAt = (step: number) => move({ at: step });
  const [agent, setAgent] = useState(false);
  const [reached, setReached] = useState(false);
  const onConnected = useCallback((connected: boolean) => setAgent(connected), []);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  const steps = setupSteps(audience);
  const at = Math.min(Math.max(place.at, 0), steps.length - 1);
  const step = steps[at] ?? SETUP_STEP.TOOLS;
  const last = at === steps.length - 1;
  const finish = () => {
    updateSetting({ field: APP_SETTING_SCHEMA.setupFinished.field, value: true });
    keepFinished((finished) => [...finished, accountId]);
    onFinish();
  };
  const forward = () => (last ? finish() : setAt(at + 1));
  const back = at === 0 ? undefined : () => setAt(at - 1);
  const workspaceId =
    (audience === SETUP_AUDIENCE.TEAM ? team : personal) ?? tasks.newTask.workspaceId;
  const foot = (done: boolean, label = "Continue", skippable = false) => (
    <AuthStepFoot
      at={at + 1}
      total={steps.length}
      onBack={back}
      onSkip={skippable && !done ? forward : undefined}
      next={done || !skippable ? { label, onPress: forward, disabled: !done } : undefined}
    />
  );
  const exit = {
    label: "Sign out",
    onPress: () =>
      void signOutSayingFailure(async () => {
        await signOut();
      }),
  };
  const teamForm = useTeamForm({
    made:
      team === undefined
        ? undefined
        : { id: team, name: tasks.newTask.workspaces.find((one) => one.id === team)?.name },
    onCreated: (made) => {
      move({ team: made });
      tasks.onChooseWorkspace(made);
    },
    onDone: (failed) => {
      if (failed.length === 0) setAt(at + 1);
    },
  });

  if (step === SETUP_STEP.WELCOME) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title={`Welcome to ${PRODUCT_NAME}`}
        foot={foot(true)}
      >
        <ChoiceList
          legend="Who you'll use it with"
          options={AUDIENCES}
          value={[audience]}
          onChange={([chosen]) => {
            if (chosen !== undefined) setAudience(chosen);
          }}
        />
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.TEAM) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title={team === undefined ? "Create a team workspace" : "Your team workspace"}
        description={
          team === undefined
            ? "Your team shares tasks, agents, and the repositories you connect next."
            : "Change its name or photo, or invite more of your team."
        }
        foot={
          <AuthStepFoot
            at={at + 1}
            total={steps.length}
            onBack={teamForm.busy ? undefined : back}
            next={{
              label: teamForm.label,
              onPress: teamForm.create,
              disabled: !teamForm.ready,
              busy: teamForm.busy,
              busyLabel: teamForm.busyLabel,
            }}
          />
        }
      >
        <TeamForm form={teamForm} disabled={teamForm.busy} />
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.AGENT) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title="Connect an agent"
        description="Run agents on your ChatGPT or Claude plan, or an API key."
        foot={foot(agent, last ? "Finish" : "Continue")}
      >
        <AgentConnectSection onConnected={onConnected} />
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.GITHUB) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title="Connect GitHub"
        description={GITHUB_PURPOSE}
        foot={foot(reached, "Continue", true)}
      >
        {workspaceId === undefined ? null : (
          <GitHubSetup key={workspaceId} workspaceId={workspaceId} onReached={onReached} />
        )}
      </AuthPage>
    );
  }
  return (
    <AuthPage
      mark={<ProductMark />}
      title="Connect your tools"
      description={TOOLS_PURPOSE}
      foot={foot(true, "Finish")}
      exit={exit}
    >
      <ToolRows />
    </AuthPage>
  );
}

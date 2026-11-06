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
import { SETUP_STEP, type SetupGate, setupGate, setupSteps } from "./setup-model.js";
import { TeamForm, useTeamForm } from "./setup-team.js";
import { TOOLS_PURPOSE, ToolRows } from "./setup-tools.js";

/**
 * setup-steps.tsx -- a new account's setup, alone in the window after sign-in: who it is for, a team's workspace where there is one, an agent, GitHub, and the tools, one card each.
 *
 * Each card is the sign-in's own, so setup reads as the sign-in going on,
 * and each offers a quiet Sign out, since setup stands with no sidebar.
 * An account invited into a team's workspace starts on Connect an agent
 * alone. An agent is required: its step goes on only once Claude or Codex
 * is connected. A team's workspace is required too, once With my team is
 * chosen, since Back leads to Just me for anyone who changed their mind;
 * once made, its step coming back holds it to change rather than make again.
 * GitHub may be skipped, and the tools need nothing done. Where setup
 * stands is kept on the account (`APP_SETTING_SCHEMA.setupPlace`), so setup
 * left partway resumes at the same step on another machine or on the web,
 * and a team's workspace made is not offered to be made again. Finish lets
 * the app in and keeps, on the account (`APP_SETTING_SCHEMA.setupFinished`),
 * that it finished setup, so it stands once on every machine.
 */

/**
 * The accounts that finished setup on this device, by id: the account's own
 * `setupFinished` read ahead of its preferences arriving.
 */
const SETUP_FINISHED = keptKey(
  "app.setupFinished",
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

/** Where setup starts, for an account of its own or one a team invited. */
const SETUP_START: SetupPlace = { audience: SETUP_AUDIENCE.ME, at: 0 };
const INVITED_START: SetupPlace = { audience: SETUP_AUDIENCE.INVITED, at: 0 };

/** Whether the account belongs to a team's workspace; nothing before its workspaces are read, and none where that read failed. */
function invitedOf(tasks: TasksControl): boolean | undefined {
  const { workspaces } = tasks.newTask;
  if (workspaces.length === 0) return tasks.workspacesFailed ? false : undefined;
  return workspaces.some((workspace) => workspace.personal !== true);
}

/**
 * What the window does about setup for the account signed in (`setupGate`):
 * it reads whether an agent is connected, asking for the models where no
 * read has, only for an account that could still be new.
 */
export function useSetupGate(
  tasks: TasksControl,
  accountId: string | undefined,
  /** Whether setup was finished in this window, before the account's setting comes back from its write. */
  finishedHere: boolean,
): SetupGate {
  const [finishedOnDevice] = useKept(SETUP_FINISHED, []);
  const settings = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data;
  const finishedOnAccount = settings?.setupFinished === true;
  // Note that this device's own record stands beside the account's, because the account's arrives only once its preferences are read, and a device clears them at every sign-out.
  const finished =
    finishedHere ||
    finishedOnAccount ||
    (accountId !== undefined && finishedOnDevice.includes(accountId));
  // Note that the models are the ones the host holds for the account, so nothing here asks for them.
  const { models, modelsFailed } = tasks.newTask;
  const fresh = welcomed(tasks);
  // Note that a read that failed is taken as an agent standing, so a hitch never stands setup before an account that has worked.
  const agent =
    models !== undefined
      ? models.some((model) => model.credentialMissing !== true)
      : modelsFailed
        ? true
        : undefined;
  return setupGate({
    id: accountId,
    fresh,
    finished,
    accountRead: settings?.accountRead === true,
    // Note that the place is the account's, so setup started on another machine stands here once its preferences are read.
    started: accountId !== undefined && setupPlaceFrom(settings?.setupPlace) !== undefined,
    invited: invitedOf(tasks),
    agent,
  });
}

const AUDIENCES: readonly ChoiceOption<SetupAudience>[] = [
  { value: SETUP_AUDIENCE.ME, label: "Just me" },
  { value: SETUP_AUDIENCE.TEAM, label: "With my team" },
];

/**
 * Setup, step by step; `onFinish` lets the app in. Note that its words show
 * in a screen recording, because they are the app's own, but for a person's,
 * which each step masks where it draws them.
 */
export function SetupSteps(props: SetupStepsProps): React.JSX.Element {
  return (
    <ReplayUnmask>
      <SetupStep {...props} />
    </ReplayUnmask>
  );
}

/** What setup is handed. */
interface SetupStepsProps {
  tasks: TasksControl;
  /** The account set up, whose finish this device keeps under its id. */
  accountId: string;
  onFinish: () => void;
}

/** The step setup stands at. */
function SetupStep({ tasks, accountId, onFinish }: SetupStepsProps): React.JSX.Element {
  const { mutate: updateSetting } = useMutation(actMutation(ACT_KIND.SETTING_UPDATE));
  const { mutateAsync: signOut } = useMutation(actMutation(ACT_KIND.ACCOUNT_SIGN_OUT));
  const [, , keepFinished] = useKept(SETUP_FINISHED, []);
  const stored = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.setupPlace;
  const kept = setupPlaceFrom(stored);
  // Note that where setup starts is decided as it first stands, so a team's workspace made midway keeps the steps it was making.
  const start = invitedOf(tasks) === true ? INVITED_START : SETUP_START;
  const place = kept ?? start;
  const { audience, team } = place;
  // Note that each move is merged over the last one written, because two may land before the account's place comes back, as a team's workspace made and the step after it do.
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
  // Setup starting is kept at once, so it stands until finished on a reload or another machine, whatever it connects meanwhile.
  useEffect(() => {
    if (kept === undefined && written.current === undefined) keep(start);
  }, [kept, keep, start]);
  const setAudience = (chosen: SetupAudience) => move({ audience: chosen });
  const setAt = (step: number) => move({ at: step });
  const [agent, setAgent] = useState(false);
  const [reached, setReached] = useState(false);
  const onConnected = useCallback((connected: boolean) => setAgent(connected), []);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  const steps = setupSteps(audience);
  // A place kept by another window or an earlier build may stand past the last step, which is held to it.
  const at = Math.min(Math.max(place.at, 0), steps.length - 1);
  const step = steps[at] ?? SETUP_STEP.TOOLS;
  const last = at === steps.length - 1;
  const finish = () => {
    // Note that the account's place stands once finished, since finished is read ahead of it on every machine.
    // Note that nothing waits on the write: the window lets the app in at once, and a write lost asks for setup again next time.
    updateSetting({ field: APP_SETTING_SCHEMA.setupFinished.field, value: true });
    keepFinished((finished) => [...finished, accountId]);
    onFinish();
  };
  const forward = () => (last ? finish() : setAt(at + 1));
  const back = at === 0 ? undefined : () => setAt(at - 1);
  // A team's workspace made and then left for Just me is not the one GitHub is installed on.
  const workspaceId =
    (audience === SETUP_AUDIENCE.TEAM ? team : undefined) ?? tasks.newTask.workspaceId;
  // Note that a skippable step offers Skip until done and Continue after it; the team's draws its own foot.
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
    // Note that the step stays where something was refused, so each refusal is read beside its address.
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
    // Note that the press makes the workspace until it stands, then saves what was changed in it, or goes on.
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

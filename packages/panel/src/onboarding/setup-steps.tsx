import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import { APP_SETTING_SCHEMA } from "@repo/settings";
import {
  AuthPage,
  AuthStepFoot,
  ChoiceList,
  type ChoiceOption,
  ProductMark,
  SETTINGS_ROW_STATE,
  SettingsRowStateLine,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { Schema } from "effect";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { welcomed } from "../desktop/desktop-welcome.js";
import { AgentConnectSection } from "../settings/agent-auth-section.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { APP_SETTINGS_VIEW, useAppSlice } from "../use-app-state.js";
import { keptKey, useKept } from "../use-kept.js";
import { GitHubSetup } from "./setup-github.js";
import {
  SETUP_AUDIENCE,
  SETUP_STEP,
  type SetupAudience,
  type SetupGate,
  setupGate,
  setupSteps,
} from "./setup-model.js";
import { TeamForm, useTeamForm } from "./setup-team.js";
import { ToolRows } from "./setup-tools.js";

/**
 * setup-steps.tsx -- a new account's setup, alone in the window after sign-in: who it is for, a team's workspace where there is one, an agent, GitHub, and the tools, one card each.
 *
 * Each card is the sign-in's own, so setup reads as the sign-in going on.
 * The team's workspace, an agent, and GitHub may each be skipped; what an
 * agent needs and was skipped is asked again on Home
 * (`setup-sections.tsx`, on Home). Finish lets the app in and keeps, on the
 * account (`APP_SETTING_SCHEMA.setupFinished`), that it finished setup, so it
 * stands once on every machine.
 */

/** Where an account stands in setup: who it is for, the step it is on, and the team's workspace once made. */
const setupPlace = Schema.Struct({
  audience: Schema.Literals(Object.values(SETUP_AUDIENCE)),
  at: Schema.Number,
  team: Schema.optionalKey(Schema.String),
});

type SetupPlace = typeof setupPlace.Type;

/**
 * Each account's place in setup on this machine, by its id, so a reload
 * comes back to the step it left rather than the first, and a team's
 * workspace made is not offered to be made again.
 */
const SETUP_PLACE = keptKey(
  "app.setupPlace",
  Schema.fromJsonString(Schema.Record(Schema.String, setupPlace)),
);

/**
 * The accounts that finished setup on this device, by id: the account's own
 * `setupFinished` read ahead of its preferences arriving.
 */
const SETUP_FINISHED = keptKey(
  "app.setupFinished",
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

/** Where setup starts. */
const SETUP_START: SetupPlace = { audience: SETUP_AUDIENCE.ME, at: 0 };

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
  const [places] = useKept(SETUP_PLACE, {});
  const [finishedOnDevice] = useKept(SETUP_FINISHED, []);
  const settings = useAppSlice(APP_SETTINGS_VIEW);
  const finishedOnAccount = settings?.setupFinished === true;
  // Note that this device's own record stands beside the account's, because the account's arrives only once its preferences are read, and a device clears them at every sign-out.
  const finished =
    finishedHere ||
    finishedOnAccount ||
    (accountId !== undefined && finishedOnDevice.includes(accountId));
  // Note that the models are the ones the host holds for the account, so nothing here asks for them.
  const { models, modelsFailed, workspaces } = tasks.newTask;
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
    started: accountId !== undefined && places[accountId] !== undefined,
    personalOnly: workspaces.every((workspace) => workspace.personal === true),
    agent,
  });
}

const AUDIENCES: readonly ChoiceOption<SetupAudience>[] = [
  { value: SETUP_AUDIENCE.ME, label: "Just me" },
  { value: SETUP_AUDIENCE.TEAM, label: "With my team" },
];

/** Setup, step by step; `onFinish` lets the app in. */
export function SetupSteps({
  tasks,
  accountId,
  onFinish,
}: {
  tasks: TasksControl;
  /** The account set up, whose place in setup is kept under its id. */
  accountId: string;
  onFinish: () => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const [places, , changePlaces] = useKept(SETUP_PLACE, {});
  const [, , keepFinished] = useKept(SETUP_FINISHED, []);
  const place = places[accountId] ?? SETUP_START;
  const { audience, team } = place;
  const [creating, setCreating] = useState(false);
  const [refused, setRefused] = useState<readonly string[]>([]);
  const move = (change: Partial<SetupPlace>) =>
    changePlaces((kept) => ({
      ...kept,
      [accountId]: { ...(kept[accountId] ?? SETUP_START), ...change },
    }));
  // Setup starting is kept at once, so it stands until finished on a reload, whatever it connects meanwhile.
  useEffect(() => {
    changePlaces((kept) =>
      kept[accountId] === undefined ? { ...kept, [accountId]: SETUP_START } : kept,
    );
  }, [accountId, changePlaces]);
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
    // Finished, the account's place is let go of, as setup stands no more on any machine.
    // Note that nothing waits on the write: the window lets the app in at once, and a write lost asks for setup again next time.
    tell(ACT_KIND.SETTING_UPDATE, { field: APP_SETTING_SCHEMA.setupFinished.field, value: true });
    keepFinished((finished) => [...finished, accountId]);
    changePlaces(({ [accountId]: _done, ...rest }) => rest);
    onFinish();
  };
  const forward = () => (last ? finish() : setAt(at + 1));
  const back = at === 0 ? undefined : () => setAt(at - 1);
  // A team's workspace made and then left for Just me is not the one GitHub is installed on.
  const workspaceId =
    (audience === SETUP_AUDIENCE.TEAM ? team : undefined) ?? tasks.newTask.workspaceId;
  const foot = (done: boolean, optional: boolean, label = "Continue") => (
    <AuthStepFoot
      at={at + 1}
      total={steps.length}
      onBack={back}
      onSkip={optional && !done ? forward : undefined}
      next={done || !optional ? { label, onPress: forward, disabled: !done } : undefined}
    />
  );
  const teamForm = useTeamForm({
    onCreated: (made) => {
      setCreating(true);
      move({ team: made });
      tasks.onChooseWorkspace(made);
    },
    onDone: (failed) => {
      setCreating(false);
      setRefused(failed);
      if (failed.length === 0) setAt(at + 1);
    },
  });

  if (step === SETUP_STEP.WELCOME) {
    return (
      <AuthPage
        mark={<ProductMark />}
        title={`Welcome to ${PRODUCT_NAME}`}
        foot={foot(true, false)}
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
    const forming = team === undefined || creating;
    // Note that Create is the step's way on until the workspace is made, and Continue after it.
    return (
      <AuthPage
        mark={<ProductMark />}
        title="Create a team workspace"
        foot={
          forming ? (
            <AuthStepFoot
              at={at + 1}
              total={steps.length}
              onBack={back}
              onSkip={teamForm.busy ? undefined : forward}
              next={{
                label: "Create",
                onPress: teamForm.create,
                disabled: !teamForm.named,
                busy: teamForm.busy,
                busyLabel: "Creating",
              }}
            />
          ) : (
            foot(true, false)
          )
        }
      >
        {forming ? (
          <TeamForm form={teamForm} />
        ) : (
          <>
            <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
              Workspace created
            </SettingsRowStateLine>
            {refused.map((words) => (
              <Text key={words} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {words}
              </Text>
            ))}
          </>
        )}
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.AGENT) {
    return (
      <AuthPage
        mark={<ProductMark />}
        title="Connect an agent"
        description="Run agents on your ChatGPT or Claude plan, or an API key."
        foot={foot(agent, true)}
      >
        <AgentConnectSection onConnected={onConnected} />
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.GITHUB) {
    return (
      <AuthPage mark={<ProductMark />} title="Connect GitHub" foot={foot(reached, true)}>
        {workspaceId === undefined ? null : (
          <GitHubSetup key={workspaceId} workspaceId={workspaceId} onReached={onReached} />
        )}
      </AuthPage>
    );
  }
  return (
    <AuthPage mark={<ProductMark />} title="Connect your tools" foot={foot(true, false, "Finish")}>
      <ToolRows />
    </AuthPage>
  );
}

import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import { APP_SETTING_SCHEMA } from "@repo/settings";
import {
  AuthPage,
  BUTTON_VARIANT,
  Button,
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
import { AgentAuthSection } from "../settings/agent-auth-section.js";
import { MODELS_READ } from "../tasks/use-agents.js";
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
import { TeamForm } from "./setup-team.js";
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
  const finishedOnAccount = useAppSlice(APP_SETTINGS_VIEW)?.setupFinished === true;
  const finished = finishedHere || finishedOnAccount;
  const { models, modelsRead, readModels, workspaces } = tasks.newTask;
  const fresh = welcomed(tasks);
  const candidate = fresh && accountId !== undefined && !finished;
  useEffect(() => {
    if (candidate && modelsRead.state === MODELS_READ.UNREAD) readModels();
  }, [candidate, modelsRead.state, readModels]);
  // Note that a read that failed is taken as an agent standing, so a hitch never stands setup before an account that has worked.
  const agent =
    models !== undefined
      ? models.some((model) => model.credentialMissing !== true)
      : modelsRead.state === MODELS_READ.FAILED
        ? true
        : undefined;
  return setupGate({
    id: accountId,
    fresh,
    finished,
    started: accountId !== undefined && places[accountId] !== undefined,
    personalOnly: workspaces.every((workspace) => workspace.personal === true),
    agent,
  });
}

const AUDIENCES: readonly ChoiceOption<SetupAudience>[] = [
  { value: SETUP_AUDIENCE.ME, label: "Just me" },
  { value: SETUP_AUDIENCE.TEAM, label: "With my team" },
];

/** The Agents rows' API keys, which setup reads no further. */
const IGNORE_KEYS = () => undefined;

/** A card's foot: where it stands among the steps, Back, Skip, and its way on. */
function StepFoot({
  at,
  total,
  onBack,
  onSkip,
  next,
}: {
  at: number;
  total: number;
  onBack: (() => void) | undefined;
  onSkip: (() => void) | undefined;
  next: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mt-ui-8 flex items-center gap-control-gap">
      {onBack === undefined ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} onClick={onBack}>
          Back
        </Button>
      )}
      <span className="grow text-caption text-muted-foreground tabular-nums">
        {at} of {total}
      </span>
      {onSkip === undefined ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} onClick={onSkip}>
          Skip
        </Button>
      )}
      {next}
    </div>
  );
}

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
    changePlaces(({ [accountId]: _done, ...rest }) => rest);
    onFinish();
  };
  const forward = () => (last ? finish() : setAt(at + 1));
  const back = at === 0 ? undefined : () => setAt(at - 1);
  // A team's workspace made and then left for Just me is not the one GitHub is installed on.
  const workspaceId =
    (audience === SETUP_AUDIENCE.TEAM ? team : undefined) ?? tasks.newTask.workspaceId;
  const foot = (done: boolean, optional: boolean, label = "Continue") => (
    <StepFoot
      at={at + 1}
      total={steps.length}
      onBack={back}
      onSkip={optional && !done ? forward : undefined}
      next={
        done || !optional ? (
          <Button variant={BUTTON_VARIANT.PRIMARY} disabled={!done} onClick={forward}>
            {label}
          </Button>
        ) : null
      }
    />
  );

  if (step === SETUP_STEP.WELCOME) {
    return (
      <AuthPage mark={<ProductMark />} title={`Welcome to ${PRODUCT_NAME}`}>
        <ChoiceList
          legend="Who you'll use it with"
          options={AUDIENCES}
          value={[audience]}
          onChange={([chosen]) => {
            if (chosen !== undefined) setAudience(chosen);
          }}
        />
        {foot(true, false)}
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.TEAM) {
    return (
      <AuthPage mark={<ProductMark />} title="Create a team workspace">
        {team === undefined || creating ? (
          <TeamForm
            onCreated={(made) => {
              setCreating(true);
              move({ team: made });
              tasks.onChooseWorkspace(made);
            }}
            onDone={(failed) => {
              setCreating(false);
              setRefused(failed);
              if (failed.length === 0) setAt(at + 1);
            }}
          />
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
        {foot(team !== undefined && !creating, team === undefined)}
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.AGENT) {
    return (
      <AuthPage
        mark={<ProductMark />}
        title="Connect an agent"
        description="Agents run on your own Claude or Codex plan."
      >
        <AgentAuthSection signedIn onKeys={IGNORE_KEYS} onConnected={onConnected} />
        {foot(agent, true)}
      </AuthPage>
    );
  }
  if (step === SETUP_STEP.GITHUB) {
    return (
      <AuthPage mark={<ProductMark />} title="Connect GitHub">
        {workspaceId === undefined ? null : (
          <GitHubSetup
            key={workspaceId}
            workspaceId={workspaceId}
            repositories={tasks.newTask.repositoriesIn(workspaceId)}
            onReached={onReached}
          />
        )}
        {foot(reached, true)}
      </AuthPage>
    );
  }
  return (
    <AuthPage mark={<ProductMark />} title="Connect your tools">
      <ToolRows />
      {foot(true, false, "Finish")}
    </AuthPage>
  );
}

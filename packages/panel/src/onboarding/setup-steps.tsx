import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  AuthPage,
  BUTTON_VARIANT,
  Button,
  ChoiceList,
  type ChoiceOption,
  ProductMark,
} from "@repo/ui";
import { Schema } from "effect";
import { useCallback, useState } from "react";
import { AgentAuthSection } from "../settings/agent-auth-section.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { keptKey } from "../use-kept.js";
import { SETUP_AUDIENCE, SETUP_STEP, type SetupAudience, setupSteps } from "./setup-model.js";
import { GitHubSetup } from "./setup-github.js";
import { TeamForm } from "./setup-team.js";
import { ToolRows } from "./setup-tools.js";

/**
 * setup-steps.tsx -- a new account's setup, alone in the window after sign-in: who it is for, a team's workspace where there is one, an agent, GitHub, and the tools, one card each.
 *
 * Each card is the sign-in's own, so setup reads as the sign-in going on.
 * The team's workspace, an agent, and GitHub may each be skipped; what an
 * agent needs and was skipped is asked again on Home
 * (`setup-sections.tsx`, on Home). Finish lets the app in and keeps, on this
 * machine, that the account finished setup, so it stands once.
 */

/** The accounts that finished setup on this machine, by id. */
export const SETUP_FINISHED = keptKey(
  "app.setupFinished",
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

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
  onFinish,
}: {
  tasks: TasksControl;
  onFinish: () => void;
}): React.JSX.Element {
  const [audience, setAudience] = useState<SetupAudience>(SETUP_AUDIENCE.ME);
  const [at, setAt] = useState(0);
  const [team, setTeam] = useState<string | undefined>(undefined);
  const [agent, setAgent] = useState(false);
  const [reached, setReached] = useState(false);
  const onConnected = useCallback((connected: boolean) => setAgent(connected), []);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  const steps = setupSteps(audience);
  const step = steps[at] ?? SETUP_STEP.TOOLS;
  const last = at === steps.length - 1;
  const forward = () => (last ? onFinish() : setAt(at + 1));
  const back = at === 0 ? undefined : () => setAt(at - 1);
  const workspaceId = team ?? tasks.newTask.workspaceId;
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
        {team === undefined ? (
          <TeamForm
            onCreated={(made) => {
              setTeam(made);
              tasks.onChooseWorkspace(made);
              setAt(at + 1);
            }}
          />
        ) : null}
        {foot(team !== undefined, true)}
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

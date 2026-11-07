import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dateOfText } from "@repo/features/time-format";
import { SIGNED_OUT_WORDS } from "@repo/features/words";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceExperimentChoice,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  EXPERIMENT,
  type ExperimentChoices,
  type ExperimentEntry,
  experimentOn,
  isWorkspaceExperiment,
  type WorkspaceExperiment,
} from "@repo/settings";
import { EXPERIMENT_ANCHOR, SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  EmptyState,
  SettingsRowStateLine,
  SettingsSection,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  useConfirmDialog,
  useMinute,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { FlaskConicalIcon } from "lucide-react";
import { useState } from "react";
import { actMutation } from "../act-mutations.js";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { MemberDirectory, usePerson } from "../member-directory.js";
import { useOpenFeedback } from "../open-feedback.js";
import { actionRefused, refusalToast, rowWrite } from "./row-write.js";
import { SwitchRow } from "./switch-row.js";

/**
 * experimental-page.tsx -- Settings › Experimental: the features not yet finished, in two groups that each say whom a switch reaches and who may flip it, or the empty state between them.
 *
 * The first group is the workspace Settings shows: Task descriptions, Pilot,
 * and Memory, which its owners and admins choose for every member and agent
 * in it (Dean, 2026-11-06). Each row says, under what the experiment
 * brings, who last turned it on or off and when, the person as their chip;
 * the switch says whether it is on, so no word or dot says it again. A
 * member who is no owner or admin sees the same switches locked, the reason
 * their tooltip and nothing more. Every flip asks first, in a dialog saying
 * what changes for everyone in the workspace and that nothing is deleted
 * (`CONFIRM_LOSS.AFFECTS_OTHERS`), since it reaches every member; the
 * choice is drawn as the act is sent (`ACT_KIND.WORKSPACE_EXPERIMENT_SET`)
 * and stands once the workspace's live row agrees.
 *
 * The second group is the account's own, Skills and Bring your own host,
 * which change the app only for the reader, in every workspace: a row's
 * switch writes the account's choice at once, as every Settings switch
 * writes, and a write the service refused puts it back and is said in a
 * toast.
 *
 * Each row's Send feedback opens the window's feedback dialog about that
 * experiment. With none standing, the page draws the empty state the empty
 * Inbox draws, so a link or a search result that lands here never lands on
 * nothing.
 */

/** What the empty page says. */
const NO_EXPERIMENTS_LINE = "No experiments.";

/** Why a signed-out page holds no switches: experiments are a workspace's or an account's. */
const SIGN_IN_NOTE = SIGNED_OUT_WORDS;

/** The words of the page's groups and rows. */
const WORDS = {
  ACCOUNT_TITLE: "Just for you",
  ACCOUNT_CAPTION: `These change ${PRODUCT_NAME} only for you, in every workspace you're in.`,
  WORKSPACE_TITLE: "For everyone in ",
  WORKSPACE_CAPTION_START: `These change ${PRODUCT_NAME} for every member and agent in `,
  WORKSPACE_CAPTION_END: ". Only admins can change them.",
  LOCKED: "Only an admin can change this",
  SEND_FEEDBACK: "Send feedback",
  NOTHING_DELETED: "Nothing is deleted; turning it back on brings it all back.",
  KEPT_WHEN_OFF: "Turning it off later deletes nothing.",
} as const;

/** What turning each workspace experiment on or off changes for everyone in `workspace`, as its question says it. */
const FLIP_WORDS = {
  [EXPERIMENT.DESCRIPTIONS]: {
    on: (workspace: string) =>
      `Shows each task's description, its comments and version history to everyone in ${workspace}, and has agents keep descriptions current as they work.`,
    off: (workspace: string) =>
      `Hides task descriptions, their comments and version history for everyone in ${workspace}, and stops agents from reading or writing them.`,
  },
  [EXPERIMENT.PILOT]: {
    on: (workspace: string) =>
      `Lets everyone in ${workspace} start a new task with a pilot agent that plans the work, splits it into sub-tasks, and runs an agent on each.`,
    off: (workspace: string) =>
      `Stops new tasks in ${workspace} from starting with a pilot agent. Pilots already running finish their work.`,
  },
  [EXPERIMENT.MEMORY]: {
    on: (workspace: string) =>
      `Lets agents in ${workspace} keep settled facts about how your team works and recall them in later work, reviewed in Settings › Memory.`,
    off: (workspace: string) =>
      `Stops agents in ${workspace} from keeping or recalling memories, and hides Settings › Memory for everyone.`,
  },
} as const satisfies Record<
  WorkspaceExperiment,
  { readonly on: (workspace: string) => string; readonly off: (workspace: string) => string }
>;

/** Whom a flip reaches, by how many members the workspace holds where the list says. */
function reachWords(workspace: Pick<Workspace, "name" | "memberCount">): string {
  const { name, memberCount } = workspace;
  return memberCount === undefined || memberCount < 2
    ? `This changes ${PRODUCT_NAME} for everyone in ${name} and their agents.`
    : `This changes ${PRODUCT_NAME} for all ${memberCount} members of ${name} and their agents.`;
}

/** The question a flip of `entry` to `on` asks for everyone in `workspace`. */
function flipQuestion(
  entry: ExperimentEntry & { readonly key: WorkspaceExperiment },
  on: boolean,
  workspace: Pick<Workspace, "name" | "memberCount">,
): DialogQuestion {
  const changes = FLIP_WORDS[entry.key][on ? "on" : "off"](workspace.name);
  const kept = on ? WORDS.KEPT_WHEN_OFF : WORDS.NOTHING_DELETED;
  return {
    title: `Turn ${on ? "on" : "off"} ${entry.name} for everyone in ${workspace.name}?`,
    body: `${reachWords(workspace)} ${changes} ${kept}`,
    verb: on ? "Turn on for everyone" : "Turn off for everyone",
    running: on ? "Turning on…" : "Turning off…",
    loss: CONFIRM_LOSS.AFFECTS_OTHERS,
    replayUnmasked: true,
    titleReplayMasked: true,
    bodyReplayMasked: true,
  };
}

/** An act the host answered without refusing it. */
const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** One experiment's detail: what turning it on brings, and the way to say how it went. */
function ExperimentDetail({ entry }: { entry: ExperimentEntry }): React.JSX.Element {
  const openFeedback = useOpenFeedback();
  return (
    <>
      {`${entry.detail} `}
      <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => openFeedback(entry.key)}>
        {WORDS.SEND_FEEDBACK}
      </TextButton>
    </>
  );
}

/** Who last turned a workspace experiment on or off, as their chip, and the day; their words alone where that account is gone. */
function ChangedLine({ choice }: { choice: WorkspaceExperimentChoice }): React.JSX.Element {
  const now = useMinute();
  const { changedBy } = choice;
  const person = usePerson(
    changedBy === null ? undefined : { userId: changedBy.id, name: changedBy.name },
  );
  const turned = choice.on ? "Turned on" : "Turned off";
  const day = dateOfText(choice.changedAt, now);
  return (
    <SettingsRowStateLine block wrap>
      {changedBy === null ? (
        `${turned} ${day}`
      ) : (
        <ActorLine>
          {`${turned} by `}
          <ActorRef actor={person} sentence />
          {` on ${day}`}
        </ActorLine>
      )}
    </SettingsRowStateLine>
  );
}

/**
 * One workspace experiment's row: its switch, locked for a member who is no
 * owner or admin, what it brings, and who last changed it; a flip asks first.
 */
function WorkspaceExperimentRow({
  entry,
  workspace,
}: {
  entry: ExperimentEntry & { readonly key: WorkspaceExperiment };
  workspace: Workspace;
}): React.JSX.Element {
  const choice = workspace.experiments?.find((each) => each.experiment === entry.key);
  const on = choice?.on === true;
  const admin = workspace.role !== WORKSPACE_ROLE.MEMBER;
  // The state a flip asked for, which its question names until another flip asks again.
  const [asked, setAsked] = useState<boolean | undefined>(undefined);
  const mutation = useMutation(actMutation(ACT_KIND.WORKSPACE_EXPERIMENT_SET));
  const act = useConfirmAct(mutation, {
    send: () =>
      mutation.mutateAsync({
        workspaceId: workspace.id,
        experiment: entry.key,
        on: asked === true,
      }),
    answered: () => ACCEPTED,
    failed: (error) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: error.message }),
  });
  const confirm = useConfirmDialog(
    { subject: asked !== undefined, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_EXPERIMENT),
  );
  return (
    <>
      <SwitchRow
        label={entry.name}
        labelReplayUnmasked
        anchor={EXPERIMENT_ANCHOR[entry.key]}
        detail={
          <>
            <ExperimentDetail entry={entry} />
            {choice === undefined ? null : <ChangedLine choice={choice} />}
          </>
        }
        checked={on}
        locked={admin ? undefined : WORDS.LOCKED}
        onChange={(next) => {
          setAsked(next);
          confirm.ask();
        }}
      />
      <ConfirmDialog
        open={asked !== undefined}
        confirm={confirm}
        question={flipQuestion(entry, asked === true, workspace)}
      />
    </>
  );
}

/** One of the account's own experiments: its switch, written at once, and what it brings. */
function AccountExperimentRow({
  entry,
  on,
}: {
  entry: ExperimentEntry;
  on: boolean;
}): React.JSX.Element {
  const mutation = useMutation({
    ...actMutation(ACT_KIND.EXPERIMENT_SET),
    onSettled: refusalToast(actionRefused),
  });
  return (
    <SwitchRow
      label={entry.name}
      labelReplayUnmasked
      anchor={EXPERIMENT_ANCHOR[entry.key]}
      detail={<ExperimentDetail entry={entry} />}
      checked={on}
      write={rowWrite(mutation, {
        ask: (next: boolean) => ({ experiment: entry.key, on: next }),
        refused: actionRefused,
        drawn: (asked) => asked.on,
      })}
    />
  );
}

/** Whether an entry is a workspace experiment's, which narrows its key to one. */
function isWorkspaceEntry(
  entry: ExperimentEntry,
): entry is ExperimentEntry & { readonly key: WorkspaceExperiment } {
  return isWorkspaceExperiment(entry.key);
}

/** The page: the workspace's experiments and the account's own, each in its group, or the empty state while none stands; a note while signed out. */
export function ExperimentalPage({
  entries,
  experiments,
  signedIn,
  workspace,
  readerId,
}: {
  /** The experiments standing, newest first: `EXPERIMENTS`, as the registry lists them. */
  entries: readonly ExperimentEntry[];
  /** The account's own choices, as the settings carry them. */
  experiments: ExperimentChoices;
  signedIn: boolean;
  /** The workspace Settings shows, whose experiments the first group holds; none while none is read. */
  workspace: Workspace | undefined;
  /** The reader's account, whose own change is named as theirs. */
  readerId: string | undefined;
}): React.JSX.Element {
  if (!signedIn) {
    return (
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {SIGN_IN_NOTE}
      </Text>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState icon={<FlaskConicalIcon />} replayUnmasked>
        {NO_EXPERIMENTS_LINE}
      </EmptyState>
    );
  }
  const workspaceEntries = entries.filter(isWorkspaceEntry);
  const accountEntries = entries.filter((entry) => !isWorkspaceExperiment(entry.key));
  return (
    <>
      {workspace === undefined || workspaceEntries.length === 0 ? null : (
        <MemberDirectory workspace={workspace} readerId={readerId}>
          <SettingsSection
            anchor={SETTINGS_SEARCH_ROW.EXPERIMENTS_WORKSPACE}
            title={
              <>
                {WORDS.WORKSPACE_TITLE}
                <ReplayMask>{workspace.name}</ReplayMask>
              </>
            }
            caption={
              <>
                {WORDS.WORKSPACE_CAPTION_START}
                <ReplayMask>{workspace.name}</ReplayMask>
                {WORDS.WORKSPACE_CAPTION_END}
              </>
            }
          >
            {workspaceEntries.map((entry) => (
              <WorkspaceExperimentRow key={entry.key} entry={entry} workspace={workspace} />
            ))}
          </SettingsSection>
        </MemberDirectory>
      )}
      {accountEntries.length === 0 ? null : (
        <SettingsSection
          anchor={SETTINGS_SEARCH_ROW.EXPERIMENTS_ACCOUNT}
          title={WORDS.ACCOUNT_TITLE}
          caption={WORDS.ACCOUNT_CAPTION}
        >
          {accountEntries.map((entry) => (
            <AccountExperimentRow
              key={entry.key}
              entry={entry}
              on={experimentOn(experiments, entry.key)}
            />
          ))}
        </SettingsSection>
      )}
    </>
  );
}

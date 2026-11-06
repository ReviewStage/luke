import {
  AUTOMATION_NEXT,
  type AutomationGroup,
  automationGroups,
  automationNext,
  automationOwner,
  automationRunStanding,
  automationTriggerText,
} from "@repo/features/automation-list-model";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationView,
} from "@repo/features/automation-view";
import {
  AUTOMATION_SCOPE,
  type AutomationScope,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { momentText } from "@repo/features/time-format";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BackButton,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  ConfirmDialog,
  DetailPage,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FoldingButton,
  type FoldingButtonHint,
  GAP,
  IconButton,
  Inline,
  ListRow,
  NOT_FOUND_THING,
  NotFound,
  OneLine,
  PAGE_FRAME,
  RowHint,
  RowHintOptions,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
  type ToolbarProps,
  Tooltip,
  useConfirmDialog,
  useLeaving,
  useMinute,
  VisuallyHidden,
} from "@repo/ui";
import { ACTOR_KIND, actorName } from "@repo/ui/actor-model";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BotIcon, PlusIcon, ZapIcon } from "lucide-react";
import { Fragment, useCallback, useState } from "react";
import { unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useConfirmAct } from "../confirm-act.js";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { workspaceIntegrationsQuery, workspaceIntegrationsRetryMutation } from "../live-reads.js";
import { MemberDirectory, useCreator } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { GLYPH_STATE, glyphStateWords, stateEndMark } from "../state-glyph.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { rowMenu } from "./action-menu.js";
import {
  AutomationEditor,
  AutomationPageSkeleton,
  AutomationSwitch,
  automationActionGroups,
  RUN_REFUSAL_WORDS,
  runNowAction,
  type SentryOffer,
} from "./automation-editor.js";
import {
  AutomationGroupList,
  AutomationListSkeleton,
  AutomationOwnerFrame,
  AutomationRowMeta,
  AutomationsToolbar,
} from "./automation-list-frame.js";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner.js";
import { RunsSkeleton, STANDING_GLYPH } from "./automation-runs-panel.js";
import {
  RUNS_SHOWN,
  type RunsShown,
  runningRuns,
  runsCount,
  runsShownChoices,
  WorkspaceRuns,
} from "./automation-runs-tab.js";
import {
  automationDeleteQuestion,
  automationNarrowLine,
  automationNextText,
  automationOwnerName,
  READING_AUTOMATIONS,
} from "./automation-words.js";
import { PhoneHead, PlaceMore, phoneBar, phoneFindGroups } from "./phone-head.js";
import { useWorkspaceRuns, type WorkspaceRunsRead } from "./use-automation-runs.js";
import { AUTOMATION_DELETE_MUTATION, useAutomations } from "./use-automations.js";

const ROW_THING = "Automation";

const AUTOMATIONS = "Automations";

const DELETE_REFUSAL_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "This automation, or its workspace, is gone.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.INVALID]: "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can delete it.",
} as const satisfies Record<AutomationCallFailure, string>;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

const NEW_AUTOMATION = "New automation";
const CREATE_WITH_AGENT = "Create with an agent";

const UNREAD_LINE = "The automations could not be read.";

const RUNS_UNREAD_LINE = "The runs could not be read.";
const READING_RUNS = "Reading the runs…";

const WORKSPACES_UNREAD_LINE = "The workspaces could not be read.";

const NO_WORKSPACE_HINT = "Choose a workspace first";

const NoWorkspaceHint: FoldingButtonHint = ({ label, children }) => (
  <Tooltip label={label === undefined ? NO_WORKSPACE_HINT : `${label}: ${NO_WORKSPACE_HINT}`}>
    {children}
  </Tooltip>
);

function OwnerCell({
  owner,
  mine,
  workspace,
}: {
  owner: AutomationScope;
  mine: boolean;
  workspace: Workspace | undefined;
}): React.JSX.Element {
  const name = automationOwnerName(owner, workspace?.name, mine);
  return (
    <Tooltip label={name}>
      <AutomationOwnerFrame
        owner={owner}
        mark={
          <OwnerMark
            owner={owner}
            workspace={workspace}
            mine={mine}
            size={OWNER_MARK_SIZE.INLINE}
          />
        }
        name={
          <OneLine className="automation-owner-name" words={name}>
            {owner === AUTOMATION_SCOPE.WORKSPACE ? <ReplayMask>{name}</ReplayMask> : name}
          </OneLine>
        }
      />
    </Tooltip>
  );
}

function MakerCell({
  automation,
  workspace,
}: {
  automation: AutomationSummary;
  workspace: Workspace | undefined;
}): React.JSX.Element {
  const maker = useCreator(
    automation.creatorId === undefined ? {} : { ownerId: automation.creatorId },
  );
  const owner = automationOwner(automation);
  const mine = automation.mine === true;
  if (maker.kind === ACTOR_KIND.SOMEONE) {
    return <OwnerCell owner={owner} mine={mine} workspace={workspace} />;
  }
  const name = actorName(maker);
  return (
    <Tooltip label={`${name} · ${automationOwnerName(owner, workspace?.name, mine)}`}>
      <AutomationOwnerFrame
        owner={owner}
        mark={<ActorMark actor={maker} size={ACTOR_SIZE.INLINE} />}
        name={
          <OneLine className="automation-owner-name" words={name}>
            <ReplayMask>{name}</ReplayMask>
          </OneLine>
        }
      />
    </Tooltip>
  );
}

function useRunNow(automationId: string): { readonly running: boolean; readonly run: () => void } {
  const runAutomation = useMutation(actMutation(ACT_KIND.AUTOMATIONS_RUN));
  const toast = useToast();
  const run = () => {
    runAutomation
      .mutateAsync({ automationId, idempotencyKey: crypto.randomUUID() })
      .catch(unreachedAs(AUTOMATION_CALL_FAILURE.UNANSWERED))
      .then((answer) => {
        if ("failure" in answer) {
          toast({
            words: RUN_REFUSAL_WORDS[answer.failure],
            replayUnmasked: true,
            tone: STATUS_TONE.DANGER,
            hold: TOAST_HOLD.FAILED,
            failure: {
              surface: FAILURE_SURFACE.AUTOMATION_RUN,
              cause: answer,
              about: { automationId },
            },
          });
        }
      });
  };
  return { running: runAutomation.isPending, run };
}

function AutomationRow({
  automation,
  workspace,
  now,
  narrow,
  onOpen,
  onToggle,
  onDelete,
}: {
  automation: AutomationSummary;
  workspace: Workspace | undefined;
  now: number;
  narrow: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => Promise<AutomationView>;
  onDelete: () => void;
}): React.JSX.Element {
  const runNow = useRunNow(automation.id);
  const state = STANDING_GLYPH[automationRunStanding(automation.lastRun)];
  const next = automationNext(automation);
  const nextWords = automationNextText(automation, now);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  const working = state === GLYPH_STATE.WORKING ? glyphStateWords(state, false) : undefined;
  const trigger = automationTriggerText(automation.trigger, automation.repositories ?? []);
  const hiddenWorking = working === undefined ? null : <VisuallyHidden>{working}</VisuallyHidden>;
  const coarse = useCoarsePointer();
  return (
    <RowHintOptions
      card={<AutomationCard automation={automation} workspaceName={workspace?.name} />}
    >
      <ListRow
        leading={<ActorMark actor={automationActor(automation)} size={ACTOR_SIZE.ROW} />}
        title={
          <span
            className="automation-row-name data-[enabled=false]:text-muted-foreground"
            data-enabled={String(automation.enabled)}
          >
            {automation.name}
          </span>
        }
        titleReplayMasked
        description={
          narrow ? (
            <>
              {hiddenWorking}
              {stateEndMark(state, true)}
              {automationNarrowLine(automation, trigger, now)}
            </>
          ) : (
            trigger
          )
        }
        descriptionReplayMasked
        meta={
          narrow ? undefined : (
            <AutomationRowMeta
              lead={hiddenWorking}
              owner={<MakerCell automation={automation} workspace={workspace} />}
              next={
                <>
                  {stateEndMark(state, true)}
                  {nextWords === undefined ? null : (
                    <Tooltip
                      label={next.kind === AUTOMATION_NEXT.AT ? momentText(next.at) : undefined}
                    >
                      <Text
                        as={TEXT_ELEMENT.SPAN}
                        variant={TEXT_VARIANT.INHERIT}
                        truncate
                        className="automation-row-when"
                      >
                        <ReplayUnmask>{nextWords}</ReplayUnmask>
                      </Text>
                    </Tooltip>
                  )}
                </>
              }
            />
          )
        }
        actions={<AutomationSwitch automation={automation} write={onToggle} />}
        hint={{ Hint: RowHint, label: automation.name }}
        onPress={onOpen}
        menu={rowMenu(
          ROW_THING,
          automationActionGroups({
            copyLink,
            runNow: runNowAction(runNow.running, runNow.run),
            onDelete,
          }),
          undefined,
          true,
        )}
        more={!coarse}
        motionKey={automation.id}
      />
    </RowHintOptions>
  );
}

interface AutomationRowsShown {
  workspace: Workspace | undefined;
  now: number;
  narrow: boolean;
  onOpen: (automation: AutomationSummary) => void;
  onToggle: (automation: AutomationSummary, enabled: boolean) => Promise<AutomationView>;
  onDelete: (automation: AutomationSummary) => void;
}

function automationKey({ id }: AutomationSummary): string {
  return id;
}

function AutomationGroupRows({
  automations,
  shown,
}: {
  automations: readonly AutomationSummary[];
  shown: AutomationRowsShown;
}): React.JSX.Element {
  const drawn = useLeaving(automations, automationKey);
  return (
    <>
      {drawn.map(({ key, value: automation }) => (
        <AutomationRow
          key={key}
          automation={automation}
          workspace={shown.workspace}
          now={shown.now}
          narrow={shown.narrow}
          onOpen={() => shown.onOpen(automation)}
          onToggle={(enabled) => shown.onToggle(automation, enabled)}
          onDelete={() => shown.onDelete(automation)}
        />
      ))}
    </>
  );
}

function AutomationList({
  groups,
  ...shown
}: AutomationRowsShown & {
  groups: readonly AutomationGroup[];
}): React.JSX.Element {
  return (
    <>
      {groups.map((group) => {
        const name = automationOwnerName(
          group.owner,
          shown.workspace?.name,
          group.automations.every((automation) => automation.mine === true),
        );
        return (
          <AutomationGroupList
            key={group.owner}
            name={name}
            nameMasked={group.owner === AUTOMATION_SCOPE.WORKSPACE}
            headed={groups.length > 1 || shown.narrow}
          >
            <AutomationGroupRows automations={group.automations} shown={shown} />
          </AutomationGroupList>
        );
      })}
    </>
  );
}

function listState(
  workspacesUnread: boolean,
  read: ReturnType<typeof useAutomations>["read"],
): CollectionState {
  if (workspacesUnread) return COLLECTION_STATE.ERROR;
  if (read === undefined) return COLLECTION_STATE.LOADING;
  return "failure" in read ? COLLECTION_STATE.ERROR : COLLECTION_STATE.READY;
}

function useRowDeletion(
  groups: readonly AutomationGroup[],
  onDeleted: (automationId: string) => void,
) {
  const removing = useMutation(AUTOMATION_DELETE_MUTATION);
  const [asking, setAsking] = useState<AutomationSummary | undefined>(undefined);
  const asked =
    asking !== undefined &&
    groups.some((group) => group.automations.some((each) => each.id === asking.id))
      ? asking
      : undefined;
  const confirmAct = useConfirmAct(removing, {
    send: () => {
      if (asked === undefined) return Promise.resolve();
      return removing.mutateAsync(asked.id).then((answer) => {
        if (!("failure" in answer)) onDeleted(asked.id);
      });
    },
    answered: (answer): ActionResult =>
      "failure" in answer
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: DELETE_REFUSAL_WORDS[answer.failure] }
        : ACCEPTED,
  });
  const confirm = useConfirmDialog(
    { subject: asked !== undefined, surfaceOpen: true },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.AUTOMATION_DELETE, { automationId: asked?.id }),
  );
  const { ask: askConfirm } = confirm;
  const ask = useCallback(
    (automation: AutomationSummary) => {
      setAsking(automation);
      askConfirm();
    },
    [askConfirm],
  );
  return { asked, confirm, ask };
}

function AutomationsHead({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
}): React.JSX.Element {
  const view = tasks.automationsView;
  const workspace = tasks.workspace;
  const openNew = () => view.onOpen({ kind: AUTOMATIONS_PAGE.NEW });
  return room === SHELL_ROOM.NARROW ? (
    <PhoneHead
      place="automations"
      start={
        <Tooltip label={NEW_AUTOMATION}>
          <IconButton
            icon={<PlusIcon />}
            label={NEW_AUTOMATION}
            disabled={workspace === undefined}
            onClick={openNew}
          />
        </Tooltip>
      }
      title={AUTOMATIONS}
      titleReplayUnmasked
      end={
        <PlaceMore
          thing="Automation list"
          shown={tasks.shown}
          replayUnmasked
          groups={() => [
            [
              {
                label: CREATE_WITH_AGENT,
                icon: <BotIcon />,
                disabled: workspace === undefined,
                onSelect: tasks.onNewAutomationAgent,
              },
            ],
            ...phoneFindGroups(),
          ]}
        />
      }
    />
  ) : (
    <AutomationsToolbar>
      <FoldingButton
        label="Create with an agent"
        icon={<BotIcon />}
        variant={BUTTON_VARIANT.OUTLINE}
        disabled={workspace === undefined}
        focusableWhenDisabled
        hint={workspace === undefined ? NoWorkspaceHint : undefined}
        onClick={tasks.onNewAutomationAgent}
      />
      <Tooltip label={workspace === undefined ? NO_WORKSPACE_HINT : undefined}>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<PlusIcon />}
          disabled={workspace === undefined}
          focusableWhenDisabled
          onClick={openNew}
        >
          New automation
        </Button>
      </Tooltip>
    </AutomationsToolbar>
  );
}

function ListPage({
  tasks,
  automations,
  room,
}: {
  tasks: TasksControl;
  automations: ReturnType<typeof useAutomations>;
  room: ShellRoom;
}): React.JSX.Element {
  const view = tasks.automationsView;
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, view.onClose);
  const now = useMinute();
  const workspace = tasks.workspace;
  const { read, reload, toggle } = automations;
  const groups =
    read !== undefined && "automations" in read ? automationGroups(read.automations) : [];
  const workspacesUnread = workspace === undefined && tasks.workspacesFailed;
  const deletion = useRowDeletion(groups, (automationId) =>
    view.onOpen({ kind: AUTOMATIONS_PAGE.LIST, deleted: automationId }),
  );
  return (
    <ReplayUnmask>
      <CollectionPage
        frame={PAGE_FRAME.TOOLBAR}
        label="Automations"
        toolbar={<AutomationsHead tasks={tasks} room={room} />}
        filters={<AutomationsTabs tasks={tasks} />}
        state={listState(workspacesUnread, read)}
        loadingLabel={READING_AUTOMATIONS}
        skeleton={<AutomationListSkeleton narrow={room === SHELL_ROOM.NARROW} />}
        error={
          workspacesUnread ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.WORKSPACES_READ)}
              onRetry={tasks.onRetryWorkspaces}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
            >
              {WORKSPACES_UNREAD_LINE}
            </ErrorState>
          ) : (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.AUTOMATIONS_READ)}
              onRetry={reload}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
            >
              {UNREAD_LINE}
            </ErrorState>
          )
        }
      >
        {groups.length === 0 ? (
          <div className="automations-empty flex min-h-0 flex-1 flex-col before:flex-2 before:content-[''] after:flex-3 after:content-[''] [&>.ui-empty-state]:flex-none">
            <EmptyState icon={<ZapIcon />}>No automations yet.</EmptyState>
          </div>
        ) : (
          <AutomationList
            groups={groups}
            workspace={workspace}
            now={now}
            narrow={room === SHELL_ROOM.NARROW}
            onOpen={(automation) =>
              view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId: automation.id })
            }
            onToggle={(automation, enabled) => toggle(automation.id, enabled)}
            onDelete={deletion.ask}
          />
        )}
        <ConfirmDialog
          open
          confirm={deletion.confirm}
          question={automationDeleteQuestion(deletion.asked?.name)}
        />
      </CollectionPage>
    </ReplayUnmask>
  );
}

type AutomationsTabKind = typeof AUTOMATIONS_PAGE.LIST | typeof AUTOMATIONS_PAGE.RUNS;

function AutomationsTabs({
  tasks,
  children,
}: {
  tasks: TasksControl;
  children?: React.ReactNode;
}): React.JSX.Element {
  const view = tasks.automationsView;
  const { read } = useWorkspaceRuns(tasks.workspace?.id);
  const tab =
    view.place.kind === AUTOMATIONS_PAGE.RUNS ? AUTOMATIONS_PAGE.RUNS : AUTOMATIONS_PAGE.LIST;
  const tabs = [
    { value: AUTOMATIONS_PAGE.LIST, label: AUTOMATIONS },
    {
      value: AUTOMATIONS_PAGE.RUNS,
      label: "Runs",
      count: runsCount(runningRuns(read), STATUS_TONE.WORKING),
    },
  ] as const;
  return (
    <Inline gap={GAP.SECTION}>
      <ChoiceBar<AutomationsTabKind>
        label="Show"
        items={tabs}
        value={tab}
        look={CHOICE_BAR_LOOK.SEGMENTED}
        onChange={(kind) => view.onOpen({ kind })}
      />
      {children}
    </Inline>
  );
}

function runsState(workspacesUnread: boolean, read: WorkspaceRunsRead): CollectionState {
  if (workspacesUnread) return COLLECTION_STATE.ERROR;
  if (read === undefined) return COLLECTION_STATE.LOADING;
  return "failed" in read ? COLLECTION_STATE.ERROR : COLLECTION_STATE.READY;
}

function RunsPage({
  tasks,
  automations,
  room,
}: {
  tasks: TasksControl;
  automations: ReturnType<typeof useAutomations>;
  room: ShellRoom;
}): React.JSX.Element {
  const view = tasks.automationsView;
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, view.onClose);
  const now = useMinute();
  const workspace = tasks.workspace;
  const { read, reload } = useWorkspaceRuns(workspace?.id);
  const [shown, setShown] = useState<RunsShown>(RUNS_SHOWN.ALL);
  const listed =
    automations.read !== undefined && "automations" in automations.read
      ? automations.read.automations
      : [];
  const mine = (automationId: string) =>
    listed.find((automation) => automation.id === automationId)?.mine !== false;
  const workspacesUnread = workspace === undefined && tasks.workspacesFailed;
  return (
    <ReplayUnmask>
      <CollectionPage
        frame={PAGE_FRAME.TOOLBAR}
        label={AUTOMATIONS}
        toolbar={<AutomationsHead tasks={tasks} room={room} />}
        filters={
          <AutomationsTabs tasks={tasks}>
            <ChoiceBar<RunsShown>
              label="Runs shown"
              items={runsShownChoices(read !== undefined && "runs" in read ? read.runs : [])}
              value={shown}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              onChange={setShown}
            />
          </AutomationsTabs>
        }
        state={runsState(workspacesUnread, read)}
        loadingLabel={READING_RUNS}
        skeleton={<RunsSkeleton />}
        error={
          workspacesUnread ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.WORKSPACES_READ)}
              onRetry={tasks.onRetryWorkspaces}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
            >
              {WORKSPACES_UNREAD_LINE}
            </ErrorState>
          ) : (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.AUTOMATION_RUNS_READ)}
              onRetry={reload}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
            >
              {RUNS_UNREAD_LINE}
            </ErrorState>
          )
        }
      >
        {read !== undefined && "runs" in read ? (
          <WorkspaceRuns
            runs={read.runs}
            shown={shown}
            mine={mine}
            now={now}
            onOpenAgent={(agentId) => tasks.agentView.onOpen(agentId)}
            onOpenAutomation={(automationId) =>
              view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })
            }
          />
        ) : null}
      </CollectionPage>
    </ReplayUnmask>
  );
}

const AUTOMATIONS_PLACE = "Automations";
const AUTOMATIONS_PLACE_NAME = "automations";

function backBar(onBack: () => void, phone: boolean): ToolbarProps {
  const back = (
    <BackButton
      label={AUTOMATIONS_PLACE}
      place={AUTOMATIONS_PLACE_NAME}
      command={APP_COMMAND.EXIT_AUTOMATIONS}
      onBack={onBack}
    />
  );
  if (phone) return phoneBar({ place: "automation", start: back, end: null });
  return { lead: back, start: TOOLBAR_INSET.COLUMN };
}

function AutomationAbsentPage({
  onBack,
  phone,
  children,
}: {
  onBack: () => void;
  phone: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return (
    <ReplayUnmask>
      <DetailPage
        frame={PAGE_FRAME.TOOLBAR}
        label="Automation"
        toolbar={<Toolbar {...backBar(onBack, phone)} />}
      >
        {children}
      </DetailPage>
    </ReplayUnmask>
  );
}

function UnreadPage({
  line,
  onBack,
  onRetry,
  phone,
}: {
  line: string;
  onBack: () => void;
  onRetry: () => void;
  phone: boolean;
}): React.JSX.Element {
  return (
    <AutomationAbsentPage onBack={onBack} phone={phone}>
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.AUTOMATION_READ)}
        onRetry={onRetry}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
      >
        {line}
      </ErrorState>
    </AutomationAbsentPage>
  );
}

function GonePage({ onBack, phone }: { onBack: () => void; phone: boolean }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return (
    <ReplayUnmask>
      <NotFound replayUnmasked thing={NOT_FOUND_THING.AUTOMATION} bar={backBar(onBack, phone)} />
    </ReplayUnmask>
  );
}

function ReadingPage({
  onBack,
  room,
  offersOwner,
}: {
  onBack: () => void;
  room: ShellRoom;
  offersOwner: boolean;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return <AutomationPageSkeleton room={room} offersOwner={offersOwner} onBack={onBack} />;
}

export function AutomationsPage({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
}): React.JSX.Element {
  return (
    <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <AutomationsPages tasks={tasks} room={room} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}

const SENTRY_UNREAD: SentryOffer = {
  read: undefined,
  failed: false,
  onRetry: () => undefined,
  installing: false,
  refusal: undefined,
  onInstall: () => undefined,
};

function useWorkspaceSentry(workspaceId: string): SentryOffer {
  const installSentry = useMutation(actMutation(ACT_KIND.WORKSPACE_SENTRY_INSTALL));
  const integrations = useQuery(workspaceIntegrationsQuery(workspaceId));
  const { mutate: retryIntegrations } = useMutation(workspaceIntegrationsRetryMutation());
  const read = integrations.data?.sentry;
  const failed = read === undefined && integrations.isError;
  const retry = () => retryIntegrations({ workspaceId });
  const installing = installSentry.isPending;
  const refusal = installSentry.error?.message;
  const onInstall = () => {
    if (installing) return;
    installSentry.mutate({ workspaceId });
  };
  return { read, failed, onRetry: retry, installing, refusal, onInstall };
}

function useWorkspaceSlackBot(workspaceId: string): boolean {
  return useQuery(workspaceIntegrationsQuery(workspaceId)).data?.slack.team !== undefined;
}

function WorkspaceEditor({
  workspaceId,
  editor,
}: {
  workspaceId: string;
  editor: (sentry: SentryOffer, slackBot: boolean) => React.JSX.Element;
}): React.JSX.Element {
  return editor(useWorkspaceSentry(workspaceId), useWorkspaceSlackBot(workspaceId));
}

function AutomationsPages({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
}): React.JSX.Element {
  const view = tasks.automationsView;
  const workspace = tasks.workspace;
  const automations = useAutomations(workspace?.id);
  const [made, setMade] = useState<string | undefined>(undefined);
  const back = () => view.onOpen({ kind: AUTOMATIONS_PAGE.LIST });
  const { place } = view;
  if (place.kind === AUTOMATIONS_PAGE.LIST) {
    return <ListPage tasks={tasks} automations={automations} room={room} />;
  }
  if (place.kind === AUTOMATIONS_PAGE.RUNS) {
    return <RunsPage tasks={tasks} automations={automations} room={room} />;
  }
  const { read, reload } = automations;
  if (workspace === undefined && tasks.workspacesFailed) {
    return (
      <UnreadPage
        line={WORKSPACES_UNREAD_LINE}
        onBack={back}
        onRetry={tasks.onRetryWorkspaces}
        phone={room === SHELL_ROOM.NARROW}
      />
    );
  }
  if (read !== undefined && "failure" in read) {
    return (
      <UnreadPage
        line={UNREAD_LINE}
        onBack={back}
        onRetry={reload}
        phone={room === SHELL_ROOM.NARROW}
      />
    );
  }
  const listedAutomations = read === undefined ? [] : read.automations;
  const opened =
    place.kind === AUTOMATIONS_PAGE.EDIT
      ? listedAutomations.find((automation) => automation.id === place.automationId)
      : undefined;
  const offersOwner = workspace !== undefined && tasks.workspaces[0]?.id !== workspace.id;
  if (place.kind === AUTOMATIONS_PAGE.EDIT && opened === undefined) {
    return read === undefined ? (
      <ReadingPage onBack={back} room={room} offersOwner={offersOwner} />
    ) : (
      <GonePage onBack={back} phone={room === SHELL_ROOM.NARROW} />
    );
  }
  const editing = opened === undefined || opened.id === made ? AUTOMATIONS_PAGE.NEW : opened.id;
  const editor = (sentry: SentryOffer, slackBot: boolean) => (
    <AutomationEditor
      key={editing}
      automation={opened}
      workspace={workspace}
      offersOwner={offersOwner}
      repositories={tasks.newTask.repositoriesIn(workspace?.id)}
      writes={automations}
      onBack={back}
      onOpenAgent={(agentId) => tasks.agentView.onOpen(agentId)}
      linked={place.kind === AUTOMATIONS_PAGE.EDIT ? place : undefined}
      leaveGuard={tasks.leaveGuard}
      room={room}
      runsShown={view.runs}
      onRuns={view.onRuns}
      sentry={sentry}
      slackBot={slackBot}
      onDeleted={(automationId) =>
        view.onOpen({ kind: AUTOMATIONS_PAGE.LIST, deleted: automationId })
      }
      onCreated={(automationId) => {
        setMade(automationId);
        view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId, created: true });
      }}
    />
  );
  return (
    <Fragment key={workspace?.id}>
      {workspace === undefined ? (
        editor(SENTRY_UNREAD, false)
      ) : (
        <WorkspaceEditor workspaceId={workspace.id} editor={editor} />
      )}
    </Fragment>
  );
}

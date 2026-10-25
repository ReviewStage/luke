import {
  AUTOMATION_PRESET,
  type AutomationPresetName,
  automationPreset,
} from "@luke/features/automation-code-review";
import {
  AUTOMATION_NEXT,
  type AutomationGroup,
  automationGroups,
  automationNext,
  automationOwner,
  automationRunStanding,
  automationTriggerText,
} from "@luke/features/automation-list-model";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationView,
} from "@luke/features/automation-view";
import type { AutomationScope, AutomationSummary } from "@luke/features/automation-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import { momentText } from "@luke/features/time-format";
import { REFRESH_FAILED_WORDS } from "@luke/features/words";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BackButton,
  BUTTON_VARIANT,
  Button,
  CardPress,
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
  IconButton,
  ListRow,
  NOT_FOUND_THING,
  NotFound,
  OneLine,
  PAGE_FRAME,
  RowHint,
  RowHintOptions,
  TEXT_ELEMENT,
  TEXT_TONE,
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
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { BotIcon, GitPullRequestIcon, PlusIcon, ZapIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import { useSentryRead } from "../settings/use-sentry-read.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { GLYPH_STATE, glyphStateWords, stateEndMark } from "../state-glyph.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useExperiment } from "../use-app-state.js";
import { type MenuAction, rowMenu } from "./action-menu.js";
import {
  AutomationEditor,
  AutomationPageSkeleton,
  AutomationSwitch,
  type SentryOffer,
} from "./automation-editor.js";
import {
  AutomationGroupCard,
  AutomationListSkeleton,
  AutomationOwnerFrame,
  AutomationRowMeta,
  AutomationsToolbar,
} from "./automation-list-frame.js";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner.js";
import { STANDING_GLYPH } from "./automation-runs-panel.js";
import {
  automationDeleteQuestion,
  automationNarrowLine,
  automationNextText,
  automationOwnerName,
  READING_AUTOMATIONS,
} from "./automation-words.js";
import { PhoneHead, PlaceMore, phoneBar } from "./phone-head.js";
import { useAutomations } from "./use-automations.js";

/**
 * automations-page.tsx -- the window's Automations page: the listed workspace's automations, each with its owner beyond doubt, when it runs next, how its newest run went, and its switch.
 *
 * It stands in the task's place beside the sidebar, as the Inbox does, and
 * its sidebar row is marked while it does. Who owns an automation is the
 * one thing the list must never leave in doubt, so the workspace's
 * automations stand first and the account's personal ones after, under a
 * heading each where both stand, and every row names its owner besides, a
 * building for the workspace and a lock for Only you. A row's glyph wears
 * where its newest run stands, a failure keeps its mark at the row's end,
 * and an automation turned off reads "Off" where its next run would.
 * Under the list, or under the line saying there is none yet, stand the
 * suggested automations: a press opens a new automation's page filled in
 * from the suggestion's preset, to look over and Create. Beside New
 * automation, Create with an agent opens New task's own card for the agent
 * that makes one: what to automate in the member's own words, the
 * repository and the model, then Start agent, a new task's agent handed the
 * brief to make it (`new-task-composer.tsx`). Code review, the
 * one suggestion, is still an experiment (`EXPERIMENT.CODE_REVIEW`), so
 * nothing is suggested while the account has it off, and a page filled in
 * from it goes back to the list.
 */

/** What an automation's row is, which names its ⋯ and its menu. */
const ROW_THING = "Automation";

/** What the list is called, and a phone's way back from an automation's page names it. */
const AUTOMATIONS = "Automations";

/** Why a row's Delete did not land, as its question goes on saying until it is tried again or let go. */
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

/** What the list's acts are called, on their buttons and a phone's ⋯ alike. */
const NEW_AUTOMATION = "New automation";
const CREATE_WITH_AGENT = "Create with an agent";

/** What the list says where it could not be read. */
const UNREAD_LINE = "The automations could not be read.";

/** What the pages say where no workspace is listed because the workspaces could not be read. */
const WORKSPACES_UNREAD_LINE = "The workspaces could not be read.";

/** The presets the list suggests while Code review's experiment is on, in its order, each by the glyph of what fires it. */
const SUGGESTIONS: readonly {
  readonly name: AutomationPresetName;
  readonly glyph: React.ReactNode;
}[] = [{ name: AUTOMATION_PRESET.CODE_REVIEW, glyph: <GitPullRequestIcon /> }];

/** Why the bar's two acts are unavailable while no workspace is chosen. */
const NO_WORKSPACE_HINT = "Choose a workspace first";

/** The hint a folding act of the bar hangs while no workspace is chosen: why it is off, after its words where they are folded. */
const NoWorkspaceHint: FoldingButtonHint = ({ label, children }) => (
  <Tooltip label={label === undefined ? NO_WORKSPACE_HINT : `${label}: ${NO_WORKSPACE_HINT}`}>
    {children}
  </Tooltip>
);

/** Who owns an automation, as its row's column says it: the workspace's photo and its name, or the maker's picture and Only you, its name whole on hover where the column cuts it short. */
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
            {name}
          </OneLine>
        }
      />
    </Tooltip>
  );
}

/**
 * One automation's row: its tile, the glyph of what fires it wearing where its newest run
 * stands, its name over what fires it, its owner, when it runs next with a
 * failure's mark before it, and its switch, hanging the automation's card. The owner and the next run each keep a column of their
 * own, so they line up down the card whatever each row says. Everything but the switch is one press
 * that opens its page, as a sidebar task's row is, so the row opens wherever
 * it is pressed and the switch beside the press only switches. Its
 * right-click offers Copy link, then Delete in red, which asks first, and
 * hands focus back to its press as the menu closes; a right-click on the switch is the switch's own and opens
 * nothing. A narrow room, a phone's, has no width for the two columns beside
 * the name, so the row keeps its name whole and says when it runs next in
 * the line under it, its owner said by its card's heading instead.
 */
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
  /** Asks whether to delete it. */
  onDelete: () => void;
}): React.JSX.Element {
  const state = STANDING_GLYPH[automationRunStanding(automation.lastRun)];
  const next = automationNext(automation);
  const nextWords = automationNextText(automation, now);
  // Note that the row's item is its press's parent, which its card counts as its control, as a sidebar task's row does.
  const item = useRef<HTMLElement | null>(null);
  const hold = useCallback((node: HTMLElement | null) => {
    item.current = node?.parentElement ?? null;
  }, []);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  const remove: MenuAction = {
    label: "Delete",
    icon: <GLYPH.DELETE />,
    onSelect: onDelete,
    danger: true,
  };
  // Note that the glyph is the row's decoration, so its working word is said in the row's words instead.
  const working = state === GLYPH_STATE.WORKING ? glyphStateWords(state, false) : undefined;
  const trigger = automationTriggerText(automation.trigger, automation.repositories ?? []);
  const hiddenWorking = working === undefined ? null : <VisuallyHidden>{working}</VisuallyHidden>;
  return (
    <RowHintOptions
      card={<AutomationCard automation={automation} workspaceName={workspace?.name} />}
      cardBeside
      cardRegion={item}
    >
      <ListRow
        ref={hold}
        leading={<ActorMark actor={automationActor(automation)} size={ACTOR_SIZE.ROW} />}
        title={
          <span className="automation-row-name" data-enabled={String(automation.enabled)}>
            {automation.name}
          </span>
        }
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
        meta={
          narrow ? undefined : (
            <AutomationRowMeta
              lead={hiddenWorking}
              owner={
                <OwnerCell
                  owner={automationOwner(automation)}
                  mine={automation.mine === true}
                  workspace={workspace}
                />
              }
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
                        {nextWords}
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
        menu={rowMenu(ROW_THING, copyLink === undefined ? [[remove]] : [[copyLink], [remove]])}
        motionKey={automation.id}
      />
    </RowHintOptions>
  );
}

/** What every row of the list is handed: the room it stands in, and the presses on it. */
interface AutomationRowsShown {
  workspace: Workspace | undefined;
  now: number;
  narrow: boolean;
  onOpen: (automation: AutomationSummary) => void;
  onToggle: (automation: AutomationSummary, enabled: boolean) => Promise<AutomationView>;
  onDelete: (automation: AutomationSummary) => void;
}

/** An automation's key, by which its row leaves the list (`ListMotion`). */
function automationKey({ id }: AutomationSummary): string {
  return id;
}

/** One owner's rows, a row no longer listed drawn on until its exit has played (`useLeaving`). */
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

/**
 * The list, each owner's automations in a card, under its own heading where
 * both stand, or in a narrow room, whose rows name no owner. Note that a
 * lone owner's card is still a region named by its owner, as a headed one is
 * by its heading, so a reader moving by landmark hears whose automations
 * they are either way.
 */
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
        // A phone's lone owner's card is headed too, since its rows name no owner.
        return (
          <AutomationGroupCard
            key={group.owner}
            name={name}
            headed={groups.length > 1 || shown.narrow}
          >
            <AutomationGroupRows automations={group.automations} shown={shown} />
          </AutomationGroupCard>
        );
      })}
    </>
  );
}

/**
 * The automations Luke suggests, under a heading of their own, each a card:
 * the glyph of what fires it, its name over what it does, and a plus, the
 * whole card one press that opens a new automation's page filled in from
 * its preset.
 */
function SuggestedAutomations({
  disabled,
  onStart,
}: {
  disabled: boolean;
  onStart: (preset: AutomationPresetName) => void;
}): React.JSX.Element | null {
  if (!useExperiment(EXPERIMENT.CODE_REVIEW)) return null;
  return (
    <section className="automation-suggestions" aria-label="Suggested">
      <div className="automation-suggestions-head">
        <Text variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.H2}>
          Suggested
        </Text>
      </div>
      <div className="automation-suggestion-cards">
        {SUGGESTIONS.map(({ name, glyph }) => {
          const preset = automationPreset(name);
          return (
            <div
              key={name}
              className="automation-suggestion"
              data-disabled={disabled ? "true" : undefined}
            >
              <CardPress disabled={disabled} onPress={() => onStart(name)}>
                <span className="automation-suggestion-face">
                  <span className="automation-suggestion-head">
                    <span className="automation-suggestion-glyph" aria-hidden="true">
                      {glyph}
                    </span>
                    <PlusIcon className="automation-suggestion-add" aria-hidden="true" />
                  </span>
                  <span className="automation-suggestion-name">{preset.name}</span>
                  <span className="automation-suggestion-detail">{preset.description}</span>
                </span>
              </CardPress>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** What the list's page shows: the workspaces or the list unread, the list still being read, or the list. */
function listState(
  workspacesUnread: boolean,
  read: ReturnType<typeof useAutomations>["read"],
): CollectionState {
  if (workspacesUnread) return COLLECTION_STATE.ERROR;
  if (read === undefined) return COLLECTION_STATE.LOADING;
  return "failure" in read ? COLLECTION_STATE.ERROR : COLLECTION_STATE.READY;
}

/**
 * The question a row's Delete asks, held for the list: which automation it
 * asks about, standing only while that one is still listed, so one deleted
 * elsewhere withdraws it, and the deletion itself, which the history hears
 * of (`onDeleted`) so it passes over the automation's page from then on.
 */
function useRowDeletion(
  groups: readonly AutomationGroup[],
  remove: ReturnType<typeof useAutomations>["remove"],
  onDeleted: (automationId: string) => void,
) {
  const [asking, setAsking] = useState<AutomationSummary | undefined>(undefined);
  const asked =
    asking !== undefined &&
    groups.some((group) => group.automations.some((each) => each.id === asking.id))
      ? asking
      : undefined;
  const confirm = useConfirmDialog({ subject: asked !== undefined, surfaceOpen: true }, () => {
    if (asked === undefined) return Promise.resolve(ACCEPTED);
    return remove(asked.id).then((answer): ActionResult => {
      if ("failure" in answer) {
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: DELETE_REFUSAL_WORDS[answer.failure],
        };
      }
      onDeleted(asked.id);
      return ACCEPTED;
    });
  });
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

/** The list's page: the listed workspace's automations, a new one a press away. */
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
  const { read, refreshFailed, reload, toggle, remove } = automations;
  const openNew = () => view.onOpen({ kind: AUTOMATIONS_PAGE.NEW });
  const openSuggested = (preset: AutomationPresetName) =>
    view.onOpen({ kind: AUTOMATIONS_PAGE.NEW, preset });
  const groups =
    read !== undefined && "automations" in read ? automationGroups(read.automations) : [];
  const workspacesUnread = workspace === undefined && tasks.workspacesFailed;
  const deletion = useRowDeletion(groups, remove, (automationId) =>
    view.onOpen({ kind: AUTOMATIONS_PAGE.LIST, deleted: automationId }),
  );
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Automations"
      toolbar={
        room === SHELL_ROOM.NARROW ? (
          // A phone heads the list as it heads every place (`phone-head.tsx`): New automation, the title centred, and a ⋯.
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
            end={
              <PlaceMore
                thing="Automation list"
                shown={tasks.shown}
                groups={() => [
                  [
                    {
                      label: CREATE_WITH_AGENT,
                      icon: <BotIcon />,
                      disabled: workspace === undefined,
                      onSelect: tasks.onNewAutomationAgent,
                    },
                  ],
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
        )
      }
      state={listState(workspacesUnread, read)}
      loadingLabel={READING_AUTOMATIONS}
      skeleton={<AutomationListSkeleton narrow={room === SHELL_ROOM.NARROW} />}
      error={
        workspacesUnread ? (
          <ErrorState onRetry={tasks.onRetryWorkspaces} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            {WORKSPACES_UNREAD_LINE}
          </ErrorState>
        ) : (
          <ErrorState onRetry={reload} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            {UNREAD_LINE}
          </ErrorState>
        )
      }
    >
      {/* A refresh that failed after the list was read leaves it drawn, with a line over it. */}
      {refreshFailed ? <ErrorState onRetry={reload}>{REFRESH_FAILED_WORDS}</ErrorState> : null}
      {/* Note that a list with none is ready rather than empty, because the suggestions under its empty state are content. */}
      {groups.length === 0 ? (
        <div className="automations-empty">
          <EmptyState icon={<ZapIcon />}>No automations yet.</EmptyState>
          <SuggestedAutomations disabled={workspace === undefined} onStart={openSuggested} />
        </div>
      ) : (
        <>
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
          <SuggestedAutomations disabled={workspace === undefined} onStart={openSuggested} />
        </>
      )}
      <ConfirmDialog
        open
        confirm={deletion.confirm}
        question={automationDeleteQuestion(deletion.asked?.name)}
      />
    </CollectionPage>
  );
}

/** What the way back to the list is called, and where it leads as its hint names it. */
const AUTOMATIONS_PLACE = "Automations";
const AUTOMATIONS_PLACE_NAME = "automations";

/** The bar of an automation's page that has no automation to show: its way back to the list, at the column's edge; on a phone, the back's glyph alone in its corner (`phone-head.tsx`). */
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

/** One automation's page that has no automation to show: its way back over `children`, which say why. */
function AutomationAbsentPage({
  onBack,
  phone,
  children,
}: {
  onBack: () => void;
  /** Whether a phone heads the page, its way back the glyph alone. */
  phone: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Automation"
      toolbar={<Toolbar {...backBar(onBack, phone)} />}
    >
      {children}
    </DetailPage>
  );
}

/** One automation's page whose list, or the workspaces it is read in, could not be read: said so, with Retry, rather than called gone. */
function UnreadPage({
  line,
  onBack,
  onRetry,
  phone,
}: {
  line: string;
  onBack: () => void;
  onRetry: () => void;
  /** Whether a phone heads the page, its way back the glyph alone. */
  phone: boolean;
}): React.JSX.Element {
  return (
    <AutomationAbsentPage onBack={onBack} phone={phone}>
      <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
        {line}
      </ErrorState>
    </AutomationAbsentPage>
  );
}

/** One automation's page that names an automation the list does not hold: it was deleted, or is of a workspace the reader is not in, as a link may name. */
function GonePage({ onBack, phone }: { onBack: () => void; phone: boolean }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return <NotFound thing={NOT_FOUND_THING.AUTOMATION} bar={backBar(onBack, phone)} />;
}

/** One automation's page opened before the list is first read: the editor's own frame as quiet blocks (`AutomationPageSkeleton`), and its way back. */
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

/**
 * The window's Automations pages, in the task's place: the list, or one
 * automation's editor, or a new one's. The list is read once for all of
 * them, so an automation opened from it opens as it was listed, and an
 * edit is in the list the moment it lands.
 */
export function AutomationsPage({
  tasks,
  room,
}: {
  tasks: TasksControl;
  /** The room the panel's stage gives, narrow where an automation's runs are a screen of their own. */
  room: ShellRoom;
}): React.JSX.Element {
  // Every Copy link on these pages is written under the listed workspace, whose automations they are.
  return (
    <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
      <AutomationsPages tasks={tasks} room={room} />
    </LinkWorkspaceProvider>
  );
}

/** The workspace's Sentry while no workspace is listed: unread, with nothing to install on. */
const SENTRY_UNREAD: SentryOffer = {
  read: undefined,
  failed: false,
  onRetry: () => undefined,
  installing: false,
  refusal: undefined,
  onInstall: () => undefined,
};

/**
 * A listed workspace's Sentry as its automations' editor offers it: read as
 * the page opens and each time the window comes forward, which is how the
 * developer comes back from installing on Sentry, and installed in the
 * browser, a refusal (only owners and admins install) said at its row.
 */
function useWorkspaceSentry(workspaceId: string): SentryOffer {
  const { act } = useAct();
  const { read: answer, retry } = useSentryRead(workspaceId);
  // Note that a read that failed offers what one still out does, so a saved Sentry trigger stays editable; the editor says the failure above its rows.
  const read = answer !== undefined && "sentry" in answer ? answer.sentry : undefined;
  const failed = answer !== undefined && "failed" in answer;
  const [installing, setInstalling] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const onInstall = () => {
    if (installing) return;
    setInstalling(true);
    setRefusal(undefined);
    act(ACT_KIND.WORKSPACE_SENTRY_INSTALL, { workspaceId })
      .catch((refused: Error) => setRefusal(refused.message))
      .finally(() => setInstalling(false));
  };
  return { read, failed, onRetry: retry, installing, refusal, onInstall };
}

/** The editor over a listed workspace, offered that workspace's Sentry. */
function WorkspaceEditor({
  workspaceId,
  editor,
}: {
  workspaceId: string;
  editor: (sentry: SentryOffer) => React.JSX.Element;
}): React.JSX.Element {
  return editor(useWorkspaceSentry(workspaceId));
}

/** The Automations pages themselves, under the workspace their links are written in. */
function AutomationsPages({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
}): React.JSX.Element {
  const view = tasks.automationsView;
  const workspace = tasks.workspace;
  const codeReviewOn = useExperiment(EXPERIMENT.CODE_REVIEW);
  // Note that no list is asked for while no workspace is listed, which is
  // while the workspaces are still read, so the pages stand as quiet blocks
  // until one is, rather than calling the list empty or an automation gone;
  // a workspaces read that did not land says so instead.
  const automations = useAutomations(workspace?.id);
  // The automation the new page made, whose page is that same editor still, so what was typed while it was made stands.
  const [made, setMade] = useState<string | undefined>(undefined);
  const back = () => view.onOpen({ kind: AUTOMATIONS_PAGE.LIST });
  const { place } = view;
  // A new page filled in from Code review's preset goes back to the list once its experiment is off, here or
  // on another Mac, as Chat gives the task's place back; the window's leave guard asks first where it was written in.
  // Note that the way out is read through a ref, because the window rebuilds it on every render, and a draft
  // kept by Cancel is asked again only when the place or the experiment moves.
  const fromPreset = place.kind === AUTOMATIONS_PAGE.NEW && place.preset !== undefined;
  const open = useRef(view.onOpen);
  open.current = view.onOpen;
  useEffect(() => {
    if (fromPreset && !codeReviewOn) open.current({ kind: AUTOMATIONS_PAGE.LIST });
  }, [fromPreset, codeReviewOn]);
  if (place.kind === AUTOMATIONS_PAGE.LIST) {
    return <ListPage tasks={tasks} automations={automations} room={room} />;
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
  // Note that the account's first workspace is its personal one, where everything is its own.
  const offersOwner = workspace !== undefined && tasks.workspaces[0]?.id !== workspace.id;
  if (place.kind === AUTOMATIONS_PAGE.EDIT && opened === undefined) {
    return read === undefined ? (
      <ReadingPage onBack={back} room={room} offersOwner={offersOwner} />
    ) : (
      <GonePage onBack={back} phone={room === SHELL_ROOM.NARROW} />
    );
  }
  // Code review, the one preset, is an experiment, so no page is filled in from it while it is off.
  const preset = place.kind === AUTOMATIONS_PAGE.NEW && codeReviewOn ? place.preset : undefined;
  const editing = opened === undefined || opened.id === made ? AUTOMATIONS_PAGE.NEW : opened.id;
  const editor = (sentry: SentryOffer) => (
    <AutomationEditor
      key={editing}
      automation={opened}
      preset={preset}
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
    // Keyed by the workspace, then by what it edits, so another workspace's page or another automation's holds nothing of the last's draft.
    <Fragment key={workspace?.id}>
      {workspace === undefined ? (
        editor(SENTRY_UNREAD)
      ) : (
        <WorkspaceEditor workspaceId={workspace.id} editor={editor} />
      )}
    </Fragment>
  );
}

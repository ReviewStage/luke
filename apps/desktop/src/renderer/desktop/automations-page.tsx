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
import { AUTOMATION_CALL_FAILURE, type AutomationView } from "@luke/features/automation-view";
import type { AutomationScope, AutomationSummary } from "@luke/features/automation-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { Workspace } from "@luke/features/workspace-wire";
import { automationNextText, automationOwnerName } from "@luke/panel/desktop/automation-words";
import { useAutomations } from "@luke/panel/desktop/use-automations";
import { momentText, useMinute } from "@luke/panel/tasks/task-time";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  LIST_VARIANT,
  List,
  ListRow,
  SETTINGS_SECTION_FRAME,
  SettingsRow,
  SettingsSection,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  Switch,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useMenu,
} from "@luke/ui";
import { ChevronRightIcon, GitPullRequestIcon, PlusIcon, ZapIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { useAppCommand } from "../app-commands";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { FoldingButton } from "../folding-button";
import { NOT_FOUND_THING, NotFound } from "../not-found";
import { GLYPH_STATE, glyphStateWords, StateGlyph, stateEndMark } from "../state-glyph";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { ActionMenu } from "./action-menu";
import { AutomationEditor } from "./automation-editor";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner";
import { AutomationRunsPanel, FiringGlyph, STANDING_GLYPH } from "./automation-runs-panel";
import { AutomationListSkeleton } from "./automations-skeleton";
import { useRunsPanel } from "./folded-groups";

/**
 * automations-page.tsx -- the window's Automations page: the listed workspace's automations, each with its owner beyond doubt, when it runs next, how its newest run went, and its switch.
 *
 * It stands in the task's place beside the sidebar, as Factory does, and
 * its sidebar row is marked while it does. Who owns an automation is the
 * one thing the list must never leave in doubt, so the workspace's
 * automations stand first and the account's personal ones after, under a
 * heading each where both stand, and every row names its owner besides, a
 * building for the workspace and a lock for Personal. A row's glyph wears
 * where its newest run stands, a failure keeps its mark at the row's end,
 * and an automation turned off reads "Off" where its next run would. It is
 * an experiment (`EXPERIMENT.AUTOMATIONS`): every door to it is gated on the
 * account's switch, and its toolbar says so with a quiet badge and Send
 * feedback. Under the list, or under the line saying there is none yet,
 * stand the suggested automations, Code review among them: a press opens a
 * new automation's page filled in from the suggestion's preset, to look
 * over and Create.
 */

/** What an automation's row's right-click menu is called. */
const ROW_ACTIONS = "Automation actions";

/** What the list says where it could not be read. */
const UNREAD_LINE = "The automations could not be read.";

/** What the pages say where no workspace is listed because the workspaces could not be read. */
const WORKSPACES_UNREAD_LINE = "The workspaces could not be read.";

/** What an automation's placeholder page says to a reader while the list is first read. */
const READING_AUTOMATION = "Reading the automation…";

/**
 * How an automation's placeholder page stands: each of the editor's groups
 * every automation has, by its heading, over its rows' label and detail as
 * shares of their lines, or over the prompt's field.
 */
const EDITOR_SKELETON = [
  {
    title: "Trigger",
    rows: [
      { label: "12%", detail: "46%" },
      { label: "16%", detail: "34%" },
    ],
  },
  { title: "Prompt", rows: [] },
  {
    title: "Runs",
    rows: [
      { label: "18%", detail: "40%" },
      { label: "14%", detail: "52%" },
    ],
  },
] as const;

/** How wide an automation's placeholder name, its crumb, and a placeholder row's control stand. */
const SKELETON_NAME = "40%";
const SKELETON_CRUMB = "120px";
const SKELETON_CONTROL = "160px";

/** The presets the list suggests, in its order, each by the glyph of what fires it. */
const SUGGESTIONS: readonly {
  readonly name: AutomationPresetName;
  readonly glyph: React.ReactNode;
}[] = [{ name: AUTOMATION_PRESET.CODE_REVIEW, glyph: <GitPullRequestIcon /> }];

/** Why a switch did not move, as its toast says it. */
function toggleRefusal(answer: AutomationView, enabled: boolean): string | undefined {
  if (!("failure" in answer)) return undefined;
  if (answer.failure === AUTOMATION_CALL_FAILURE.NOT_PERMITTED) {
    return "Only its creator, or the workspace's owners and admins, can change it.";
  }
  return enabled ? "Couldn't turn it on. Try again." : "Couldn't turn it off. Try again.";
}

/** Who owns an automation, as its row's column says it: the workspace's photo and its name, or the maker's picture and Personal, its name whole on hover where the column cuts it short. */
function OwnerCell({
  owner,
  mine,
  workspace,
}: {
  owner: AutomationScope;
  mine: boolean;
  workspace: Workspace | undefined;
}): React.JSX.Element {
  const name = automationOwnerName(owner, workspace?.name);
  return (
    <Tooltip label={name}>
      <span className="automation-owner" data-owner={owner}>
        <OwnerMark owner={owner} workspace={workspace} mine={mine} size={OWNER_MARK_SIZE.INLINE} />
        <span className="automation-owner-name">{name}</span>
      </span>
    </Tooltip>
  );
}

/**
 * One automation's row: the glyph of what fires it wearing where its newest run
 * stands, its name over what fires it, its owner, when it runs next, a
 * failure's mark, and its switch. Everything but the switch is one press
 * that opens its page, as a sidebar task's row is, so the row opens wherever
 * it is pressed and the switch beside the press only switches. Its
 * right-click offers Copy link, and hands focus back to its press as the
 * menu closes; a right-click on the switch is the switch's own and opens
 * nothing.
 */
function AutomationRow({
  automation,
  workspace,
  now,
  onOpen,
  onToggle,
}: {
  automation: AutomationSummary;
  workspace: Workspace | undefined;
  now: number;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  const state = STANDING_GLYPH[automationRunStanding(automation.lastRun)];
  const next = automationNext(automation);
  const menu = useMenu(true);
  const press = useRef<HTMLElement | null>(null);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  // Note that the glyph is the row's decoration, so its working word is said beside the owner instead.
  const working = state === GLYPH_STATE.WORKING ? glyphStateWords(state, false) : undefined;
  return (
    <>
      <ListRow
        ref={(node) => {
          press.current = node;
        }}
        leading={
          <StateGlyph glyph={<FiringGlyph kind={automation.trigger.kind} />} state={state} />
        }
        title={
          <span className="automation-row-name" data-enabled={String(automation.enabled)}>
            {automation.name}
          </span>
        }
        description={automationTriggerText(automation.trigger, automation.repositories ?? [])}
        meta={
          <span className="automation-row-meta">
            {working === undefined ? null : <span className="luke-visually-hidden">{working}</span>}
            <OwnerCell
              owner={automationOwner(automation)}
              mine={automation.mine === true}
              workspace={workspace}
            />
            <Tooltip label={next.kind === AUTOMATION_NEXT.AT ? momentText(next.at) : undefined}>
              <span className="automation-row-when">{automationNextText(automation, now)}</span>
            </Tooltip>
            {stateEndMark(state, true)}
          </span>
        }
        actions={
          <Switch
            checked={automation.enabled}
            label={
              automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`
            }
            onChange={(enabled) => onToggle(enabled)}
            onContextMenu={(event) => event.stopPropagation()}
          />
        }
        onPress={onOpen}
        onContextMenu={copyLink === undefined ? undefined : menu.contextMenu(press)}
      />
      {menu.drawn === undefined || copyLink === undefined ? null : (
        <ActionMenu
          label={ROW_ACTIONS}
          menu={menu.drawn}
          groups={[[copyLink]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The list, each owner's automations in a card, under its own heading where
 * both stand. Note that a lone owner's card is still a region named by its
 * owner, as a headed one is by its heading, so a reader moving by landmark
 * hears whose automations they are either way.
 */
function AutomationList({
  groups,
  workspace,
  now,
  onOpen,
  onToggle,
}: {
  groups: readonly AutomationGroup[];
  workspace: Workspace | undefined;
  now: number;
  onOpen: (automation: AutomationSummary) => void;
  onToggle: (automation: AutomationSummary, enabled: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      {groups.map((group) => {
        const name = automationOwnerName(group.owner, workspace?.name);
        const card = (
          <SettingsSection
            title={groups.length > 1 ? name : undefined}
            frame={SETTINGS_SECTION_FRAME.NONE}
          >
            <List label={name} variant={LIST_VARIANT.CARD}>
              {group.automations.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  workspace={workspace}
                  now={now}
                  onOpen={() => onOpen(automation)}
                  onToggle={(enabled) => onToggle(automation, enabled)}
                />
              ))}
            </List>
          </SettingsSection>
        );
        return groups.length > 1 ? (
          <div key={group.owner} className="automation-group">
            {card}
          </div>
        ) : (
          <section key={group.owner} className="automation-group" aria-label={name}>
            {card}
          </section>
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
}): React.JSX.Element {
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
            <button
              key={name}
              type="button"
              className="automation-suggestion"
              disabled={disabled}
              onClick={() => onStart(name)}
            >
              <span className="automation-suggestion-head">
                <span className="automation-suggestion-glyph" aria-hidden="true">
                  {glyph}
                </span>
                <PlusIcon className="automation-suggestion-add" aria-hidden="true" />
              </span>
              <span className="automation-suggestion-name">{preset.name}</span>
              <span className="automation-suggestion-detail">{preset.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The list's page: the listed workspace's automations, a new one a press away. */
function ListPage({
  tasks,
  automations,
}: {
  tasks: TasksControl;
  automations: ReturnType<typeof useAutomations>;
}): React.JSX.Element {
  const view = tasks.automationsView;
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, view.onClose);
  const toast = useToast();
  const now = useMinute();
  const workspace = tasks.workspace;
  const { read, reload, toggle } = automations;
  const onToggle = (automation: AutomationSummary, enabled: boolean) => {
    toggle(automation.id, enabled).then((answer) => {
      const refusal = toggleRefusal(answer, enabled);
      if (refusal !== undefined) {
        toast({ words: refusal, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      }
    });
  };
  const openNew = () => view.onOpen({ kind: AUTOMATIONS_PAGE.NEW });
  const openSuggested = (preset: AutomationPresetName) =>
    view.onOpen({ kind: AUTOMATIONS_PAGE.NEW, preset });
  const groups =
    read !== undefined && "automations" in read ? automationGroups(read.automations) : [];
  return (
    <section className="automations-view" aria-label="Automations">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">Automations</h1>
          <ExperimentTag />
        </div>
        <div className="desktop-toolbar-actions">
          <SendFeedbackButton experiment={EXPERIMENT.AUTOMATIONS} />
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<PlusIcon />}
            disabled={workspace === undefined}
            onClick={openNew}
          >
            New automation
          </Button>
        </div>
      </header>
      <div className="automations-scroll scroll-fade-top">
        {workspace === undefined && tasks.workspacesFailed ? (
          <ErrorState onRetry={tasks.onRetryWorkspaces} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            {WORKSPACES_UNREAD_LINE}
          </ErrorState>
        ) : read === undefined ? (
          <AutomationListSkeleton />
        ) : "failure" in read ? (
          <ErrorState onRetry={reload} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            {UNREAD_LINE}
          </ErrorState>
        ) : groups.length === 0 ? (
          <div className="automations-empty">
            <EmptyState icon={<ZapIcon />}>No automations yet</EmptyState>
            <SuggestedAutomations disabled={workspace === undefined} onStart={openSuggested} />
          </div>
        ) : (
          <>
            <AutomationList
              groups={groups}
              workspace={workspace}
              now={now}
              onOpen={(automation) =>
                view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId: automation.id })
              }
              onToggle={onToggle}
            />
            <SuggestedAutomations disabled={workspace === undefined} onStart={openSuggested} />
          </>
        )}
      </div>
    </section>
  );
}

/** One automation's page whose list, or the workspaces it is read in, could not be read: said so, with Retry, rather than called gone. */
function UnreadPage({
  line,
  onBack,
  onRetry,
}: {
  line: string;
  onBack: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return (
    <section className="automations-view" aria-label="Automation">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <Button variant={BUTTON_VARIANT.QUIET} icon={<ZapIcon />} onClick={onBack}>
            Automations
          </Button>
        </div>
      </header>
      <div className="automations-scroll scroll-fade-top">
        <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {line}
        </ErrorState>
      </div>
    </section>
  );
}

/** One automation's page that names an automation the list does not hold: it was deleted, or is of a workspace the reader is not in, as a link may name. */
function GonePage({ onBack }: { onBack: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return (
    <section className="automations-view" aria-label="Automation">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <Button variant={BUTTON_VARIANT.QUIET} icon={<ZapIcon />} onClick={onBack}>
            Automations
          </Button>
        </div>
      </header>
      <div className="automations-scroll scroll-fade-top">
        <NotFound thing={NOT_FOUND_THING.AUTOMATION} />
      </div>
    </section>
  );
}

/**
 * The editor's form as quiet blocks: the name in the page title's type, then
 * each group every automation has under its own heading, its rows' words and
 * controls, and the prompt's field, so the editor lands where they stood.
 */
function EditorSkeleton(): React.JSX.Element {
  return (
    <div className="automation-editor">
      <SkeletonRegion label={READING_AUTOMATION}>
        <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.DIV}>
          <Skeleton width={SKELETON_NAME} />
        </Text>
        <div className="automation-form">
          {EDITOR_SKELETON.map(({ title, rows }) =>
            rows.length === 0 ? (
              <SettingsSection key={title} title={title} frame={SETTINGS_SECTION_FRAME.NONE}>
                <div className="automation-prompt-skeleton">
                  <Skeleton shape={SKELETON_SHAPE.BLOCK} />
                </div>
              </SettingsSection>
            ) : (
              <SettingsSection key={title} title={title}>
                {rows.map(({ label, detail }) => (
                  <SettingsRow
                    key={label}
                    label={<Skeleton width={label} />}
                    description={<Skeleton width={detail} />}
                  >
                    {() => <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_CONTROL} />}
                  </SettingsRow>
                ))}
              </SettingsSection>
            ),
          )}
        </div>
      </SkeletonRegion>
    </div>
  );
}

/**
 * One automation's page opened before the list is first read, from a link,
 * ⌘K, or a run's card: the editor's toolbar, its crumbs' way back to the list
 * and a block where the automation's name will stand, over its form and its
 * Runs panel as quiet blocks, until the list says what it holds.
 */
function ReadingPage({ onBack }: { onBack: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  const runsPanel = useRunsPanel();
  return (
    <section className="automations-view" aria-label="Automation">
      <header className="desktop-toolbar">
        <div className="automation-toolbar">
          <div className="desktop-toolbar-heading automation-toolbar-reading">
            <nav className="automation-crumbs" aria-label="Path">
              <FoldingButton label="Automations" icon={<ZapIcon />} onClick={onBack} />
              <ChevronRightIcon aria-hidden="true" />
              <span className="automation-crumb">
                <Skeleton width={SKELETON_CRUMB} />
              </span>
            </nav>
            <ExperimentTag />
          </div>
          <div className="desktop-toolbar-actions">
            <SendFeedbackButton experiment={EXPERIMENT.AUTOMATIONS} />
          </div>
        </div>
      </header>
      <div className="automation-editor-layout">
        <div className="automations-scroll scroll-fade-top">
          <EditorSkeleton />
        </div>
        <AutomationRunsPanel
          panel={runsPanel}
          mine
          created
          automationId={undefined}
          runs={undefined}
          onRetry={() => undefined}
          onOpenAgent={() => undefined}
        />
      </div>
    </section>
  );
}

/**
 * The window's Automations pages, in the task's place: the list, or one
 * automation's editor, or a new one's. The list is read once for all of
 * them, so an automation opened from it opens as it was listed, and an
 * edit is in the list the moment it lands.
 */
export function AutomationsPage({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  // Every Copy link on these pages is written under the listed workspace, whose automations they are.
  return (
    <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
      <AutomationsPages tasks={tasks} />
    </LinkWorkspaceProvider>
  );
}

/** The Automations pages themselves, under the workspace their links are written in. */
function AutomationsPages({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const view = tasks.automationsView;
  const workspace = tasks.workspace;
  // Note that no list is asked for while no workspace is listed, which is
  // while the workspaces are still read, so the pages stand as quiet blocks
  // until one is, rather than calling the list empty or an automation gone;
  // a workspaces read that did not land says so instead.
  const automations = useAutomations(workspace?.id);
  // The automation the new page made, whose page is that same editor still, so what was typed while it was made stands.
  const [made, setMade] = useState<string | undefined>(undefined);
  const back = () => view.onOpen({ kind: AUTOMATIONS_PAGE.LIST });
  const { place } = view;
  if (place.kind === AUTOMATIONS_PAGE.LIST) {
    return <ListPage tasks={tasks} automations={automations} />;
  }
  const { read, reload } = automations;
  if (workspace === undefined && tasks.workspacesFailed) {
    return (
      <UnreadPage line={WORKSPACES_UNREAD_LINE} onBack={back} onRetry={tasks.onRetryWorkspaces} />
    );
  }
  if (read !== undefined && "failure" in read) {
    return <UnreadPage line={UNREAD_LINE} onBack={back} onRetry={reload} />;
  }
  const listedAutomations = read === undefined ? [] : read.automations;
  const opened =
    place.kind === AUTOMATIONS_PAGE.EDIT
      ? listedAutomations.find((automation) => automation.id === place.automationId)
      : undefined;
  if (place.kind === AUTOMATIONS_PAGE.EDIT && opened === undefined) {
    return read === undefined ? <ReadingPage onBack={back} /> : <GonePage onBack={back} />;
  }
  // Note that the account's first workspace is its personal one, where everything is its own.
  const offersOwner = workspace !== undefined && tasks.workspaces[0]?.id !== workspace.id;
  const preset = place.kind === AUTOMATIONS_PAGE.NEW ? place.preset : undefined;
  const editing = opened === undefined || opened.id === made ? AUTOMATIONS_PAGE.NEW : opened.id;
  return (
    // Keyed by the workspace, then by what it edits, so another workspace's page or another automation's holds nothing of the last's draft.
    <Fragment key={workspace?.id}>
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
        onDeleted={(automationId) =>
          view.onOpen({ kind: AUTOMATIONS_PAGE.LIST, deleted: automationId })
        }
        onCreated={(automationId) => {
          setMade(automationId);
          view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId, created: true });
        }}
      />
    </Fragment>
  );
}

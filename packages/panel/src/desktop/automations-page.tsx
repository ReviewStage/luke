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
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  DetailPage,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  LIST_VARIANT,
  List,
  ListRow,
  NO_CONTEXT_MENU,
  PAGE_FRAME,
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
import { useAppCommand } from "../app-commands.js";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import { FoldingButton } from "../folding-button.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { GLYPH_STATE, glyphStateWords, StateGlyph, stateEndMark } from "../state-glyph.js";
import { momentText, useMinute } from "../tasks/task-time.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { Tooltip } from "../tooltip.js";
import { useExperiment } from "../use-app-state.js";
import { ActionMenu } from "./action-menu.js";
import { AutomationEditor } from "./automation-editor.js";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner.js";
import { AutomationRunsPanel, FiringGlyph, STANDING_GLYPH } from "./automation-runs-panel.js";
import {
  automationNextText,
  automationOwnerName,
  READING_AUTOMATIONS,
} from "./automation-words.js";
import { useRunsPanel } from "./folded-groups.js";
import { useAutomations } from "./use-automations.js";

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
 * and an automation turned off reads "Off" where its next run would.
 * Under the list, or under the line saying there is none yet, stand the
 * suggested automations: a press opens a new automation's page filled in
 * from the suggestion's preset, to look over and Create. Code review, the
 * one suggestion, is still an experiment (`EXPERIMENT.CODE_REVIEW`), so
 * nothing is suggested, and no page opens filled in from it, while the
 * account has it off.
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

/** The presets the list suggests while Code review's experiment is on, in its order, each by the glyph of what fires it. */
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
 * One automation's row: the glyph of what fires it on a tile, as a
 * suggestion's is, wearing where its newest run stands, its name over what
 * fires it, its owner, when it runs next with a failure's mark before it,
 * and its switch. The owner and the next run each keep a column of their
 * own, so they line up down the card whatever each row says. Everything but the switch is one press
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
          <span className="automation-row-glyph">
            <StateGlyph glyph={<FiringGlyph kind={automation.trigger.kind} />} state={state} />
          </span>
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
            <span className="automation-row-next">
              {stateEndMark(state, true)}
              <Tooltip label={next.kind === AUTOMATION_NEXT.AT ? momentText(next.at) : undefined}>
                <span className="automation-row-when">{automationNextText(automation, now)}</span>
              </Tooltip>
            </span>
          </span>
        }
        actions={
          <Switch
            checked={automation.enabled}
            label={
              automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`
            }
            onChange={(enabled) => onToggle(enabled)}
            {...NO_CONTEXT_MENU}
          />
        }
        onPress={onOpen}
        contextMenu={copyLink === undefined ? undefined : menu.contextMenu(press)}
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

/** What the list's page shows: the workspaces or the list unread, the list still being read, or the list. */
function listState(
  workspacesUnread: boolean,
  read: ReturnType<typeof useAutomations>["read"],
): CollectionState {
  if (workspacesUnread) return COLLECTION_STATE.ERROR;
  if (read === undefined) return COLLECTION_STATE.LOADING;
  return "failure" in read ? COLLECTION_STATE.ERROR : COLLECTION_STATE.READY;
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
  const workspacesUnread = workspace === undefined && tasks.workspacesFailed;
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Automations"
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">Automations</h1>
          </div>
          <div className="desktop-toolbar-actions">
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
      }
      state={listState(workspacesUnread, read)}
      loadingLabel={READING_AUTOMATIONS}
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
      {/* Note that a list with none is ready rather than empty, because the suggestions under its empty state are content. */}
      {groups.length === 0 ? (
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
    </CollectionPage>
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
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Automation"
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <Button variant={BUTTON_VARIANT.QUIET} icon={<ZapIcon />} onClick={onBack}>
              Automations
            </Button>
          </div>
        </header>
      }
    >
      <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
        {line}
      </ErrorState>
    </DetailPage>
  );
}

/** One automation's page that names an automation the list does not hold: it was deleted, or is of a workspace the reader is not in, as a link may name. */
function GonePage({ onBack }: { onBack: () => void }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Automation"
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <Button variant={BUTTON_VARIANT.QUIET} icon={<ZapIcon />} onClick={onBack}>
              Automations
            </Button>
          </div>
        </header>
      }
    >
      <NotFound thing={NOT_FOUND_THING.AUTOMATION} />
    </DetailPage>
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
    <div className="automations-view">
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
          </div>
        </div>
      </header>
      <div className="automation-editor-layout">
        <DetailPage frame={PAGE_FRAME.TOOLBAR} label="Automation">
          <EditorSkeleton />
        </DetailPage>
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
    </div>
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
  // Code review, the one preset, is an experiment, so a new page opened from it while it is off starts blank.
  const preset = place.kind === AUTOMATIONS_PAGE.NEW && codeReviewOn ? place.preset : undefined;
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

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
import { GitPullRequestIcon, PlusIcon, ZapIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item";
import { EmptyState } from "../empty-state";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { NOT_FOUND_THING, NotFound } from "../not-found";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { StateGlyph, stateEndMark } from "../state-glyph";
import { Switch } from "../switch";
import { momentText, useMinute } from "../tasks/task-time";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { ActionMenu, useActionMenu } from "./action-menu";
import { AutomationEditor } from "./automation-editor";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner";
import { FiringGlyph, STANDING_GLYPH } from "./automation-runs-panel";
import { automationNextText, automationOwnerName } from "./automation-words";
import { useAutomations } from "./use-automations";

/**
 * automations-page.tsx -- the window's Automations page: the listed workspace's automations, each with its owner beyond doubt, when it runs next, how its newest run went, and its switch.
 *
 * It stands in the plan's place beside the sidebar, as Factory does, and
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
    <span className="automation-owner" data-owner={owner} title={name}>
      <OwnerMark owner={owner} workspace={workspace} mine={mine} size={OWNER_MARK_SIZE.INLINE} />
      <span className="automation-owner-name">{name}</span>
    </span>
  );
}

/**
 * One automation's row: the glyph of what fires it wearing where its newest run
 * stands, its name over what fires it, its owner, when it runs next, a
 * failure's mark, and its switch. Everything but the switch is one press
 * that opens its page, as a sidebar task's row is, so the row opens wherever
 * it is pressed and the switch beside the press only switches.
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
  const menu = useActionMenu(true);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  return (
    <div className="automation-row" data-enabled={String(automation.enabled)}>
      <button
        type="button"
        className="automation-row-open"
        onClick={onOpen}
        onContextMenu={copyLink === undefined ? undefined : menu.contextMenu()}
      >
        <StateGlyph glyph={<FiringGlyph kind={automation.trigger.kind} />} state={state} />
        <span className="automation-row-copy">
          <span className="automation-row-name">{automation.name}</span>
          <span className="automation-row-detail">
            {automationTriggerText(automation.trigger, automation.repositories ?? [])}
          </span>
        </span>
        <OwnerCell
          owner={automationOwner(automation)}
          mine={automation.mine === true}
          workspace={workspace}
        />
        <span
          className="automation-row-when"
          title={next.kind === AUTOMATION_NEXT.AT ? momentText(next.at) : undefined}
        >
          {automationNextText(automation, now)}
        </span>
        {stateEndMark(state, true)}
      </button>
      <Switch
        checked={automation.enabled}
        label={automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`}
        onChange={(enabled) => onToggle(enabled)}
      />
      {menu.drawn === undefined || copyLink === undefined ? null : (
        <ActionMenu
          label={ROW_ACTIONS}
          menu={menu.drawn}
          groups={[[copyLink]]}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/** The list, each owner's automations under its own heading where both stand. */
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
      {groups.map((group) => (
        <section
          key={group.owner}
          className="automation-group"
          aria-label={automationOwnerName(group.owner, workspace?.name)}
        >
          {groups.length > 1 ? (
            <h2 className="settings-group-title">
              {automationOwnerName(group.owner, workspace?.name)}
            </h2>
          ) : null}
          <div className="settings-card">
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
          </div>
        </section>
      ))}
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
    <section className="settings-group automation-suggestions" aria-label="Suggested">
      <h2 className="settings-group-title">Suggested</h2>
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
          <button
            type="button"
            className="toolbar-button bordered-button"
            disabled={workspace === undefined}
            onClick={openNew}
          >
            <PlusIcon />
            New automation
          </button>
        </div>
      </header>
      <div className="automations-scroll scroll-fade-top">
        {read === undefined ? null : "failure" in read ? (
          <ReadFailure line={UNREAD_LINE} onRetry={reload} place={READ_FAILURE_PLACE.CENTRED} />
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

/** One automation's page whose list could not be read: said so, with Retry, rather than called gone. */
function UnreadPage({
  onBack,
  onRetry,
}: {
  onBack: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  return (
    <section className="automations-view" aria-label="Automation">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <button type="button" className="toolbar-button" onClick={onBack}>
            <ZapIcon />
            Automations
          </button>
        </div>
      </header>
      <div className="automations-scroll scroll-fade-top">
        <ReadFailure line={UNREAD_LINE} onRetry={onRetry} place={READ_FAILURE_PLACE.CENTRED} />
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
          <button type="button" className="toolbar-button" onClick={onBack}>
            <ZapIcon />
            Automations
          </button>
        </div>
      </header>
      <div className="automations-scroll scroll-fade-top">
        <NotFound thing={NOT_FOUND_THING.AUTOMATION} />
      </div>
    </section>
  );
}

/**
 * The window's Automations pages, in the plan's place: the list, or one
 * automation's editor, or a new one's. The list is read once for all of
 * them, so an automation opened from it opens as it was listed, and an
 * edit is in the list the moment it lands.
 */
export function AutomationsPage({ tasks: plans }: { tasks: TasksControl }): React.JSX.Element {
  // Every Copy link on these pages is written under the listed workspace, whose automations they are.
  return (
    <LinkWorkspaceProvider value={plans.workspace?.slug ?? plans.workspace?.id}>
      <AutomationsPages tasks={plans} />
    </LinkWorkspaceProvider>
  );
}

/** The Automations pages themselves, under the workspace their links are written in. */
function AutomationsPages({ tasks: plans }: { tasks: TasksControl }): React.JSX.Element {
  const view = plans.automationsView;
  const workspace = plans.workspace;
  const automations = useAutomations(workspace?.id);
  // The automation the new page made, whose page is that same editor still, so what was typed while it was made stands.
  const [made, setMade] = useState<string | undefined>(undefined);
  const back = () => view.onOpen({ kind: AUTOMATIONS_PAGE.LIST });
  const { place } = view;
  if (place.kind === AUTOMATIONS_PAGE.LIST) {
    return <ListPage tasks={plans} automations={automations} />;
  }
  const { read, reload } = automations;
  if (read !== undefined && "failure" in read) {
    return <UnreadPage onBack={back} onRetry={reload} />;
  }
  const listedAutomations = read === undefined ? [] : read.automations;
  const opened =
    place.kind === AUTOMATIONS_PAGE.EDIT
      ? listedAutomations.find((automation) => automation.id === place.automationId)
      : undefined;
  if (place.kind === AUTOMATIONS_PAGE.EDIT && opened === undefined) {
    return read === undefined ? (
      <section className="automations-view" aria-label="Automation" />
    ) : (
      <GonePage onBack={back} />
    );
  }
  // Note that the account's first workspace is its personal one, where everything is its own.
  const offersOwner = workspace !== undefined && plans.workspaces[0]?.id !== workspace.id;
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
        repositories={plans.newTask.repositoriesIn(workspace?.id)}
        writes={automations}
        onBack={back}
        onOpenAgent={(agentId) => plans.agentView.onOpen(agentId)}
        linked={place.kind === AUTOMATIONS_PAGE.EDIT ? place : undefined}
        leaveGuard={plans.leaveGuard}
        onCreated={(automationId) => {
          setMade(automationId);
          view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId });
        }}
      />
    </Fragment>
  );
}

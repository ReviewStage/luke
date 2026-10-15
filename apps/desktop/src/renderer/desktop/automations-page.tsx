import {
  AUTOMATION_NEXT,
  AUTOMATION_RUN_STANDING,
  type AutomationGroup,
  type AutomationRunStanding,
  automationGroups,
  automationNext,
  automationOwner,
  automationRunStanding,
  automationTriggerText,
} from "@luke/features/automation-list-model";
import { AUTOMATION_CALL_FAILURE, type AutomationView } from "@luke/features/automation-view";
import {
  AUTOMATION_SCOPE,
  type AutomationScope,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { EXPERIMENT } from "@luke/settings";
import { BuildingIcon, ClockIcon, LockIcon, PlusIcon, ZapIcon } from "lucide-react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { useOpenFeedback } from "../open-feedback";
import { dayAndTimeText, momentText, useMinute } from "../planning/plan-time";
import { AUTOMATIONS_PAGE, type PlansControl } from "../planning/use-plans-tab";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { GLYPH_STATE, type GlyphState, StateGlyph, stateEndMark } from "../state-glyph";
import { Switch } from "../switch";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { AutomationEditor } from "./automation-editor";
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
 * feedback.
 */

/** How near a next run is still named by its weekday alone: under a week, so no weekday stands for two days. */
const WEEKDAY_REACH_MS = 6 * 24 * 60 * 60 * 1000;

const WEEKDAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** The glyph each standing of a newest run wears. */
const STANDING_GLYPH = {
  [AUTOMATION_RUN_STANDING.WORKING]: GLYPH_STATE.WORKING,
  [AUTOMATION_RUN_STANDING.FAILED]: GLYPH_STATE.FAILED,
  [AUTOMATION_RUN_STANDING.REST]: GLYPH_STATE.REST,
} as const satisfies Record<AutomationRunStanding, GlyphState>;

/** What the list says where it could not be read. */
const UNREAD_LINE = "The automations could not be read.";

/** When an automation runs next, in the few words its row ends with: within the week by its weekday, further off by its date. */
function nextText(automation: AutomationSummary, now: number): string {
  const next = automationNext(automation);
  switch (next.kind) {
    case AUTOMATION_NEXT.OFF:
      return "Off";
    case AUTOMATION_NEXT.PAUSED:
      return "Paused";
    case AUTOMATION_NEXT.UNSCHEDULED:
      return "Not scheduled";
    case AUTOMATION_NEXT.AT:
      return next.at - now < WEEKDAY_REACH_MS
        ? `Next ${WEEKDAY_AND_TIME.format(next.at)}`
        : `Next ${dayAndTimeText(next.at)}`;
  }
}

/** Why a switch did not move, as its toast says it. */
function toggleRefusal(answer: AutomationView, enabled: boolean): string | undefined {
  if (!("failure" in answer)) return undefined;
  if (answer.failure === AUTOMATION_CALL_FAILURE.NOT_PERMITTED) {
    return "Only its creator, or the workspace's owners and admins, can change it.";
  }
  return enabled ? "Couldn't turn it on. Try again." : "Couldn't turn it off. Try again.";
}

/** An owner as its column and its heading name it: the workspace by its name, or Personal. */
function ownerName(owner: AutomationScope, workspaceName: string | undefined): string {
  return owner === AUTOMATION_SCOPE.WORKSPACE ? (workspaceName ?? "Workspace") : "Personal";
}

/** Who owns an automation, as its row's column says it: a building and the workspace, or a lock and Personal, its name whole on hover where the column cuts it short. */
function OwnerCell({
  owner,
  workspaceName,
}: {
  owner: AutomationScope;
  workspaceName: string | undefined;
}): React.JSX.Element {
  return (
    <span className="automation-owner" data-owner={owner} title={ownerName(owner, workspaceName)}>
      {owner === AUTOMATION_SCOPE.WORKSPACE ? (
        <BuildingIcon aria-hidden="true" />
      ) : (
        <LockIcon aria-hidden="true" />
      )}
      <span className="automation-owner-name">{ownerName(owner, workspaceName)}</span>
    </span>
  );
}

/**
 * One automation's row: its schedule's clock wearing where its newest run
 * stands, its name over what fires it, its owner, when it runs next, a
 * failure's mark, and its switch.
 */
function AutomationRow({
  automation,
  workspaceName,
  now,
  onOpen,
  onToggle,
}: {
  automation: AutomationSummary;
  workspaceName: string | undefined;
  now: number;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  const state = STANDING_GLYPH[automationRunStanding(automation.lastRun)];
  const next = automationNext(automation);
  return (
    <div className="automation-row" data-enabled={String(automation.enabled)}>
      <button type="button" className="automation-row-open" onClick={onOpen}>
        <StateGlyph glyph={<ClockIcon />} state={state} />
        <span className="automation-row-copy">
          <span className="automation-row-name">{automation.name}</span>
          <span className="automation-row-detail">{automationTriggerText(automation.trigger)}</span>
        </span>
      </button>
      <OwnerCell owner={automationOwner(automation)} workspaceName={workspaceName} />
      <span
        className="automation-row-when"
        title={next.kind === AUTOMATION_NEXT.AT ? momentText(next.at) : undefined}
      >
        {nextText(automation, now)}
      </span>
      {stateEndMark(state, true)}
      <Switch
        checked={automation.enabled}
        label={automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`}
        onChange={(enabled) => onToggle(enabled)}
      />
    </div>
  );
}

/** The list, each owner's automations under its own heading where both stand. */
function AutomationList({
  groups,
  workspaceName,
  now,
  onOpen,
  onToggle,
}: {
  groups: readonly AutomationGroup[];
  workspaceName: string | undefined;
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
          aria-label={ownerName(group.owner, workspaceName)}
        >
          {groups.length > 1 ? (
            <h2 className="settings-group-title">{ownerName(group.owner, workspaceName)}</h2>
          ) : null}
          <div className="settings-card">
            {group.automations.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                workspaceName={workspaceName}
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

/** The list's page: the listed workspace's automations, a new one a press away. */
function ListPage({
  plans,
  automations,
}: {
  plans: PlansControl;
  automations: ReturnType<typeof useAutomations>;
}): React.JSX.Element {
  const view = plans.automationsView;
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, view.onClose);
  const openFeedback = useOpenFeedback();
  const toast = useToast();
  const now = useMinute();
  const workspace = plans.workspace;
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
  const groups =
    read !== undefined && "automations" in read ? automationGroups(read.automations) : [];
  return (
    <section className="automations-view" aria-label="Automations">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">Automations</h1>
          <span className="integration-tool-badge experiment-badge">Experimental</span>
        </div>
        <div className="desktop-toolbar-actions">
          <button
            type="button"
            className="experiment-feedback"
            onClick={() => openFeedback(EXPERIMENT.AUTOMATIONS)}
          >
            Send feedback
          </button>
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
      <div className="automations-scroll">
        {read === undefined ? null : "failure" in read ? (
          <ReadFailure line={UNREAD_LINE} onRetry={reload} place={READ_FAILURE_PLACE.CENTRED} />
        ) : groups.length === 0 ? (
          <EmptyState icon={<ZapIcon />} title="No automations yet">
            An automation starts a coding agent on a schedule, for you alone or for everyone in{" "}
            {workspace?.name ?? "the workspace"}.
          </EmptyState>
        ) : (
          <AutomationList
            groups={groups}
            workspaceName={workspace?.name}
            now={now}
            onOpen={(automation) =>
              view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId: automation.id })
            }
            onToggle={onToggle}
          />
        )}
      </div>
    </section>
  );
}

/** One automation's page that names an automation the list no longer holds: it was deleted, or is not this workspace's. */
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
      <div className="automations-scroll">
        <EmptyState icon={<ZapIcon />} title="This automation is gone">
          It was deleted, or it belongs to another workspace.
        </EmptyState>
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
export function AutomationsPage({ plans }: { plans: PlansControl }): React.JSX.Element {
  const view = plans.automationsView;
  const workspace = plans.workspace;
  const automations = useAutomations(workspace?.id);
  const back = () => view.onOpen({ kind: AUTOMATIONS_PAGE.LIST });
  const { place } = view;
  if (place.kind === AUTOMATIONS_PAGE.LIST) {
    return <ListPage plans={plans} automations={automations} />;
  }
  const { read } = automations;
  const listedAutomations = read !== undefined && "automations" in read ? read.automations : [];
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
  return (
    <AutomationEditor
      // Keyed by what it edits, so another automation's page holds nothing of the last's draft.
      key={opened?.id ?? AUTOMATIONS_PAGE.NEW}
      automation={opened}
      workspace={workspace}
      offersOwner={offersOwner}
      repositories={plans.newPlan.repositoriesIn(workspace?.id)}
      writes={automations}
      onBack={back}
      onCreated={(automationId) => view.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })}
    />
  );
}

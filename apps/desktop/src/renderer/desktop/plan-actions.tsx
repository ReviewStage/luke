import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import {
  ArchiveIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalIcon,
  PencilIcon,
  PinIcon,
  TrashIcon,
  UnarchiveIcon,
  UnpinIcon,
} from "@luke/panel";
import { HistoryIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { DOCUMENT_REGION, PLAN_MARK, type PlanMark } from "../planning/planning-model";
import { RelativeTime } from "../planning/relative-time";
import type { PlansControl } from "../planning/use-plans-tab";
import { ProviderMark } from "../provider-marks";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { confirmAsked } from "../settings/confirm-state";
import { Tooltip } from "../tooltip";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { PlanStatusMark, planCardOf } from "./plan-card";
import { PlanNameField, usePlanRename } from "./plan-name-field";

/**
 * plan-actions.tsx -- one plan's actions, offered alike from the toolbar's ⋯ button and from a right-click on the plan in the sidebar.
 *
 * Both doors open the same menu over the same plan, so a plan in the list can
 * be acted on without being opened first. The menu is the window's own (`action-menu.tsx`),
 * so both doors draw it the same way and Permanently delete can be drawn red.
 *
 * Rename edits the name where the door draws it: the sidebar's row turns
 * into a field, and the toolbar's ⋯ opens its title as one. Version history
 * opens the plan's versions over the whole window, opening the plan first
 * where it is not the open one, the one item that moves it. Pin and Archive
 * move the plan in the sidebar at once, and each is undone from the same
 * menu; a sidebar row also offers both as buttons at its end on hover.
 * Permanently delete cannot be undone, so choosing it asks first in a dialog
 * over the window that names the plan and offers Archive as the way to keep
 * it, whichever door it was chosen from.
 */

/** A plan as the list or the open document holds it, archived or not; nothing for a plan neither holds. */
function planOf(plans: PlansControl, planId: string): PlanSummary | undefined {
  const listed = [...plans.plans, ...plans.archived].find((plan) => plan.id === planId);
  if (listed !== undefined) return listed;
  const { region } = plans;
  return region.kind === DOCUMENT_REGION.READY && region.plan.id === planId
    ? region.plan
    : undefined;
}

/** One way a plan can be moved in the sidebar, as the menu and the row's own buttons both offer it. */
interface PlaceMark {
  mark: PlanMark;
  label: string;
  icon: React.JSX.Element;
}

/**
 * Pin and Archive, each offered as whichever way the plan is not yet. An
 * archived plan offers no pin, because the sidebar draws it among the
 * archived whether or not it is pinned.
 */
function placeMarks(plan: PlanSummary): PlaceMark[] {
  if (plan.archivedAt !== undefined) {
    return [{ mark: PLAN_MARK.UNARCHIVE, label: "Unarchive", icon: <UnarchiveIcon /> }];
  }
  return [
    plan.pinnedAt === undefined
      ? { mark: PLAN_MARK.PIN, label: "Pin", icon: <PinIcon /> }
      : { mark: PLAN_MARK.UNPIN, label: "Unpin", icon: <UnpinIcon /> },
    { mark: PLAN_MARK.ARCHIVE, label: "Archive", icon: <ArchiveIcon /> },
  ];
}

/** Pin and Archive as the menu's items; nothing for a plan neither the list nor the document holds. */
function placeActions(plans: PlansControl, plan: PlanSummary | undefined): MenuAction[] {
  if (plan === undefined) return [];
  return placeMarks(plan).map(({ mark, label, icon }) => ({
    label,
    icon,
    onSelect: () => plans.onMarkPlan(plan.id, mark),
  }));
}

/**
 * Pin and Archive at a sidebar row's end, standing in the time's place while
 * the row is hovered or reached from the keyboard. Rested on, the row hangs
 * the plan's card beside it (`plan-card.tsx`): its name in full, its
 * repository, and its agents and pull requests, read from the list's row. Each runs what its menu
 * item runs, and only the open plan's Archive names ⇧⌘A, because the chord
 * archives the open plan rather than the row under the pointer. They are the
 * row's siblings rather than inside it, so a press on one opens nothing, but
 * part of the row to its card, which stands while the pointer is on them and
 * goes as one is pressed (`Tooltip`'s `cardRegion`).
 */
function SidebarPlanMarks({
  plans,
  plan,
  current,
  disabled,
  onContextMenu,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  current: boolean;
  disabled: boolean;
  /** Offers the row's own menu, so a right-click on a button over its end still reaches it. */
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}): React.JSX.Element {
  return (
    <span className="sidebar-plan-marks">
      {placeMarks(plan).map(({ mark, label, icon }) => (
        <Tooltip
          key={mark}
          label={label}
          {...(current && mark === PLAN_MARK.ARCHIVE ? { command: APP_COMMAND.ARCHIVE_PLAN } : {})}
        >
          <button
            type="button"
            className="sidebar-plan-mark"
            aria-label={label}
            disabled={disabled}
            onClick={() => plans.onMarkPlan(plan.id, mark)}
            onContextMenu={onContextMenu}
          >
            {icon}
          </button>
        </Tooltip>
      ))}
    </span>
  );
}

/**
 * One plan's actions in the groups a rule divides, offering only those that
 * apply to it now. Copy formats the document drawn, so only the open plan
 * offers it, ahead of Rename and Version history; Pin and Archive follow; the repository is
 * changed from any plan and opened on GitHub where there is one; Permanently
 * delete is last and alone. An archived plan takes nothing until it is
 * brought back, so it offers neither Rename nor Change repository, only
 * what reads it, its version history (which restores nothing), Unarchive,
 * and Permanently delete.
 */
function planActionGroups(
  plans: PlansControl,
  planId: string,
  doors: { rename: () => void; askDelete: () => void },
): MenuAction[][] {
  const { region } = plans;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.plan.id === planId;
  const plan = planOf(plans, planId);
  const archived = plan?.archivedAt !== undefined;
  const copy: MenuAction = { label: "Copy plan", icon: <CopyIcon />, onSelect: plans.copy.onPress };
  const rename: MenuAction = { label: "Rename", icon: <PencilIcon />, onSelect: doors.rename };
  const versions: MenuAction = {
    label: "Version history",
    icon: <HistoryIcon />,
    onSelect: () => plans.history.onOpen(planId),
  };
  const change: MenuAction = {
    label: "Change repository",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onSelect: () => plans.onChangeRepository(planId),
  };
  const open: MenuAction = {
    label: "Open on GitHub",
    icon: <ExternalIcon />,
    onSelect: () => plans.onOpenOnGitHub(planId),
  };
  const groups: MenuAction[][] = [
    [...(drawn ? [copy] : []), ...(archived ? [] : [rename]), versions],
    placeActions(plans, plan),
    [...(archived ? [] : [change]), ...((plan?.repository ?? null) === null ? [] : [open])],
    [
      {
        label: "Permanently delete",
        icon: <TrashIcon />,
        onSelect: doors.askDelete,
        danger: true,
      },
    ],
  ];
  return groups.filter((group) => group.length > 0);
}

/**
 * The question Permanently delete asks, naming the plan. Deleting a plan
 * removes its document and its board and clears the conversation its
 * transcript is read from, which nothing in the app brings back, so a plan
 * not yet archived is pointed at Archive, which keeps all of it.
 */
function deleteQuestion(name: string, archived: boolean): DialogQuestion {
  const lost = `“${name}” and its board and transcript will be deleted. This can’t be undone.`;
  return {
    title: "Permanently delete plan?",
    body: archived ? lost : `${lost} To keep it out of the way instead, archive it.`,
    verb: "Permanently delete",
    running: "Deleting",
  };
}

/**
 * One plan's menu and its delete question, held for whichever door offers
 * them. Neither outlives the tab going off screen, the menu does not
 * outlive its door, and the question does not outlive the plan: each is
 * taken down in the render that finds it gone, so neither is left standing
 * over another surface, over a plan deleted elsewhere, or waiting for the
 * next time the panel opens.
 */
function usePlanMenu(
  plans: PlansControl,
  planId: string,
  name: string,
  doors: { rename: () => void; drawn: boolean },
) {
  const plan = planOf(plans, planId);
  const deletion = useConfirmDialog({ subject: plan !== undefined, surfaceOpen: plans.shown }, () =>
    plans.onDeletePlan(planId),
  );
  const { open, drawn, close, trigger, contextMenu } = useActionMenu(plans.shown && doors.drawn);
  const menu =
    drawn === undefined ? null : (
      <ActionMenu
        label="Plan actions"
        menu={drawn}
        groups={planActionGroups(plans, planId, {
          rename: doors.rename,
          askDelete: deletion.ask,
        })}
        onClose={close}
      />
    );
  const dialog = (
    <ConfirmDialog
      confirm={deletion}
      question={deleteQuestion(name, plan?.archivedAt !== undefined)}
    />
  );
  return { deletion, open: open !== undefined, close, trigger, contextMenu, menu, dialog };
}

/**
 * The open plan's ⋯ button in the toolbar, and the menu it drops, drawn
 * while the plan's own tab is chosen, because the menu is the plan's and not
 * an agent's. It is also what offers the open plan's Archive and Permanently
 * delete shortcuts, on every tab of the plan, so each runs exactly as its
 * menu item would: Permanently delete still asks first, and an archived plan
 * has no Archive to offer.
 */
export function PlanActions({
  plans,
  plan,
  button,
  onRename,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Whether the ⋯ button is drawn: the shortcuts and the delete question stand either way. */
  button: boolean;
  /** Opens the toolbar's title as the plan's name field. */
  onRename: () => void;
}): React.JSX.Element {
  const actions = usePlanMenu(plans, plan.id, plan.name, {
    rename: onRename,
    drawn: button,
  });
  const { deletion } = actions;
  const asking = confirmAsked(deletion.stage);
  useAppCommand(APP_COMMAND.DELETE_PLAN, asking || deletion.busy ? undefined : deletion.ask);
  useAppCommand(
    APP_COMMAND.ARCHIVE_PLAN,
    plan.archivedAt === undefined ? () => plans.onMarkPlan(plan.id, PLAN_MARK.ARCHIVE) : undefined,
  );
  return (
    <>
      {button ? (
        <Tooltip label="Plan actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Plan actions"
            disabled={deletion.busy}
            {...actions.trigger()}
          >
            <EllipsisIcon />
          </button>
        </Tooltip>
      ) : null}
      {actions.menu}
      {actions.dialog}
    </>
  );
}

/**
 * A plan in the sidebar, pinned, listed, or archived alike: its name, in the
 * body's weight unless the plan is unread, and at the row's end how long ago
 * it was last updated, led by one mark for an agent at work or a pull
 * request (`plan-card.tsx`), which Pin and Archive stand in place of while
 * the row is hovered or reached from the keyboard.
 * A press opens it, and a right-click offers its actions where the pointer is. Renamed,
 * the row is its name's field until the edit ends, and a key that ends it
 * hands focus back to the row.
 *
 */
export function SidebarPlan({
  plans,
  plan,
  current,
  unread,
  now,
  onOpen,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Whether this is the plan the work column is showing. */
  current: boolean;
  /** Whether the plan was saved since the developer last looked at it on this Mac. */
  unread: boolean;
  /** The time the row's last update is counted back from. */
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  const rename = usePlanRename(plan.id, plans.onRenamePlan);
  const actions = usePlanMenu(plans, plan.id, plan.name, {
    rename: rename.begin,
    drawn: true,
  });
  const row = useRef<HTMLButtonElement | null>(null);
  const item = useRef<HTMLLIElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    row.current?.focus();
  }, [rename.editing]);
  // Note that the row is what the menu rings and hands focus back to, even
  // when the right-click lands on Pin or Archive over its end.
  const showMenu = actions.contextMenu(row);
  return (
    <li ref={item} className="sidebar-plan-item">
      {rename.editing ? (
        <div className="sidebar-plan" aria-current={current ? "page" : undefined}>
          <PlanNameField
            name={plan.name}
            className="sidebar-plan-field"
            onEnd={(edit) => {
              refocus.current = edit.byKey;
              rename.end(edit);
            }}
          />
        </div>
      ) : (
        <Tooltip label={plan.name} card={planCardOf(plans, plan, now)} cardBeside cardRegion={item}>
          <button
            ref={row}
            type="button"
            className="sidebar-plan"
            aria-current={current ? "page" : undefined}
            data-menu-open={String(actions.open)}
            data-unread={String(unread)}
            disabled={actions.deletion.busy}
            onClick={() => {
              actions.close(false);
              onOpen();
            }}
            onContextMenu={showMenu}
          >
            <span className="sidebar-plan-line">
              <span className="sidebar-plan-name">{plan.name}</span>
              {unread ? <span className="visually-hidden">(unread)</span> : null}
              <span className="sidebar-plan-time">
                <PlanStatusMark plan={plan} />
                <RelativeTime at={plan.updatedAt} now={now} hint={false} />
              </span>
            </span>
          </button>
        </Tooltip>
      )}
      {rename.editing ? null : (
        <SidebarPlanMarks
          plans={plans}
          plan={plan}
          current={current}
          disabled={actions.deletion.busy}
          onContextMenu={showMenu}
        />
      )}
      {rename.note !== undefined ? (
        <p className="sidebar-note" role="alert">
          {rename.note}
        </p>
      ) : null}
      {actions.menu}
      {actions.dialog}
    </li>
  );
}

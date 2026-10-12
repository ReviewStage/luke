import type { PlanSummary } from "@sidecar/hosted/plan-wire";
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
} from "@sidecar/panel";
import { useEffect, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { GitHubMark } from "../account-marks";
import { useAppCommand } from "../app-commands";
import { sinceText } from "../planning/plan-time";
import { DOCUMENT_REGION, PLAN_MARK, type PlanMark } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { RepositoryPicture } from "../repository-picture";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { confirmAsked } from "../settings/confirm-state";
import { Tooltip } from "../tooltip";
import { ActionMenu, atPointer, dropBelow, type MenuAction, useActionMenu } from "./action-menu";
import { PlanNameField, usePlanRename } from "./plan-name-field";

/**
 * plan-actions.tsx -- one plan's actions, offered alike from the toolbar's ⋯ button and from a right-click on the plan in the sidebar.
 *
 * Both doors open the same menu over the same plan, so a plan in the list can
 * be acted on without being opened first, and nothing in the menu moves the
 * window to another plan. The menu is the window's own (`action-menu.tsx`),
 * so both doors draw it the same way and Permanently delete can be drawn red.
 *
 * Rename edits the name where the door draws it: the sidebar's row turns
 * into a field, and the toolbar's ⋯ opens its title as one. Pin and Archive
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
 * the row is hovered or reached from the keyboard. Each runs what its menu
 * item runs, and only the open plan's Archive names ⇧⌘A, because the chord
 * archives the open plan rather than the row under the pointer. They are the
 * row's siblings rather than inside it, so a press on one opens nothing.
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
  onContextMenu: (event: React.MouseEvent) => void;
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
            className="icon-button sidebar-plan-mark"
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
 * offers it, ahead of Rename; Pin and Archive follow; the repository is
 * changed from any plan and opened on GitHub where there is one; Permanently
 * delete is last and alone.
 */
function planActionGroups(
  plans: PlansControl,
  planId: string,
  doors: { rename: () => void; askDelete: () => void },
): MenuAction[][] {
  const { region } = plans;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.plan.id === planId;
  const plan = planOf(plans, planId);
  const rename: MenuAction = { label: "Rename", icon: <PencilIcon />, onSelect: doors.rename };
  const change: MenuAction = {
    label: "Change repository…",
    icon: <GitHubMark />,
    onSelect: () => plans.onChangeRepository(planId),
  };
  const groups: MenuAction[][] = [
    drawn
      ? [{ label: "Copy plan", icon: <CopyIcon />, onSelect: plans.copy.onPress }, rename]
      : [rename],
    placeActions(plans, plan),
    (plan?.repository ?? null) === null
      ? [change]
      : [
          change,
          {
            label: "Open on GitHub",
            icon: <ExternalIcon />,
            onSelect: () => plans.onOpenOnGitHub(planId),
          },
        ],
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
    running: "Deleting…",
  };
}

/**
 * One plan's menu and its delete question, held for whichever door offers
 * them. Neither outlives the tab going off screen, and the question does not
 * outlive the plan: each is taken down in the render that finds it gone, so
 * neither is left standing over another surface, over a plan deleted
 * elsewhere, or waiting for the next time the panel opens.
 */
function usePlanMenu(plans: PlansControl, planId: string, name: string, rename: () => void) {
  const plan = planOf(plans, planId);
  const deletion = useConfirmDialog({ subject: plan !== undefined, surfaceOpen: plans.shown }, () =>
    plans.onDeletePlan(planId),
  );
  const { open, show, close } = useActionMenu(plans.shown);
  const menu =
    open === undefined ? null : (
      <ActionMenu
        label="Plan actions"
        menu={open}
        groups={planActionGroups(plans, planId, { rename, askDelete: deletion.ask })}
        onClose={close}
      />
    );
  const dialog = (
    <ConfirmDialog
      confirm={deletion}
      question={deleteQuestion(name, plan?.archivedAt !== undefined)}
    />
  );
  return { deletion, open: open !== undefined, show, close, menu, dialog };
}

/**
 * The open plan's ⋯ button in the toolbar, and the menu it drops. It is also
 * what offers the open plan's Archive and Permanently delete shortcuts, so
 * each runs exactly as its menu item would: Permanently delete still asks
 * first, and an archived plan has no Archive to offer.
 */
export function PlanActionsButton({
  plans,
  plan,
  onRename,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Opens the toolbar's title as the plan's name field. */
  onRename: () => void;
}): React.JSX.Element {
  const actions = usePlanMenu(plans, plan.id, plan.name, onRename);
  const { deletion } = actions;
  const asking = confirmAsked(deletion.stage);
  useAppCommand(APP_COMMAND.DELETE_PLAN, asking || deletion.busy ? undefined : deletion.ask);
  useAppCommand(
    APP_COMMAND.ARCHIVE_PLAN,
    plan.archivedAt === undefined ? () => plans.onMarkPlan(plan.id, PLAN_MARK.ARCHIVE) : undefined,
  );
  return (
    <>
      <Tooltip label="Plan actions">
        <button
          type="button"
          className="icon-button"
          aria-label="Plan actions"
          aria-haspopup="menu"
          aria-expanded={actions.open}
          disabled={deletion.busy}
          onClick={(event) => {
            if (actions.open) {
              actions.close(true);
              return;
            }
            actions.show(dropBelow(event.currentTarget), event.currentTarget);
          }}
        >
          <EllipsisIcon />
        </button>
      </Tooltip>
      {actions.menu}
      {actions.dialog}
    </>
  );
}

/**
 * A plan in the sidebar, pinned, listed, or archived alike: its name, in the
 * body's weight unless the plan is unread, and at the row's end how long ago
 * it was last updated, which Pin and Archive stand in place of while the row
 * is hovered or reached from the keyboard.
 * A press opens it, and a right-click offers its actions where the pointer is. Renamed,
 * the row is its name's field until the edit ends, and a key that ends it
 * hands focus back to the row.
 */
export function SidebarPlan({
  plans,
  plan,
  current,
  unread,
  repositoryShown,
  now,
  onOpen,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Whether this is the plan the work column is showing. */
  current: boolean;
  /** Whether the plan was saved since the developer last looked at it on this Mac. */
  unread: boolean;
  /** Whether the row names its repository beneath its name: a row under its repository's header leaves it to the header. */
  repositoryShown: boolean;
  /** The time the row's last update is counted back from. */
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  const rename = usePlanRename(plan.id, plans.onRenamePlan);
  const actions = usePlanMenu(plans, plan.id, plan.name, rename.begin);
  const row = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    row.current?.focus();
  }, [rename.editing]);
  // Note that the row is what the menu rings and hands focus back to, even
  // when the right-click lands on Pin or Archive over its end.
  const showMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (row.current === null) return;
    actions.show(atPointer(event), row.current);
  };
  const repository =
    repositoryShown && plan.repository !== null ? (
      <span className="sidebar-plan-repository">
        <RepositoryPicture
          repository={plan.repository}
          pictures={plans.repositories.pictures}
          fallback={<GitHubMark />}
        />
        <span className="sidebar-plan-repository-name">{plan.repository}</span>
      </span>
    ) : null;
  return (
    <li className="sidebar-plan-item">
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
          {repository}
        </div>
      ) : (
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
            <span className="sidebar-plan-time">{sinceText(plan.updatedAt, now)}</span>
          </span>
          {repository}
        </button>
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

import type { InstalledSkillSummary } from "@luke/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillFailedView,
} from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  BADGE_TONE,
  Badge,
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  ErrorState,
  PlusIcon,
  SettingsLine,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
  SettingsSectionsSkeleton,
  Switch,
  TrashIcon,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { useWorkspaceMembersRead } from "../tasks/use-workspace-members.js";
import { AddSkillDialog } from "./add-skill-dialog.js";
import { MenuRow } from "./menu-row.js";
import { shownWorkspace } from "./settings-rows.js";
import {
  failureLine,
  SKILLS_LINE,
  type SkillRow,
  skillGroups,
  withSkill,
  workspaceGroupTitle,
} from "./skills-model.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

/**
 * skills-page.tsx -- Settings › Skills: the skills the account installs into Luke for its agents, the listed workspace's and its own, and Add skill.
 *
 * The page lists the workspace the sidebar lists, its skills first under
 * its name, then the account's own under Personal, as the Automations list
 * groups (`skills-model.ts`). Each row is the skill's name, its scope's
 * badge, and under them its description, where its files came from, and who
 * installed it; at its end an Update available button where a GitHub
 * skill's folder moved at its ref, its switch, and a ⋯ with Remove, which
 * asks first. A row the account may not change, a teammate's workspace
 * skill to a member who is not an owner or admin, as the service says by
 * `manageable`, draws its switch unavailable and no ⋯. A line at the top says where repository skills come from and that a
 * change reaches only agents started afterwards, which nothing else on the
 * page can say. Add skill opens the dialog (`add-skill-dialog.tsx`), whose
 * install lands in the list at once. The list is read when the page is
 * drawn; each GitHub skill the account may change is then checked for an
 * update, once.
 */

/** The page's list as it stands: being read, refused, or read. */
const LIST = {
  READING: "reading",
  FAILED: "failed",
  READ: "read",
} as const;

type ListRead =
  | { readonly kind: typeof LIST.READING }
  | { readonly kind: typeof LIST.FAILED; readonly line: string }
  | { readonly kind: typeof LIST.READ; readonly skills: readonly InstalledSkillSummary[] };

const READING: ListRead = { kind: LIST.READING };

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A failed write as the confirm dialog or the row says it. */
function rejected(reason: string): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The line for a write that never reached the service. */
const UNANSWERED_LINE = failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED });

/** One installed skill's row: its words, Update available, its switch, and Remove in its ⋯. */
function SkillRowView({
  row,
  workspaceId,
  updateAvailable,
  onChanged,
  onRemoved,
}: {
  row: SkillRow;
  workspaceId: string;
  updateAvailable: boolean;
  onChanged: (skill: InstalledSkillSummary, updated: boolean) => void;
  onRemoved: (skillId: string) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const { skill } = row;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  /** A toggle or an update sent, its answer put in the list, or why it is unchanged under the row. */
  const write = (
    asked: Promise<{ readonly skill: InstalledSkillSummary } | InstalledSkillFailedView>,
    updated: boolean,
  ) => {
    setBusy(true);
    setError(undefined);
    void asked
      .catch(() => undefined)
      .then((answer) => {
        setBusy(false);
        if (answer === undefined) return setError(UNANSWERED_LINE);
        if ("failure" in answer) return setError(failureLine(answer));
        onChanged(answer.skill, updated);
      });
  };

  const removal = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    act(ACT_KIND.INSTALLED_SKILLS_REMOVE, { skillId: skill.id })
      .catch(() => undefined)
      .then((answer): ActionResult => {
        if (answer === undefined) return rejected(UNANSWERED_LINE);
        if ("failure" in answer) return rejected(failureLine(answer));
        onRemoved(skill.id);
        return ACCEPTED;
      }),
  );

  return (
    <>
      <MenuRow
        label={`${skill.name} actions`}
        actions={
          skill.manageable
            ? [{ label: "Remove", icon: <TrashIcon />, danger: true, onSelect: removal.ask }]
            : []
        }
        row={{
          label: skill.name,
          adornment: <Badge tone={BADGE_TONE.NEUTRAL}>{row.badge}</Badge>,
          description: `${skill.description} · ${row.line}`,
          error,
          control:
            updateAvailable && skill.manageable ? (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={busy}
                busyLabel="Updating"
                onClick={() =>
                  write(
                    act(ACT_KIND.INSTALLED_SKILLS_UPDATE, { workspaceId, skillId: skill.id }),
                    true,
                  )
                }
              >
                {SKILLS_LINE.UPDATE_AVAILABLE}
              </Button>
            ) : null,
          describedControl: (control) => (
            <Switch
              checked={skill.enabled}
              label={`Use ${skill.name}`}
              describedBy={control["aria-describedby"]}
              disabled={!skill.manageable || busy}
              onChange={(enabled) =>
                write(
                  act(ACT_KIND.INSTALLED_SKILLS_SET_ENABLED, { skillId: skill.id, enabled }),
                  false,
                )
              }
            />
          ),
        }}
      />
      <ConfirmDialog
        confirm={removal}
        question={{
          title: `Remove ${skill.name}?`,
          body: "Agents started afterwards no longer load it. Installing it again takes the paste again.",
          verb: "Remove",
          running: "Removing…",
        }}
      />
    </>
  );
}

/** The page over one workspace: its skills read, then each GitHub one checked for an update. */
function ShownSkills({
  workspace,
  readerId,
}: {
  workspace: Workspace;
  readerId: string | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const [list, setList] = useState<ListRead>(READING);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [updates, setUpdates] = useState<ReadonlyMap<string, boolean>>(new Map());
  const members = useWorkspaceMembersRead(workspace).members;

  useEffect(() => {
    let current = true;
    setList(READING);
    void act(ACT_KIND.INSTALLED_SKILLS_LIST, { workspaceId: workspace.id })
      .catch(() => undefined)
      .then((answer) => {
        if (!current) return;
        if (answer === undefined)
          return setList({ kind: LIST.FAILED, line: SKILLS_LINE.READ_FAILED });
        if ("failure" in answer) return setList({ kind: LIST.FAILED, line: failureLine(answer) });
        setList({ kind: LIST.READ, skills: answer.skills });
      });
    return () => {
      current = false;
    };
  }, [act, workspace.id, attempt]);

  // Note that each GitHub skill the account may change is asked once, whatever else the list does,
  // so an answer is kept even after a toggle redraws the list; React drops one landing after the page closes.
  const skills = list.kind === LIST.READ ? list.skills : undefined;
  const checked = useRef(new Set<string>());
  useEffect(() => {
    const unasked = (skills ?? []).filter(
      (each) =>
        each.manageable &&
        each.source.type === INSTALLED_SKILL_SOURCE.GITHUB &&
        !checked.current.has(each.id),
    );
    for (const skill of unasked) {
      checked.current.add(skill.id);
      void act(ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE, {
        workspaceId: workspace.id,
        skillId: skill.id,
      })
        .catch(() => undefined)
        .then((answer) => {
          const available = answer !== undefined && !("failure" in answer) && answer.available;
          setUpdates((held) => new Map(held).set(skill.id, available));
        });
    }
  }, [act, skills, workspace.id]);

  const changed = useCallback((skill: InstalledSkillSummary, updated: boolean) => {
    setList((held) =>
      held.kind === LIST.READ ? { kind: LIST.READ, skills: withSkill(held.skills, skill) } : held,
    );
    if (updated) setUpdates((held) => new Map(held).set(skill.id, false));
  }, []);
  const removed = useCallback((skillId: string) => {
    setList((held) =>
      held.kind === LIST.READ
        ? { kind: LIST.READ, skills: held.skills.filter((each) => each.id !== skillId) }
        : held,
    );
  }, []);
  const installed = useCallback((made: readonly InstalledSkillSummary[]) => {
    setList((held) =>
      held.kind === LIST.READ ? { kind: LIST.READ, skills: [...held.skills, ...made] } : held,
    );
  }, []);

  const groups = skills === undefined ? undefined : skillGroups(skills, readerId, members);
  const rows = (shown: readonly SkillRow[]) =>
    shown.length === 0 ? (
      <SettingsLine>{SKILLS_LINE.NONE}</SettingsLine>
    ) : (
      shown.map((row) => (
        <SkillRowView
          key={row.skill.id}
          row={row}
          workspaceId={workspace.id}
          updateAvailable={updates.get(row.skill.id) === true}
          onChanged={changed}
          onRemoved={removed}
        />
      ))
    );

  return (
    <>
      <SettingsSection>
        <SettingsRow label="Add a skill" description={SKILLS_LINE.ABOUT}>
          {() => (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<PlusIcon />}
              onClick={() => setAdding(true)}
            >
              Add skill
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
      {list.kind === LIST.FAILED ? (
        <SettingsSection>
          <SettingsLine>
            <ErrorState onRetry={() => setAttempt((count) => count + 1)}>{list.line}</ErrorState>
          </SettingsLine>
        </SettingsSection>
      ) : groups === undefined ? (
        <SettingsSection title={workspaceGroupTitle(workspace)}>
          <SettingsRowsSkeleton label="Loading your skills" />
        </SettingsSection>
      ) : (
        <>
          {workspace.personal === true ? null : (
            <SettingsSection title={workspaceGroupTitle(workspace)}>
              {rows(groups.workspace)}
            </SettingsSection>
          )}
          <SettingsSection title={SKILLS_LINE.PERSONAL}>{rows(groups.personal)}</SettingsSection>
        </>
      )}
      {adding ? (
        <AddSkillDialog
          workspace={workspace}
          onInstalled={installed}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}

/** Settings › Skills over the workspace the sidebar lists, or why there is none to show; signed in, as Settings draws it. */
export function SkillsPage({
  control,
  readerId,
}: {
  /** The account's workspaces, drawn while it is signed in. */
  control: WorkspaceSettingsControl | undefined;
  /** The signed-in account's id, whose own installs say you. */
  readerId: string | undefined;
}): React.JSX.Element | null {
  if (control === undefined) return null;
  const workspace = shownWorkspace(control);
  if (workspace === undefined) {
    return control.listFailed ? (
      <SettingsSection>
        <SettingsLine>
          <ErrorState onRetry={control.onRetryList}>Your workspaces could not be read.</ErrorState>
        </SettingsLine>
      </SettingsSection>
    ) : (
      <SettingsSectionsSkeleton label="Loading your skills" sections={[1, 2]} />
    );
  }
  // Keyed to the workspace, so another one listed reads its own skills and asks nothing left over.
  return <ShownSkills key={workspace.id} workspace={workspace} readerId={readerId} />;
}

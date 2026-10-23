import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@luke/features/installed-skill-route-wire";
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
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DocumentIcon,
  ErrorState,
  Fact,
  Facts,
  GAP,
  PlusIcon,
  SettingsLine,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
  SettingsSectionsSkeleton,
  SpinnerRegion,
  Stack,
  Switch,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TrashIcon,
  UpdateIcon,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { FolderInputIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { MarkdownMessage } from "../markdown-message.js";
import { useWorkspaceMembersRead } from "../tasks/use-workspace-members.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { AddSkillDialog } from "./add-skill-dialog.js";
import { MenuRow } from "./menu-row.js";
import { shownWorkspace } from "./settings-rows.js";
import {
  failureLine,
  fencedSkillFile,
  installedNotice,
  SKILL_ACTION,
  SKILLS_LINE,
  type SkillAction,
  type SkillRow,
  shareFailureLine,
  shareQuestion,
  sizeText,
  skillActions,
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
 * installed it; at its end its switch and a ⋯ (`skillActions`): View, which
 * opens its `SKILL.md` and its files over the window; Share with workspace,
 * for the account's own skill outside a personal workspace, which asks
 * first because it moves the skill; Update, where a GitHub skill's folder
 * moved at its ref; and Remove, which asks first. A row the account may not
 * change, a teammate's workspace skill to a member who is not an owner or
 * admin, as the service says by `manageable`, draws its switch unavailable
 * and View alone in its ⋯. A line at the top says where repository skills
 * come from and that a change reaches only agents started afterwards, which
 * nothing else on the page can say. Add skill opens the dialog
 * (`add-skill-dialog.tsx`), whose install lands in the list at once, its
 * rows lit once and a toast naming them and how to call the first one a
 * member can call (`installedNotice`). The list is read when the page is
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

const READING = { kind: LIST.READING } as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A failed write as the confirm dialog or the row says it. */
function rejected(reason: string): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The line for a write that never reached the service. */
const UNANSWERED_LINE = failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED });

/** The glyph each of a row's acts leads with. */
const ACTION_ICON = {
  [SKILL_ACTION.VIEW]: <DocumentIcon />,
  [SKILL_ACTION.SHARE]: <FolderInputIcon />,
  [SKILL_ACTION.UPDATE]: <UpdateIcon />,
  [SKILL_ACTION.REMOVE]: <TrashIcon />,
} as const satisfies Record<SkillAction, React.JSX.Element>;

/** The words each of a row's acts says. */
const ACTION_LABEL = {
  [SKILL_ACTION.VIEW]: SKILLS_LINE.VIEW,
  [SKILL_ACTION.SHARE]: SKILLS_LINE.SHARE,
  [SKILL_ACTION.UPDATE]: SKILLS_LINE.UPDATE,
  [SKILL_ACTION.REMOVE]: SKILLS_LINE.REMOVE,
} as const satisfies Record<SkillAction, string>;

/** One skill read whole for View: being read, refused, or read. */
type ContentRead =
  | { readonly kind: typeof LIST.READING }
  | { readonly kind: typeof LIST.FAILED; readonly line: string }
  | { readonly kind: typeof LIST.READ; readonly content: InstalledSkillContent };

/** View: a skill's `SKILL.md` drawn as written, and every file it carries with its size. */
function SkillFileDialog({
  skill,
  onClose,
}: {
  skill: InstalledSkillSummary;
  onClose: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [read, setRead] = useState<ContentRead>(READING);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setRead(READING);
    void act(ACT_KIND.INSTALLED_SKILLS_READ, { skillId: skill.id })
      .catch(() => undefined)
      .then((answer) => {
        if (!current) return;
        if (answer === undefined)
          return setRead({ kind: LIST.FAILED, line: SKILLS_LINE.VIEW_FAILED });
        if ("failure" in answer) return setRead({ kind: LIST.FAILED, line: failureLine(answer) });
        setRead({ kind: LIST.READ, content: answer });
      });
    return () => {
      current = false;
    };
  }, [act, skill.id, attempt]);

  return (
    <Dialog
      title={skill.name}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actions={
        <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
          Close
        </Button>
      }
    >
      {read.kind === LIST.READING ? (
        <SpinnerRegion label={`Reading ${skill.name}`} delay />
      ) : read.kind === LIST.FAILED ? (
        <ErrorState onRetry={() => setAttempt((count) => count + 1)}>{read.line}</ErrorState>
      ) : (
        <Stack gap={GAP.FIELD}>
          <MarkdownMessage words={fencedSkillFile(read.content.skillFile)} />
          <Stack gap={GAP.ITEM}>
            <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.H3}>
              {SKILLS_LINE.FILES}
            </Text>
            <Facts>
              {read.content.files.map((file) => (
                <Fact key={file.path} label={file.path}>
                  {sizeText(file.bytes)}
                </Fact>
              ))}
            </Facts>
          </Stack>
        </Stack>
      )}
    </Dialog>
  );
}

/** One installed skill's row: its words, its switch, and its ⋯ with View, Share with workspace, Update, and Remove. */
function SkillRowView({
  row,
  workspace,
  updateAvailable,
  landed,
  onChanged,
  onRemoved,
}: {
  row: SkillRow;
  workspace: Workspace;
  updateAvailable: boolean;
  landed: boolean;
  onChanged: (skill: InstalledSkillSummary, updated: boolean) => void;
  onRemoved: (skillId: string) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const { skill } = row;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState(false);

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

  // Note that a share moves the skill, so the row the answer lands is the
  // workspace's, and the list draws it there; a name the workspace already
  // holds stays in the question, said for that workspace.
  const sharing = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    act(ACT_KIND.INSTALLED_SKILLS_SHARE, { workspaceId: workspace.id, skillId: skill.id })
      .catch(() => undefined)
      .then((answer): ActionResult => {
        if (answer === undefined) return rejected(UNANSWERED_LINE);
        if ("failure" in answer) return rejected(shareFailureLine(answer, skill.name, workspace));
        onChanged(answer.skill, false);
        return ACCEPTED;
      }),
  );

  const press = {
    [SKILL_ACTION.VIEW]: () => setViewing(true),
    [SKILL_ACTION.SHARE]: sharing.ask,
    [SKILL_ACTION.UPDATE]: () =>
      write(
        act(ACT_KIND.INSTALLED_SKILLS_UPDATE, { workspaceId: workspace.id, skillId: skill.id }),
        true,
      ),
    [SKILL_ACTION.REMOVE]: removal.ask,
  } as const satisfies Record<SkillAction, () => void>;
  const actions = skillActions(row, { workspace, updateAvailable }).map((group) =>
    group.map((each) => ({
      label: ACTION_LABEL[each],
      icon: ACTION_ICON[each],
      ...(each === SKILL_ACTION.REMOVE ? { danger: true } : undefined),
      ...(each === SKILL_ACTION.UPDATE && busy ? { disabled: true } : undefined),
      onSelect: press[each],
    })),
  );

  return (
    <>
      <MenuRow
        label={`${skill.name} actions`}
        actions={actions}
        row={{
          label: skill.name,
          adornment: <Badge tone={BADGE_TONE.NEUTRAL}>{row.badge}</Badge>,
          description: `${skill.description} · ${row.line}`,
          error,
          landed,
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
      <ConfirmDialog
        confirm={sharing}
        question={{ ...shareQuestion(skill.name, workspace), tone: DIALOG_TONE.PRIMARY }}
      />
      {viewing ? <SkillFileDialog skill={skill} onClose={() => setViewing(false)} /> : null}
    </>
  );
}

/** The page over one workspace: its skills read, then each GitHub one checked for an update. */
function ShownSkills({
  workspace,
  readerId,
  pause,
}: {
  workspace: Workspace;
  readerId: string | undefined;
  pause: ((ms: number) => Promise<void>) | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const [list, setList] = useState<ListRead>(READING);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [updates, setUpdates] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());
  const toast = useToast();
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
  // Note that an install lights only its own rows, each once, and says how
  // to call what it made, since the dialog that made them has closed.
  const installed = useCallback(
    (made: readonly InstalledSkillSummary[]) => {
      setList((held) =>
        held.kind === LIST.READ ? { kind: LIST.READ, skills: [...held.skills, ...made] } : held,
      );
      setLanded(new Set(made.map((each) => each.id)));
      const notice = installedNotice(made, workspace);
      if (notice !== undefined) toast({ ...notice, tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
    },
    [toast, workspace],
  );

  const groups = skills === undefined ? undefined : skillGroups(skills, readerId, members);
  const rows = (shown: readonly SkillRow[]) =>
    shown.length === 0 ? (
      <SettingsLine>{SKILLS_LINE.NONE}</SettingsLine>
    ) : (
      shown.map((row) => (
        <SkillRowView
          key={row.skill.id}
          row={row}
          workspace={workspace}
          updateAvailable={updates.get(row.skill.id) === true}
          landed={landed.has(row.skill.id)}
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
          {...(pause === undefined ? undefined : { pause })}
        />
      ) : null}
    </>
  );
}

/** Settings › Skills over the workspace the sidebar lists, or why there is none to show; signed in, as Settings draws it. */
export function SkillsPage({
  control,
  readerId,
  pause,
}: {
  /** The account's workspaces, drawn while it is signed in. */
  control: WorkspaceSettingsControl | undefined;
  /** The signed-in account's id, whose own installs say you. */
  readerId: string | undefined;
  /** The Add skill dialog's wait before a preview, the renderer's own where none is handed in. */
  pause?: (ms: number) => Promise<void>;
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
  return <ShownSkills key={workspace.id} workspace={workspace} readerId={readerId} pause={pause} />;
}

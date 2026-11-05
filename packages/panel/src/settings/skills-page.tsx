import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillFailedView,
} from "@repo/features/installed-skill-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { formatBytes } from "@repo/features/number-format";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  ErrorState,
  Fact,
  Facts,
  GAP,
  PlusIcon,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  SpinnerRegion,
  Stack,
  Switch,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  TrashIcon,
  UpdateIcon,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { SkillOption } from "@repo/ui/skill-mention";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import { MarkdownMessage } from "../markdown-message.js";
import { SkillCard, SkillMark } from "../tasks/skill-ref.js";
import { useDrawnThroughExit } from "../use-held-through-exit.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { AddSkillDialog } from "./add-skill-dialog.js";
import { MenuRow } from "./menu-row.js";
import { shownWorkspace } from "./settings-rows.js";
import {
  failureLine,
  fencedSkillFile,
  removeQuestion,
  SKILL_ACTION,
  SKILLS_LINE,
  type SkillAction,
  type SkillRow,
  shareFailureLine,
  shareQuestion,
  skillActions,
  skillGroups,
  workspaceGroupTitle,
} from "./skills-model.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

/**
 * skills-page.tsx -- Settings › Skills: the skills the account installs into the app for its agents, the listed workspace's and its own, and Add skill.
 *
 * The page lists the workspace the sidebar lists, its skills first under
 * its name, then the account's own under Personal, as the Automations list
 * groups (`skills-model.ts`). Each row leads with the book every skill leads
 * with (`skill-ref.tsx`) and is the skill's name and under it its
 * description, where its files came from, and who installed it, and it
 * hangs the skill's card beside it; at its end its scope's badge, its
 * switch and a ⋯ (`skillActions`): View, which
 * opens its `SKILL.md` and its files over the window; Share with workspace,
 * for the account's own skill outside a personal workspace, which asks
 * first because it moves the skill; Update, for a GitHub skill; and
 * Remove, which asks first. A row the account may not
 * change, a teammate's workspace skill to a member who is not an owner or
 * admin, as the service says by `manageable`, draws its switch unavailable
 * and View alone in its ⋯. A line at the top says where repository skills
 * come from and that a change reaches only agents started afterwards, which
 * nothing else on the page can say. Add skill opens the dialog
 * (`add-skill-dialog.tsx`), whose install lands in the list as it answers,
 * its rows lit once. The page draws the skills as the host holds them,
 * followed live on the service (`LIVE_READ.INSTALLED_SKILLS`), so one a
 * teammate installs or toggles draws while the page is open, and the host
 * draws each toggle, share, and removal the moment it is asked and an
 * update as it answers; a row says only why one was refused.
 */

/** An installed skill's row while the skills are read: its book, its words over its source, its switch, and its ⋯. */
const SKILL_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: true,
  controls: [SETTINGS_SKELETON_CONTROL.SWITCH, SETTINGS_SKELETON_CONTROL.MORE],
  mark: SETTINGS_ROW_MARK_WIDTH,
};

/** A group of skills while it is read, one row standing for however many land. */
const SKILL_GROUP_SKELETON: SettingsSectionSkeletonShape = {
  headed: true,
  rows: [SKILL_ROW_SKELETON],
};

/**
 * The page before the workspaces are read: Add a skill, unheaded, then the
 * workspace's group and the reader's own, since whether the workspace is a
 * personal one, which draws no group of its own, is not yet known.
 */
const SKILLS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  { headed: false, rows: [{ described: false, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] }] },
  SKILL_GROUP_SKELETON,
  SKILL_GROUP_SKELETON,
];

/** A skill's files as View reads them: being read, refused, or read. */
const LIST = {
  READING: "reading",
  FAILED: "failed",
  READ: "read",
} as const;

const READING = { kind: LIST.READING } as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A failed write as the confirm dialog or the row says it. */
function rejected(reason: string): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** How a skill's questions read in a screen recording: their verbs show, and their titles and bodies, which name the skill or the workspace, stay masked. */
const SKILL_NAMED_IN_REPLAY = {
  replayUnmasked: true,
  titleReplayMasked: true,
  bodyReplayMasked: true,
} as const;

/** The line for a write that never reached the service. */
const UNANSWERED_LINE = failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED });

/** The glyph each of a row's acts leads with. */
const ACTION_ICON = {
  [SKILL_ACTION.VIEW]: <GLYPH.PLAN />,
  [SKILL_ACTION.SHARE]: <GLYPH.MOVE />,
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
  open,
  skill,
  onClose,
  onExited,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. */
  open: boolean;
  skill: InstalledSkillSummary;
  onClose: () => void;
  onExited: () => void;
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
      open={open}
      title={skill.name}
      size={DIALOG_SIZE.WIDE}
      replayUnmasked
      titleReplayMasked
      onDismiss={onClose}
      onExited={onExited}
      actions={<DialogActions onDone={onClose} />}
    >
      {read.kind === LIST.READING ? (
        <ReplayMask>
          <SpinnerRegion label={`Reading ${skill.name}`} delay />
        </ReplayMask>
      ) : read.kind === LIST.FAILED ? (
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.SKILL_READ)}
          onRetry={() => setAttempt((count) => count + 1)}
        >
          <ReplayMask>{read.line}</ReplayMask>
        </ErrorState>
      ) : (
        <Stack gap={GAP.FIELD}>
          <ReplayMask>
            <MarkdownMessage words={fencedSkillFile(read.content.skillFile)} />
          </ReplayMask>
          <Stack gap={GAP.ITEM}>
            <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H3}>
              {SKILLS_LINE.FILES}
            </Text>
            <Facts>
              {read.content.files.map((file) => (
                <Fact
                  key={file.path}
                  label={
                    <Text
                      as={TEXT_ELEMENT.SPAN}
                      variant={TEXT_VARIANT.INHERIT}
                      font={TEXT_FONT.MONO}
                    >
                      <ReplayMask>{file.path}</ReplayMask>
                    </Text>
                  }
                >
                  {formatBytes(file.bytes)}
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
  landed,
}: {
  row: SkillRow;
  workspace: Workspace;
  landed: boolean;
}): React.JSX.Element {
  const { act } = useAct();
  const { skill } = row;
  // Note that an installed skill names no file of a repository's, so its card says where it comes from and what it is for alone.
  const cardSkill: SkillOption = {
    name: skill.name,
    description: skill.description,
    source: row.source,
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState(false);
  // Note that the card reads the skill while it is drawn, from its opening until its fade has run, so each View reads afresh.
  const viewed = useDrawnThroughExit(viewing);

  /** A toggle or an update sent, which the host draws in the list, or why it is unchanged under the row. */
  const write = (
    asked: Promise<{ readonly skill: InstalledSkillSummary } | InstalledSkillFailedView>,
  ) => {
    setBusy(true);
    setError(undefined);
    void asked
      .catch(() => undefined)
      .then((answer) => {
        setBusy(false);
        if (answer === undefined) return setError(UNANSWERED_LINE);
        if ("failure" in answer) setError(failureLine(answer));
      });
  };

  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    () =>
      act(ACT_KIND.INSTALLED_SKILLS_REMOVE, { skillId: skill.id })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined) return rejected(UNANSWERED_LINE);
          if ("failure" in answer) return rejected(failureLine(answer));
          return ACCEPTED;
        }),
    confirmFailure(FAILURE_SURFACE.SKILL_REMOVE),
  );

  // Note that a share moves the skill, so the host draws it the workspace's
  // the moment it is asked; a name the workspace already holds stays in the
  // question, said for that workspace.
  const sharing = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    () =>
      act(ACT_KIND.INSTALLED_SKILLS_SHARE, { workspaceId: workspace.id, skillId: skill.id })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined) return rejected(UNANSWERED_LINE);
          if ("failure" in answer) return rejected(shareFailureLine(answer, skill.name, workspace));
          return ACCEPTED;
        }),
    confirmFailure(FAILURE_SURFACE.SKILL_SHARE, { workspaceId: workspace.id }),
  );

  const press = {
    [SKILL_ACTION.VIEW]: () => setViewing(true),
    [SKILL_ACTION.SHARE]: sharing.ask,
    [SKILL_ACTION.UPDATE]: () =>
      write(
        act(ACT_KIND.INSTALLED_SKILLS_UPDATE, { workspaceId: workspace.id, skillId: skill.id }),
      ),
    [SKILL_ACTION.REMOVE]: removal.ask,
  } as const satisfies Record<SkillAction, () => void>;
  const actions = skillActions(row, workspace).map((group) =>
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
      {/* Note that the card hangs from the row's own box, which the settings row draws no hint of, as the chip's card hangs from its pill. */}
      <Tooltip
        label={skill.name}
        card={<SkillCard subject={{ skill: cardSkill, onOpen: () => undefined }} />}
        cardBeside
      >
        <div>
          <MenuRow
            thing={skill.name}
            actions={actions}
            row={{
              leading: (
                <SettingsRowMark>
                  <SkillMark />
                </SettingsRowMark>
              ),
              label: <ReplayMask>{skill.name}</ReplayMask>,
              // Note that the source line stands under the description as the row's detail, never run onto its end.
              description: (
                <>
                  <ReplayMask>{skill.description}</ReplayMask>
                  <SettingsRowStateLine block>
                    <ReplayMask>{row.line}</ReplayMask>
                  </SettingsRowStateLine>
                </>
              ),
              error: refusedShown(error, FAILURE_SURFACE.SKILL_WRITE),
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
                    )
                  }
                />
              ),
            }}
          />
        </div>
      </Tooltip>
      <ConfirmDialog
        open
        confirm={removal}
        question={{ ...removeQuestion(skill, workspace), ...SKILL_NAMED_IN_REPLAY }}
      />
      <ConfirmDialog
        open
        confirm={sharing}
        question={{
          ...shareQuestion(skill.name, workspace),
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          ...SKILL_NAMED_IN_REPLAY,
        }}
      />
      {viewed.drawn ? (
        <SkillFileDialog
          open={viewing}
          skill={skill}
          onClose={() => setViewing(false)}
          onExited={viewed.onExited}
        />
      ) : null}
    </>
  );
}

/** The page over one workspace: its skills as the host holds them. */
function ShownSkills({
  workspace,
  readerId,
  pause,
}: {
  workspace: Workspace;
  readerId: string | undefined;
  pause: ((ms: number) => Promise<void>) | undefined;
}): React.JSX.Element {
  // The skills as the host holds them, followed live while the page shows them, so one a teammate installs meanwhile draws as it lands.
  const held = useHostRead(LIVE_READ.INSTALLED_SKILLS, workspace.id);
  const [adding, setAdding] = useState(false);
  // Note that the card keeps what is typed and previewed while it is drawn, from its opening until its fade has run, so each opening starts afresh.
  const added = useDrawnThroughExit(adding);
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());
  const members = useHostRead(LIVE_READ.WORKSPACE_MEMBERS, workspace.id).rows?.members;

  const skills = held.rows;
  // Note that an install lights only its own rows, each once, which say what it made; the host draws them.
  const installed = useCallback((made: readonly InstalledSkillSummary[]) => {
    setLanded(new Set(made.map((each) => each.id)));
  }, []);

  const groups = skills === undefined ? undefined : skillGroups(skills, readerId, members);
  // A group still being read stands its placeholder row in the card the rows will.
  const rows = (shown: readonly SkillRow[] | undefined, none: string = SKILLS_LINE.NONE) =>
    shown === undefined ? (
      <SettingsRowsSkeleton label={readingWords("your skills")} rows={SKILL_GROUP_SKELETON.rows} />
    ) : shown.length === 0 ? (
      <SettingsLine>{none}</SettingsLine>
    ) : (
      shown.map((row) => (
        <SkillRowView
          key={row.skill.id}
          row={row}
          workspace={workspace}
          landed={landed.has(row.skill.id)}
        />
      ))
    );

  return (
    <>
      <SettingsSection anchor={SETTINGS_SEARCH_ROW.ADD_SKILL}>
        <SettingsRow label="Add a skill">
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
      {skills === undefined && held.status === HOST_READ_STATUS.FAILED ? (
        <SettingsSection>
          <SettingsLine>
            <ErrorState failure={unreadShown(FAILURE_SURFACE.SKILLS_READ)} onRetry={held.retry}>
              {SKILLS_LINE.READ_FAILED}
            </ErrorState>
          </SettingsLine>
        </SettingsSection>
      ) : (
        <>
          {workspace.personal === true ? null : (
            <SettingsSection title={<ReplayMask>{workspaceGroupTitle(workspace)}</ReplayMask>}>
              {rows(groups?.workspace)}
            </SettingsSection>
          )}
          <SettingsSection title={SKILLS_LINE.PERSONAL}>{rows(groups?.personal)}</SettingsSection>
        </>
      )}
      {added.drawn ? (
        <AddSkillDialog
          open={adding}
          workspace={workspace}
          onInstalled={installed}
          onClose={() => setAdding(false)}
          onExited={added.onExited}
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
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.WORKSPACES_READ)}
            onRetry={control.onRetryList}
          >
            Your workspaces could not be read.
          </ErrorState>
        </SettingsLine>
      </SettingsSection>
    ) : (
      <SettingsSectionsSkeleton label={readingWords("your skills")} sections={SKILLS_SKELETON} />
    );
  }
  // Keyed to the workspace, so another one listed reads its own skills and asks nothing left over.
  return <ShownSkills key={workspace.id} workspace={workspace} readerId={readerId} pause={pause} />;
}

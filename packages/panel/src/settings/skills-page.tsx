import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { formatBytes } from "@repo/features/number-format";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
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
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { SkillOption } from "@repo/ui/skill-mention";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { queryOptions, type UseQueryResult, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { type ActResult, askAct } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import {
  installedSkillsQuery,
  installedSkillsRetryMutation,
  workspaceMembersQuery,
} from "../live-reads.js";
import { MarkdownMessage } from "../markdown-message.js";
import { QUERY_ROOT } from "../query-keys.js";
import { SkillCard, SkillMark } from "../tasks/skill-ref.js";
import { useDrawnThroughExit } from "../use-held-through-exit.js";
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
  skillActions,
  skillGroups,
  workspaceGroupTitle,
} from "./skills-model.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

const SKILL_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: true,
  controls: [SETTINGS_SKELETON_CONTROL.MORE],
  mark: SETTINGS_ROW_MARK_WIDTH,
};

const SKILL_GROUP_SKELETON: SettingsSectionSkeletonShape = {
  headed: true,
  rows: [SKILL_ROW_SKELETON],
};

const SKILLS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  { headed: false, rows: [{ described: false, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] }] },
  SKILL_GROUP_SKELETON,
  SKILL_GROUP_SKELETON,
];

const LIST = {
  READING: "reading",
  FAILED: "failed",
  READ: "read",
} as const;

const READING = { kind: LIST.READING } as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

function rejected(reason: string): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

const SKILL_NAMED_IN_REPLAY = {
  replayUnmasked: true,
  titleReplayMasked: true,
  bodyReplayMasked: true,
} as const;

const UNANSWERED_LINE = failureLine({ failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED });

const ACTION_ICON = {
  [SKILL_ACTION.VIEW]: <GLYPH.DESCRIPTION />,
  [SKILL_ACTION.REMOVE]: <TrashIcon />,
} as const satisfies Record<SkillAction, React.JSX.Element>;

const ACTION_LABEL = {
  [SKILL_ACTION.VIEW]: SKILLS_LINE.VIEW,
  [SKILL_ACTION.REMOVE]: SKILLS_LINE.REMOVE,
} as const satisfies Record<SkillAction, string>;

type ContentRead =
  | { readonly kind: typeof LIST.READING }
  | { readonly kind: typeof LIST.FAILED; readonly line: string }
  | { readonly kind: typeof LIST.READ; readonly content: InstalledSkillContent };

function installedSkillQueryOptions(skillId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.INSTALLED_SKILL, skillId],
    queryFn: () => askAct(ACT_KIND.INSTALLED_SKILLS_READ, { skillId }),
    retry: false,
  });
}

function contentRead(
  content: UseQueryResult<ActResult<typeof ACT_KIND.INSTALLED_SKILLS_READ>>,
): ContentRead {
  if (content.isPending || (content.isFetching && (content.isError || "failure" in content.data))) {
    return READING;
  }
  if (content.isError) return { kind: LIST.FAILED, line: SKILLS_LINE.VIEW_FAILED };
  if ("failure" in content.data) return { kind: LIST.FAILED, line: failureLine(content.data) };
  return { kind: LIST.READ, content: content.data };
}

function SkillFileDialog({
  open,
  skill,
  onClose,
  onExited,
}: {
  open: boolean;
  skill: InstalledSkillSummary;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const content = useQuery(installedSkillQueryOptions(skill.id));
  const read = contentRead(content);

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
          onRetry={() => void content.refetch()}
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

function SkillRowView({
  row,
  workspace,
  landed,
}: {
  row: SkillRow;
  workspace: Workspace;
  landed: boolean;
}): React.JSX.Element {
  const { mutateAsync: sendInstalledSkillsRemove, ...removing } = useMutation(
    actMutation(ACT_KIND.INSTALLED_SKILLS_REMOVE),
  );
  const { skill } = row;
  const cardSkill: SkillOption = {
    name: skill.name,
    description: skill.description,
    source: row.source,
  };
  const [viewing, setViewing] = useState(false);
  const viewed = useDrawnThroughExit(viewing);

  const removalAct = useConfirmAct(removing, {
    send: () => sendInstalledSkillsRemove({ skillId: skill.id }),
    answered: (answer): ActionResult =>
      "failure" in answer ? rejected(failureLine(answer)) : ACCEPTED,
    failed: () => rejected(UNANSWERED_LINE),
  });
  const removal = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.SKILL_REMOVE),
  );

  const press = {
    [SKILL_ACTION.VIEW]: () => setViewing(true),
    [SKILL_ACTION.REMOVE]: removal.ask,
  } as const satisfies Record<SkillAction, () => void>;
  const actions = skillActions(row).map((group) =>
    group.map((each) => ({
      label: ACTION_LABEL[each],
      icon: ACTION_ICON[each],
      ...(each === SKILL_ACTION.REMOVE ? { danger: true } : undefined),
      onSelect: press[each],
    })),
  );

  return (
    <>
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
              description: (
                <>
                  <ReplayMask>{skill.description}</ReplayMask>
                  <SettingsRowStateLine block>
                    <ReplayMask>{row.line}</ReplayMask>
                  </SettingsRowStateLine>
                </>
              ),
              landed,
            }}
          />
        </div>
      </Tooltip>
      <ConfirmDialog
        open
        confirm={removal}
        question={{ ...removeQuestion(skill, workspace), ...SKILL_NAMED_IN_REPLAY }}
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

function ShownSkills({
  workspace,
  readerId,
  pause,
}: {
  workspace: Workspace;
  readerId: string | undefined;
  pause: ((ms: number) => Promise<void>) | undefined;
}): React.JSX.Element {
  const held = useQuery(installedSkillsQuery(workspace.id));
  const retry = useMutation(installedSkillsRetryMutation());
  const [adding, setAdding] = useState(false);
  const added = useDrawnThroughExit(adding);
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());
  const members = useQuery(workspaceMembersQuery(workspace.id)).data?.members;

  const skills = held.data;
  const installed = useCallback((made: readonly InstalledSkillSummary[]) => {
    setLanded(new Set(made.map((each) => each.id)));
  }, []);

  const groups = skills === undefined ? undefined : skillGroups(skills, readerId, members);
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
      {skills === undefined && held.isError ? (
        <SettingsSection>
          <SettingsLine>
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.SKILLS_READ)}
              onRetry={() => retry.mutate({ workspaceId: workspace.id })}
            >
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

export function SkillsPage({
  control,
  readerId,
  pause,
}: {
  control: WorkspaceSettingsControl | undefined;
  readerId: string | undefined;
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
  return <ShownSkills key={workspace.id} workspace={workspace} readerId={readerId} pause={pause} />;
}

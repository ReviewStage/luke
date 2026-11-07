import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorState,
  FormField,
  PlusIcon,
  SETTINGS_SKELETON_CONTROL,
  SecretField,
  SettingsLine,
  SettingsRow,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  Stack,
  TextField,
  TrashIcon,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { useConfirmAct } from "../confirm-act.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { shownWorkspace } from "./settings-rows.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

/**
 * environment-page.tsx -- Settings › Environment: the variables the workspace hands its members' cloud agents, added, replaced, and deleted by its owners and admins.
 *
 * The page reads the variables' names as Skills reads its skills, one row
 * each, and never a value, which the service hands back to no one. An
 * owner or admin adds one from the first section, and replaces or deletes
 * one from its row's ⋯, a delete asking first; a member sees the names
 * alone. Each write answers the names as they then stand, which the page
 * draws at once. A value is typed into a `SecretField`, kept out of the
 * screen recording as GitHub's token is.
 */

/** Keeps what a secret field holds out of the screen recording. */
const NO_CAPTURE = "ph-no-capture";

/** A variable's row while the names are read. */
const VARIABLE_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: false,
  controls: [SETTINGS_SKELETON_CONTROL.MORE],
};

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

function rejected(error: unknown): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(error) };
}

/** The workspace's variables by name, read as the page opens and on Try again. */
function environmentQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_ENVIRONMENT, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_ENVIRONMENT_LIST, { workspaceId }),
    retry: false,
  });
}

/** A put, its answer drawn over the list at once. */
function usePutVariable(workspaceId: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (variable: { name: string; value: string }) =>
      sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_PUT, { workspaceId, ...variable }),
    onSuccess: (answer) => queries.setQueryData(environmentQuery(workspaceId).queryKey, answer),
  });
}

/**
 * Add's card, or a variable's Replace value where `name` is given: a name and
 * a value, or the value alone under the name it replaces.
 */
function useVariableDialog(workspaceId: string, name?: string) {
  const [typedName, setTypedName] = useState("");
  const [value, setValue] = useState("");
  const putting = usePutVariable(workspaceId);
  const shownName = name ?? typedName.trim();
  const act = useConfirmAct(putting, {
    send: () => putting.mutateAsync({ name: shownName, value }),
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_SAVE),
  );
  const form = useFormDialog(confirm, shownName !== "" && value !== "");
  const dialog = (
    <Dialog
      open={form.open}
      title={name === undefined ? "Add variable" : `Replace ${name}`}
      replayUnmasked
      titleReplayMasked={name !== undefined}
      busy={form.settling}
      refused={form.refusal !== undefined}
      onDismiss={form.dismiss}
      onExited={() => {
        setTypedName("");
        setValue("");
      }}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{ verb: "Save", tone: DIALOG_TONE.PRIMARY, running: "Saving", ...form.act }}
        />
      }
    >
      <Stack>
        {name === undefined ? (
          <FormField label="Name">
            {(control) => (
              <ReplayMask>
                <TextField
                  field={control}
                  autoCorrect={false}
                  spellCheck={false}
                  placeholder="API_TOKEN"
                  disabled={form.settling}
                  value={typedName}
                  onChange={setTypedName}
                  onEnter={form.submit}
                />
              </ReplayMask>
            )}
          </FormField>
        ) : null}
        <div className={NO_CAPTURE}>
          <SecretField
            label="Value"
            saved={name !== undefined}
            error={replayMaskedError(form.refusal)}
            disabled={form.settling}
            value={value}
            onChange={setValue}
            onEnter={form.submit}
          />
        </div>
      </Stack>
    </Dialog>
  );
  return { ask: confirm.ask, dialog };
}

/** One variable's row: its name, and for an owner or admin a ⋯ with Replace value and Delete. */
function VariableRow({
  workspaceId,
  name,
  manages,
}: {
  workspaceId: string;
  name: string;
  manages: boolean;
}): React.JSX.Element {
  const queries = useQueryClient();
  const replace = useVariableDialog(workspaceId, name);
  const deleting = useMutation({
    mutationFn: () => sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_DELETE, { workspaceId, name }),
    onSuccess: (answer) => queries.setQueryData(environmentQuery(workspaceId).queryKey, answer),
  });
  const deleteAct = useConfirmAct(deleting, {
    send: () => deleting.mutateAsync(),
    answered: () => ACCEPTED,
    failed: rejected,
  });
  const deletion = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    deleteAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_DELETE),
  );
  const actions = manages
    ? [
        { label: "Replace value", icon: <GLYPH.RENAME />, onSelect: replace.ask },
        { label: "Delete", icon: <TrashIcon />, danger: true, onSelect: deletion.ask },
      ]
    : [];
  return (
    <>
      <MenuRow thing={name} actions={actions} row={{ label: <ReplayMask>{name}</ReplayMask> }} />
      {manages ? (
        <>
          {replace.dialog}
          <ConfirmDialog
            open
            confirm={deletion}
            question={{
              title: `Delete ${name}?`,
              verb: "Delete",
              running: "Deleting",
              loss: CONFIRM_LOSS.AFFECTS_OTHERS,
              replayUnmasked: true,
              titleReplayMasked: true,
            }}
          />
        </>
      ) : null}
    </>
  );
}

/** The page over one workspace: Add a variable for an owner or admin, then its variables. */
function ShownEnvironment({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  const environment = useQuery(environmentQuery(workspace.id));
  const add = useVariableDialog(workspace.id);
  const variables = environment.data?.variables;
  return (
    <>
      {manages ? (
        <SettingsSection>
          <SettingsRow label="Add a variable">
            {() => (
              <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />} onClick={add.ask}>
                Add variable
              </Button>
            )}
          </SettingsRow>
        </SettingsSection>
      ) : null}
      <SettingsSection title="Variables">
        {environment.isError ? (
          <SettingsLine>
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.WORKSPACE_ENVIRONMENT_READ)}
              onRetry={() => void environment.refetch()}
            >
              The variables could not be read.
            </ErrorState>
          </SettingsLine>
        ) : variables === undefined ? (
          <SettingsRowsSkeleton
            label={readingWords("the variables")}
            rows={[VARIABLE_ROW_SKELETON]}
          />
        ) : variables.length === 0 ? (
          <SettingsLine>No variables yet.</SettingsLine>
        ) : (
          variables.map((variable) => (
            <VariableRow
              key={variable.name}
              workspaceId={workspace.id}
              name={variable.name}
              manages={manages}
            />
          ))
        )}
      </SettingsSection>
      {manages ? add.dialog : null}
    </>
  );
}

/** Settings › Environment over the workspace the sidebar lists, or why there is none to show; signed in, as Settings draws it. */
export function EnvironmentPage({
  control,
}: {
  /** The account's workspaces, drawn while it is signed in. */
  control: WorkspaceSettingsControl | undefined;
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
      <SettingsRowsSkeleton label={readingWords("the variables")} rows={[VARIABLE_ROW_SKELETON]} />
    );
  }
  // Keyed to the workspace, so another one listed reads its own variables and asks nothing left over.
  return <ShownEnvironment key={workspace.id} workspace={workspace} />;
}

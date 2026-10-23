import {
  environmentNameAllowed,
  WORKSPACE_ENVIRONMENT_BOUNDS,
  WORKSPACE_ENVIRONMENT_KIND,
  WORKSPACE_ENVIRONMENT_REJECTION,
  type WorkspaceEnvironmentEntry,
  type WorkspaceEnvironmentKind,
} from "@luke/features/workspace-environment-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import {
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  ErrorState,
  FormField,
  GAP,
  PencilIcon,
  PlusIcon,
  SETTINGS_ROW_STATE,
  SettingsFacts,
  SettingsLine,
  SettingsRow,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  Stack,
  TEXT_ELEMENT,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_FONT,
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
  TrashIcon,
  useConfirmDialog,
} from "@luke/ui";
import { dayText } from "@luke/ui/time-format";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { MenuRow } from "./menu-row.js";

/**
 * environment-section.tsx -- Settings › Workspace › Environment: the variables and secrets every coding agent of the workspace runs its commands with.
 *
 * One row per name, its name in the code face: a variable with its value,
 * a secret by the hint the service answers (its last characters) alone,
 * each with when it was last saved. An owner or admin adds one with Add
 * variable, and edits or removes one behind its row's ⋯; a member reads
 * the list alone. Adding and editing open one dialog, as Add skill does: the
 * name (a new entry's alone, since an edited one's is its title), Variable
 * or Secret, and the value in a text area that keeps a certificate's line
 * breaks, a secret's drawn as discs. A secret's value stands in the dialog
 * alone, is sent once on Save, and is gone with the dialog once the service
 * keeps it; editing a secret starts from an empty value, since the page
 * never holds one. A name or value the service would refuse is refused in
 * the dialog, saying why under the value, and sends nothing. One change
 * runs at a time, since every answer is the list whole. Remove asks first.
 * The section and the dialog are kept out of the screen recording.
 */

const PAGE_LINE = {
  INTRO:
    "Coding agents in this workspace run every command with these. Secrets are hidden in command output.",
  MEMBER: "Only an owner or admin can change them.",
  EMPTY: "No variables or secrets yet.",
  FAILED: "The workspace's environment could not be read.",
  SAVE_FAILED: "It could not be saved. Try again.",
  REMOVE_FAILED: "It could not be removed. Try again.",
  TOO_MANY: "This workspace already holds 100 variables and secrets. Remove one first.",
  BAD_NAME: "Use capital letters, digits, and underscores, not starting with a digit.",
  LONG_NAME: `A name can be at most ${WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS} characters.`,
  NO_VALUE: "Enter a value.",
  LONG_VALUE: `A value can be at most ${WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS.toLocaleString("en-US")} characters.`,
  NUL_VALUE: "A value can't hold a NUL character.",
  SHORT_SECRET: `A secret must be at least ${WORKSPACE_ENVIRONMENT_BOUNDS.MIN_SECRET_CHARS} characters, so it can be hidden in command output.`,
  UNREADABLE: "Can no longer be read. Save it again.",
} as const;

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** A name a shell takes; the service holds every name to the same. */
const NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

const KIND_ITEMS = [
  { value: WORKSPACE_ENVIRONMENT_KIND.VARIABLE, label: "Variable" },
  { value: WORKSPACE_ENVIRONMENT_KIND.SECRET, label: "Secret" },
] as const;

/** What a save is, as the dialog hands it up. */
interface EnvironmentSave {
  readonly name: string;
  readonly kind: WorkspaceEnvironmentKind;
  readonly value: string;
}

/** Which dialog is open: a new entry's, or the one an entry is edited in. */
type EnvironmentDialogFor =
  | { readonly adding: true }
  | { readonly adding: false; readonly entry: WorkspaceEnvironmentEntry };

/** Why a typed name or value would be refused, or nothing where the service would take them. */
function refusalOf(
  name: string,
  kind: WorkspaceEnvironmentKind,
  value: string,
): string | undefined {
  if (!NAME_PATTERN.test(name)) return PAGE_LINE.BAD_NAME;
  if (name.length > WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS) return PAGE_LINE.LONG_NAME;
  if (!environmentNameAllowed(name))
    return `${name} is set by the sandbox or Luke. Choose another name.`;
  if (value === "") return PAGE_LINE.NO_VALUE;
  if (value.length > WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS) return PAGE_LINE.LONG_VALUE;
  if (value.includes("\0")) return PAGE_LINE.NUL_VALUE;
  const secret = kind === WORKSPACE_ENVIRONMENT_KIND.SECRET;
  if (secret && value.length < WORKSPACE_ENVIRONMENT_BOUNDS.MIN_SECRET_CHARS) {
    return PAGE_LINE.SHORT_SECRET;
  }
  return undefined;
}

/** Words set in the code face, inside the line they stand in. */
function Code({ children }: { children: string }): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
      {children}
    </Text>
  );
}

/** What one entry's row says under its name: its value or hint, when it was saved, and whether it can still be read. */
function EntryFacts({ entry }: { entry: WorkspaceEnvironmentEntry }): React.JSX.Element {
  const secret = entry.kind === WORKSPACE_ENVIRONMENT_KIND.SECRET;
  const shown = secret
    ? entry.hint === undefined || entry.hint === ""
      ? undefined
      : entry.hint
    : entry.value;
  return (
    <SettingsFacts gap={GAP.TIGHT}>
      {secret ? "Secret · " : null}
      {shown === undefined ? null : (
        <>
          <Code>{shown}</Code>
          {" · "}
        </>
      )}
      {`Saved ${dayText(entry.updatedAt)}`}
      {entry.readable ? null : (
        <>
          {" · "}
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION} role="alert">
            {PAGE_LINE.UNREADABLE}
          </SettingsRowStateLine>
        </>
      )}
    </SettingsFacts>
  );
}

/** The dialog a variable or secret is added or edited in: the name (a new one's alone), its kind, and its value. */
function EnvironmentDialog({
  open,
  onSave,
  onClose,
}: {
  open: EnvironmentDialogFor;
  /** Saves it, answering why nothing was kept where it was not; the dialog closes once it is kept. */
  onSave: (save: EnvironmentSave) => Promise<string | undefined>;
  onClose: () => void;
}): React.JSX.Element {
  const editing = open.adding ? undefined : open.entry;
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<WorkspaceEnvironmentKind>(
    editing?.kind ?? WORKSPACE_ENVIRONMENT_KIND.VARIABLE,
  );
  // A secret's value is never held, so editing one starts from nothing.
  const [value, setValue] = useState(
    editing?.kind === WORKSPACE_ENVIRONMENT_KIND.VARIABLE ? (editing.value ?? "") : "",
  );
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const save = () => {
    const typed = name.trim();
    const refused = refusalOf(typed, kind, value);
    setRefusal(refused);
    if (refused !== undefined || saving) return;
    setSaving(true);
    void onSave({ name: typed, kind, value }).then((answered) => {
      setSaving(false);
      setRefusal(answered);
    });
  };

  return (
    <Dialog
      title={editing === undefined ? "Add variable" : `Edit ${editing.name}`}
      size={DIALOG_SIZE.WIDE}
      busy={saving}
      // A dismissal while the save is on its way is ignored, so its refusal has a dialog to stand in.
      onDismiss={() => {
        if (!saving) onClose();
      }}
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} busy={saving} busyLabel="Saving" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className={NO_CAPTURE}>
        <Stack gap={GAP.FIELD}>
          {/* An edited entry's name is the dialog's title, so only a new one is typed. */}
          {editing === undefined ? (
            <FormField label="Name">
              {(field) => (
                <TextField
                  field={field}
                  placeholder="NAME"
                  font={TEXT_FIELD_FONT.MONO}
                  autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
                  spellCheck={false}
                  autoFocus
                  disabled={saving}
                  value={name}
                  onEnter={save}
                  onChange={(typed) => {
                    setName(typed);
                    setRefusal(undefined);
                  }}
                />
              )}
            </FormField>
          ) : null}
          <FormField label="Kind">
            {() => (
              <ChoiceBar
                label="Kind"
                items={KIND_ITEMS}
                value={kind}
                look={CHOICE_BAR_LOOK.SEGMENTED}
                disabled={saving}
                onChange={(chosen: WorkspaceEnvironmentKind) => {
                  setKind(chosen);
                  // Note that a value typed as one kind is not carried to the other, so a variable's is never masked as a secret's or the reverse.
                  setValue("");
                  setRefusal(undefined);
                }}
              />
            )}
          </FormField>
          <FormField label="Value" error={refusal}>
            {(field) => (
              <TextArea
                field={field}
                placeholder={
                  kind === WORKSPACE_ENVIRONMENT_KIND.SECRET ? "Paste the secret" : "Value"
                }
                rows={1}
                grow
                masked={kind === WORKSPACE_ENVIRONMENT_KIND.SECRET}
                font={TEXT_FIELD_FONT.MONO}
                spellCheck={false}
                autoFocus={editing !== undefined}
                busy={saving}
                value={value}
                onSubmit={save}
                onChange={(typed) => {
                  setValue(typed);
                  setRefusal(undefined);
                }}
              />
            )}
          </FormField>
        </Stack>
      </div>
    </Dialog>
  );
}

/** One entry's row: its name, what it is, and, for an owner or admin, Edit and Remove behind its ⋯. */
function EnvironmentRow({
  entry,
  manages,
  locked,
  onEdit,
  onRemove,
}: {
  entry: WorkspaceEnvironmentEntry;
  manages: boolean;
  locked: boolean;
  onEdit: () => void;
  onRemove: (name: string) => Promise<ActionResult>;
}): React.JSX.Element {
  const removal = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    onRemove(entry.name),
  );
  const actions = manages
    ? [
        {
          label: "Edit",
          icon: <PencilIcon />,
          disabled: removal.busy || locked,
          onSelect: onEdit,
        },
        {
          label: "Remove",
          icon: <TrashIcon />,
          danger: true,
          disabled: removal.busy || locked,
          onSelect: removal.ask,
        },
      ]
    : [];
  return (
    <>
      <MenuRow
        label={`${entry.name} actions`}
        actions={actions}
        row={{
          label: <Code>{entry.name}</Code>,
          description: <EntryFacts entry={entry} />,
        }}
      />
      <ConfirmDialog
        confirm={removal}
        question={{
          title: `Remove ${entry.name}?`,
          body: "Coding agents in this workspace will no longer have it from their next command.",
          verb: "Remove",
          running: "Removing…",
        }}
      />
    </>
  );
}

/** The Environment section of one workspace, read as it opens. */
export function EnvironmentGroup({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const manages = managesWorkspace(workspace);
  const [entries, setEntries] = useState<readonly WorkspaceEnvironmentEntry[] | undefined>();
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [changing, setChanging] = useState(false);
  const [dialog, setDialog] = useState<EnvironmentDialogFor | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setEntries(undefined);
    setReadFailed(false);
    act(ACT_KIND.WORKSPACE_ENVIRONMENT_READ, { workspaceId: workspace.id }).then(
      (answer) => {
        if (live) setEntries(answer.entries);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspace.id, attempt]);

  const save = useCallback(
    (asked: EnvironmentSave): Promise<string | undefined> => {
      setChanging(true);
      return act(ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE, {
        workspaceId: workspace.id,
        name: asked.name,
        kind: asked.kind,
        secretValue: asked.value,
      })
        .then(
          (answer): string | undefined => {
            setEntries(answer.entries);
            if (answer.rejected === WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY) {
              return PAGE_LINE.TOO_MANY;
            }
            setDialog(undefined);
            return undefined;
          },
          () => PAGE_LINE.SAVE_FAILED,
        )
        .finally(() => setChanging(false));
    },
    [act, workspace.id],
  );

  const remove = useCallback(
    (name: string): Promise<ActionResult> => {
      setChanging(true);
      return act(ACT_KIND.WORKSPACE_ENVIRONMENT_REMOVE, { workspaceId: workspace.id, name })
        .then(
          (answer): ActionResult => {
            setEntries(answer.entries);
            return { status: ACTION_RESULT_STATUS.ACCEPTED };
          },
          (): ActionResult => ({
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: PAGE_LINE.REMOVE_FAILED,
          }),
        )
        .finally(() => setChanging(false));
    },
    [act, workspace.id],
  );

  return (
    <div className={NO_CAPTURE}>
      <SettingsSection title="Environment" anchor={SETTINGS_SECTION.ENVIRONMENT}>
        {manages ? (
          <SettingsRow label="Variables and secrets" description={PAGE_LINE.INTRO}>
            {() => (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                icon={<PlusIcon />}
                disabled={changing}
                onClick={() => setDialog({ adding: true })}
              >
                Add variable
              </Button>
            )}
          </SettingsRow>
        ) : (
          <SettingsLine>{`${PAGE_LINE.INTRO} ${PAGE_LINE.MEMBER}`}</SettingsLine>
        )}
        {entries !== undefined ? (
          entries.length === 0 ? (
            <SettingsLine>{PAGE_LINE.EMPTY}</SettingsLine>
          ) : (
            entries.map((entry) => (
              <EnvironmentRow
                key={entry.name}
                entry={entry}
                manages={manages}
                locked={changing}
                onEdit={() => setDialog({ adding: false, entry })}
                onRemove={remove}
              />
            ))
          )
        ) : readFailed ? (
          <SettingsLine>
            <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
              {PAGE_LINE.FAILED}
            </ErrorState>
          </SettingsLine>
        ) : (
          <SettingsRowsSkeleton label="Loading the workspace's environment" rows={2} />
        )}
      </SettingsSection>
      {dialog === undefined ? null : (
        <EnvironmentDialog open={dialog} onSave={save} onClose={() => setDialog(undefined)} />
      )}
    </div>
  );
}

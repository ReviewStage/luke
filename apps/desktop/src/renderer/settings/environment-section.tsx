import {
  environmentNameAllowed,
  WORKSPACE_ENVIRONMENT_BOUNDS,
  WORKSPACE_ENVIRONMENT_KIND,
  WORKSPACE_ENVIRONMENT_REJECTION,
  type WorkspaceEnvironmentAnswer,
  type WorkspaceEnvironmentEntry,
  type WorkspaceEnvironmentKind,
} from "@luke/features/workspace-environment-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import { PencilIcon, TrashIcon } from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import { Segmented } from "../segmented";
import { BusyLabel, SpinnerRegion } from "../spinner";
import { dayText } from "../tasks/task-time";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * environment-section.tsx -- Settings › Workspace › Environment: the variables and secrets every coding agent of the workspace runs its commands with.
 *
 * One row per name: a variable with its value, a secret by the hint the
 * service answers (its last characters) alone, each with when it was last
 * saved. An owner or admin adds one with Add, and edits or removes one
 * behind its row's ⋯; a member reads the list alone. Adding or editing grows
 * the group a form: the name, Variable or Secret, and the value, a secret's
 * in a password field. A secret's value stands in its field alone, is read
 * from it once on Save, and is cleared from it as soon as the service keeps
 * it; editing a secret starts from an empty field, since the page never
 * holds one. A name the service would refuse is refused here, saying why,
 * and sends nothing. One change runs at a time, since every answer is the
 * list whole. Remove asks first. The whole group is kept out of the screen
 * recording.
 */

const PAGE_LINE = {
  INTRO:
    "Every coding agent in this workspace runs its commands with these. A secret is shown only by its last characters once saved, and is hidden in what commands print.",
  MEMBER: "Only an owner or admin of this workspace can change these.",
  EMPTY: "No variables or secrets yet.",
  FAILED: "The workspace's environment could not be read.",
  SAVE_FAILED: "It could not be saved. Try again.",
  REMOVE_FAILED: "It could not be removed. Try again.",
  TOO_MANY: "This workspace already holds 100 variables and secrets. Remove one first.",
  BAD_NAME: "Use capital letters, digits, and underscores, not starting with a digit.",
  NO_VALUE: "Enter a value.",
  LONG_NAME: `A name can be at most ${WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS} characters.`,
  LONG_VALUE: `A value can be at most ${WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS.toLocaleString("en-US")} characters.`,
  NUL_VALUE: "A value can't hold a NUL character.",
  SHORT_SECRET: `A secret must be at least ${WORKSPACE_ENVIRONMENT_BOUNDS.MIN_SECRET_CHARS} characters, so it can be hidden in what commands print.`,
  UNREADABLE: "Can no longer be read. Save it again.",
} as const;

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** A name a shell takes; the service holds every name to the same. */
const NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

const KIND_LABEL = {
  [WORKSPACE_ENVIRONMENT_KIND.VARIABLE]: "Variable",
  [WORKSPACE_ENVIRONMENT_KIND.SECRET]: "Secret",
} as const satisfies Record<WorkspaceEnvironmentKind, string>;

const KIND_OPTIONS = Object.values(WORKSPACE_ENVIRONMENT_KIND).map((kind) => ({
  value: kind,
  label: KIND_LABEL[kind],
}));

/** What a save is, as the form hands it up. */
interface EnvironmentSave {
  readonly name: string;
  readonly kind: WorkspaceEnvironmentKind;
  readonly value: string;
}

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

/** What one entry's row says under its name. */
function entryWords(entry: WorkspaceEnvironmentEntry): string {
  const saved = `Saved ${dayText(entry.updatedAt)}`;
  if (entry.kind === WORKSPACE_ENVIRONMENT_KIND.SECRET) {
    return entry.hint === undefined || entry.hint === ""
      ? `Secret · ${saved}`
      : `Secret · ${entry.hint} · ${saved}`;
  }
  return saved;
}

/** The add or edit form: the name (fixed while editing), the kind, and the value. */
function EnvironmentForm({
  editing,
  locked,
  onSave,
  onCancel,
}: {
  /** The entry being edited, or none for a new one. */
  editing: WorkspaceEnvironmentEntry | undefined;
  locked: boolean;
  /** Saves it, answering why nothing was kept where it was not. */
  onSave: (save: EnvironmentSave) => Promise<string | undefined>;
  onCancel: () => void;
}): React.JSX.Element {
  const nameField = useRef<HTMLInputElement | null>(null);
  const valueField = useRef<HTMLTextAreaElement | null>(null);
  const [kind, setKind] = useState<WorkspaceEnvironmentKind>(
    editing?.kind ?? WORKSPACE_ENVIRONMENT_KIND.VARIABLE,
  );
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  // The form opens with the focus where typing starts: the name, or an edited entry's value.
  useEffect(() => {
    (editing === undefined ? nameField : valueField).current?.focus();
  }, [editing]);

  const save = () => {
    const name = (nameField.current?.value ?? "").trim();
    const value = valueField.current?.value ?? "";
    const refused = refusalOf(name, kind, value);
    setRefusal(refused);
    if (refused !== undefined || saving || locked) return;
    setSaving(true);
    void onSave({ name, kind, value }).then((answered) => {
      setSaving(false);
      setRefusal(answered);
      // Kept: the value leaves its field whatever its kind, and the row draws the service's word for it.
      if (answered === undefined && valueField.current !== null) valueField.current.value = "";
    });
  };

  return (
    <>
      <form
        className="environment-form"
        aria-label={editing === undefined ? "New variable or secret" : `Edit ${editing.name}`}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        // Escape closes the form and nothing behind it: the window's own Escape would leave Settings.
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        <input
          ref={nameField}
          className="settings-input environment-name"
          aria-label="Name"
          placeholder="NAME"
          defaultValue={editing?.name ?? ""}
          readOnly={editing !== undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
          onChange={() => setRefusal(undefined)}
        />
        <Segmented
          legend="Kind"
          options={KIND_OPTIONS}
          value={kind}
          disabled={saving}
          onChange={setKind}
        />
        <textarea
          // Keyed to the kind, so a value typed as a variable is not shown again as a secret's or the reverse.
          key={kind}
          ref={valueField}
          // A textarea, so a certificate or a key's line breaks are kept; a secret's characters are drawn as discs.
          rows={1}
          className={`settings-input environment-value ${NO_CAPTURE}${
            kind === WORKSPACE_ENVIRONMENT_KIND.SECRET ? " environment-secret" : ""
          }`}
          aria-label="Value"
          placeholder={kind === WORKSPACE_ENVIRONMENT_KIND.SECRET ? "Paste the secret" : "Value"}
          defaultValue={
            editing?.kind === WORKSPACE_ENVIRONMENT_KIND.VARIABLE && kind === editing.kind
              ? (editing.value ?? "")
              : ""
          }
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
          onChange={() => setRefusal(undefined)}
        />
        <div className="environment-form-actions">
          <button
            type="button"
            className="toolbar-button bordered-button"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving || locked}>
            <BusyLabel busy={saving} label="Saving">
              Save
            </BusyLabel>
          </button>
        </div>
      </form>
      {refusal === undefined ? null : (
        <p className="error-message" role="alert">
          {refusal}
        </p>
      )}
    </>
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
      <MenuRow label={`${entry.name} actions`} actions={actions}>
        <span className="settings-copy">
          <strong>
            <code className="api-key-hint">{entry.name}</code>
          </strong>
          <small>
            {entry.readable ? null : (
              <>
                <span className="settings-state" data-state="attention" role="alert">
                  {PAGE_LINE.UNREADABLE}
                </span>
                {" · "}
              </>
            )}
            {entry.kind === WORKSPACE_ENVIRONMENT_KIND.VARIABLE && entry.value !== undefined ? (
              <>
                <code className="api-key-hint environment-shown-value">{entry.value}</code>
                {" · "}
              </>
            ) : null}
            {entryWords(entry)}
          </small>
        </span>
      </MenuRow>
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

/** The Environment group of one workspace, read as it opens. */
export function EnvironmentGroup({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const manages = managesWorkspace(workspace);
  const [entries, setEntries] = useState<readonly WorkspaceEnvironmentEntry[] | undefined>();
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [changing, setChanging] = useState(false);
  /** The form open: a new entry's (null), an entry's being edited, or none. */
  const [form, setForm] = useState<WorkspaceEnvironmentEntry | null | undefined>(undefined);

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
          (answer: WorkspaceEnvironmentAnswer): string | undefined => {
            setEntries(answer.entries);
            if (answer.rejected === WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY)
              return PAGE_LINE.TOO_MANY;
            setForm(undefined);
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
      <SettingsGroup title="Environment" anchor={SETTINGS_SECTION.ENVIRONMENT}>
        <p className="settings-card-line settings-note">
          {manages ? PAGE_LINE.INTRO : `${PAGE_LINE.INTRO} ${PAGE_LINE.MEMBER}`}
        </p>
        {entries !== undefined ? (
          <>
            {entries.length === 0 && form === undefined ? (
              <p className="settings-card-line settings-note">{PAGE_LINE.EMPTY}</p>
            ) : null}
            {entries.map((entry) =>
              form !== undefined && form !== null && form.name === entry.name ? null : (
                <EnvironmentRow
                  key={entry.name}
                  entry={entry}
                  manages={manages}
                  locked={changing || form !== undefined}
                  onEdit={() => setForm(entry)}
                  onRemove={remove}
                />
              ),
            )}
            {form === undefined ? null : (
              <EnvironmentForm
                key={form?.name ?? ""}
                editing={form ?? undefined}
                locked={changing}
                onSave={save}
                onCancel={() => setForm(undefined)}
              />
            )}
            {manages && form === undefined ? (
              <div className="settings-row">
                <button
                  type="button"
                  className="toolbar-button bordered-button"
                  disabled={changing}
                  onClick={() => setForm(null)}
                >
                  Add variable or secret
                </button>
              </div>
            ) : null}
          </>
        ) : readFailed ? (
          <ReadFailed line={PAGE_LINE.FAILED} onRetry={() => setAttempt((count) => count + 1)} />
        ) : (
          <div className="settings-card-line settings-reading">
            <SpinnerRegion label="Loading the workspace's environment" />
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

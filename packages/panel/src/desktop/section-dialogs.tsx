import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionIcon,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import {
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogConfirm,
  FormField,
  nextRowOrHead,
  TextField,
  useConfirmDialog,
} from "@luke/ui";
import {
  applySectionWrite,
  memberOf,
  memberSection,
  placeAllWrites,
  placeWrites,
  type SectionMember,
  sectionMoveWrites,
  sectionOrder,
  unplaceAllWrites,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useRef, useState } from "react";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { undoToast, useToast } from "../toast.js";
import type { MenuAction, MenuEntry } from "./action-menu.js";
import { SectionIconPicker, sectionGlyph } from "./section-icon-picker.js";
import { useFormDialog } from "./use-form-dialog.js";

/**
 * section-dialogs.tsx -- the dialog that makes and edits one of the account's own sections, and the Move to section of a task's menu and an agent's.
 *
 * A section is the reader's own (`task-section-wire.ts`), so nothing here
 * is a teammate's. The Tasks page's List draws the sections (`tasks-list.tsx`);
 * every change is drawn at once and kept on the account
 * (`TasksControl.onWriteSections`).
 */

/** Why a blank title was not kept. */
const TITLE_ASKED = "Name the section.";

/** What the toast says once a section is deleted. */
const SECTION_DELETED = "Section deleted";

/** What the dialog was opened to do: make a section in a workspace, then perhaps more with it, or edit one. */
type SectionAsk =
  | {
      readonly kind: typeof TASK_SECTION_WRITE.CREATE;
      readonly workspaceId: string;
      readonly after: ((sectionId: string) => readonly TaskSectionWrite[]) | undefined;
    }
  | { readonly kind: typeof TASK_SECTION_WRITE.EDIT; readonly section: TaskSection };

/** The section dialogs' doors, and the cards they open. */
export interface SectionDialogs {
  /** Opens New section in a workspace; `after` is what to write with the section once made, a task moved into it. */
  askNew: (workspaceId: string, after?: (sectionId: string) => readonly TaskSectionWrite[]) => void;
  askEdit: (section: TaskSection) => void;
  /** Deletes a section, focus going on from `from`, the control its menu was opened from, to the section after it, or the first. */
  askDelete: (section: TaskSection, from: HTMLElement | null) => void;
  dialog: React.JSX.Element;
}

/** The writes a section dialog's answer makes. */
function answerWrites(ask: SectionAsk, title: string, icon: TaskSectionIcon | undefined) {
  if (ask.kind === TASK_SECTION_WRITE.EDIT) {
    return [{ kind: TASK_SECTION_WRITE.EDIT, id: ask.section.id, title, icon: icon ?? null }];
  }
  const id = crypto.randomUUID();
  const made: TaskSectionWrite = {
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId: ask.workspaceId,
    title,
    ...(icon === undefined ? undefined : { icon }),
  };
  return [made, ...(ask.after?.(id) ?? [])];
}

/**
 * The writes an Undo of deleting `section` asks, read against the sections
 * as they stood before, `before`, and as they stand now, `current`: the
 * section made again under its id, stood back at its place among its
 * workspace's, and its rows put back in it in their order. A row put in
 * another section since stays there, since that was chosen anew. Note that
 * each row is given a position, as `placeAllWrites` gives one, because rows
 * put back together are stamped in the same instant.
 */
function undeleteWrites(
  before: TaskSections,
  current: TaskSections,
  section: TaskSection,
  now: number,
): TaskSectionWrite[] {
  const { id, workspaceId, title, icon } = section;
  const made: TaskSectionWrite = {
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId,
    title,
    ...(icon === undefined ? undefined : { icon }),
  };
  const remade = applySectionWrite(current, made, now);
  const was = workspaceSections(before, workspaceId).findIndex((each) => each.id === id);
  const order = workspaceSections(remade, workspaceId);
  const from = order.findIndex((each) => each.id === id);
  const at = Math.min(Math.max(was, 0), order.length - 1);
  const moved = from === at ? [] : sectionMoveWrites(order, from, at);
  const members = sectionOrder(before, id)
    .map(memberOf)
    .filter((member) => memberSection(current, member) === undefined);
  return [made, ...moved, ...placeAllWrites(remade, members, id, now)];
}

/**
 * New section and Edit section's dialog, standing only while `surfaceOpen`
 * and an account is signed in, and Delete section, which asks nothing and
 * offers Undo. New and Edit ask a title, held to the wire's bound, and an
 * icon; Enter in the title answers. Every answer is drawn at once, so the
 * card never waits on the service. Note that the Undo reads the sections as
 * they stand when it is pressed (`latest`), since it lands renders after
 * the delete.
 */
export function useSectionDialogs(tasks: TasksControl, surfaceOpen: boolean): SectionDialogs {
  const [ask, setAsk] = useState<SectionAsk | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<TaskSectionIcon | undefined>(undefined);
  const field = useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  const latest = useRef(tasks);
  latest.current = tasks;
  // Note that a question about a section goes with the section, deleted on another Mac or by a refresh.
  const standing = (section: TaskSection | undefined) =>
    section !== undefined && tasks.taskSections.sections.some((each) => each.id === section.id);
  const asked = ask?.kind === TASK_SECTION_WRITE.EDIT ? standing(ask.section) : true;
  const confirm: DialogConfirm = useConfirmDialog(
    { subject: tasks.signedIn && asked, surfaceOpen },
    (): Promise<ActionResult> => {
      const trimmed = title.trim();
      if (trimmed === "" || ask === undefined) {
        return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: TITLE_ASKED });
      }
      tasks.onWriteSections(answerWrites(ask, trimmed, icon));
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  );
  const open = (next: SectionAsk, words: string, chosen: TaskSectionIcon | undefined) => {
    setAsk(next);
    setTitle(words);
    setIcon(chosen);
    confirm.ask();
  };
  const editing = ask?.kind === TASK_SECTION_WRITE.EDIT;
  const blank = title.trim() === "";
  const form = useFormDialog(confirm, !blank);
  const dialog = (
    <>
      <Dialog
        open={form.open}
        title={editing ? "Edit section" : "New section"}
        busy={form.settling}
        refused={form.refusal !== undefined}
        initialFocus={field}
        onDismiss={form.dismiss}
        restoreTo={nextRowOrHead}
        actions={
          <DialogActions
            onCancel={form.dismiss}
            act={{
              verb: editing ? "Save" : "Create section",
              tone: DIALOG_TONE.PRIMARY,
              running: editing ? "Saving" : "Creating section",
              ...form.act,
            }}
          />
        }
      >
        <FormField label="Section title" error={form.refusal}>
          {(control) => (
            <TextField
              ref={field}
              field={control}
              spellCheck={false}
              placeholder="Launch week"
              maxLength={TASK_SECTION_BOUNDS.MAX_TITLE_CHARS}
              value={title}
              disabled={form.settling}
              // Note that Enter on a blank title is asked anyway, so the field says why it was not kept.
              onEnter={blank ? confirm.run : form.submit}
              onChange={(next) => {
                setTitle(next);
                // Note that a refused answer has settled, so the refusal alone holds
                // the card up: the question is asked again rather than cleared, or
                // the first key typed after it would close the card.
                if (confirm.rejection !== undefined) confirm.ask();
              }}
            />
          )}
        </FormField>
        {/* Keyed by what was asked, so each opening starts its tab, color, and search afresh from the icon it opened with. */}
        <SectionIconPicker
          key={ask?.kind === TASK_SECTION_WRITE.EDIT ? ask.section.id : TASK_SECTION_WRITE.CREATE}
          icon={icon}
          disabled={form.settling}
          onIcon={setIcon}
        />
      </Dialog>
    </>
  );
  return {
    askNew: (workspaceId, after) =>
      open({ kind: TASK_SECTION_WRITE.CREATE, workspaceId, after }, "", undefined),
    askEdit: (section) =>
      open({ kind: TASK_SECTION_WRITE.EDIT, section }, section.title, section.icon),
    askDelete: (section, from) => {
      const before = tasks.taskSections;
      // Note that focus goes on to the section beside it now, while this one
      // still stands, rather than falling to the window as it is taken away.
      if (from !== null) nextRowOrHead(from)()?.focus({ preventScroll: true });
      tasks.onWriteSections([{ kind: TASK_SECTION_WRITE.DELETE, id: section.id }]);
      toast(
        undoToast(SECTION_DELETED, () => {
          const now = latest.current;
          now.onWriteSections(undeleteWrites(before, now.taskSections, section, Date.now()));
        }),
      );
    },
    dialog,
  };
}

/**
 * The Move to section of a task's menu or an agent's: the row's workspace's
 * sections, the one it stands in checked, New section… to make one with the
 * row in it, and Remove from section while it stands in one. A row moved
 * here lands on top of its new section, as one dragged onto its header
 * would.
 */
export function moveToSectionEntry(
  tasks: TasksControl,
  member: SectionMember,
  workspaceId: string,
  askNew: SectionDialogs["askNew"],
): MenuEntry {
  const state = tasks.taskSections;
  const standing = memberSection(state, member);
  const put = (sectionId: string) =>
    placeWrites(sectionOrder(state, sectionId), member, sectionId, 0, Date.now());
  const sections = workspaceSections(state, workspaceId).map((section): MenuAction => {
    const glyph = sectionGlyph(section.icon);
    return {
      label: section.title,
      ...(glyph === undefined ? undefined : { icon: glyph }),
      checked: section.id === standing,
      onSelect: () => {
        if (section.id !== standing) tasks.onWriteSections(put(section.id));
      },
    };
  });
  const remove: MenuAction[] =
    standing === undefined
      ? []
      : [
          {
            label: "Remove from section",
            onSelect: () => tasks.onWriteSections(unplaceAllWrites([member])),
          },
        ];
  return {
    ...commandHead(PANEL_COMMAND.MOVE_TO_SECTION),
    items: [
      ...sections,
      { label: "New section…", onSelect: () => askNew(workspaceId, put) },
      ...remove,
    ],
  };
}

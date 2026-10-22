import {
  taskPictureLine,
  withoutPictureLine,
  withPictureLine,
} from "@luke/features/agent-pictures-model";
import type { FileChip } from "@luke/features/attachment-model";
import { PICTURE_BOUNDS } from "@luke/features/picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import {
  PICTURE_KEEP_FAILURE,
  TASK_CALL_FAILURE,
  type TasksEditAnswer,
} from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { keepPictureRead } from "@luke/ui/picture-cache";
import { ImagePlusIcon } from "lucide-react";
import { useMemo } from "react";
import { useAct } from "../act.js";
import { encodeImage } from "../feedback-images.js";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast.js";
import type { ViewerAction } from "./attachment-viewer.js";
import { useTaskMentions } from "./task-mentions.js";

/**
 * add-to-plan.tsx -- a picture an agent showed, added to the plan it works on: kept on the plan as a picture of its own and written at the end of its text, as the developer's edit, with Undo.
 *
 * The picture is the agent's, read from its transcript, so it is kept on the
 * plan again, as a picture pasted from another plan is, and the plan's
 * readers see it on the plan's own terms. The Mac re-encodes it to the plan's
 * bound first (`encodeImage`), since an agent's picture may be larger than a
 * plan's may. The line is written at the end of the plan's text, a paragraph
 * of its own, through the same edit a developer's save is; an edit that
 * meets the text moved on is written again on the text as it stands. Note
 * that it is never written at the editor's caret, because the plan's editor
 * closes as focus leaves it, and the press that adds the picture is in the
 * agent's tab. Undo takes the line back out where it still stands alone;
 * the kept picture goes with the plan.
 */

/** What the press is called. */
const ADD_LABEL = "Add to plan";

/** What each outcome says in the window's toast. */
const ADD_WORDS = {
  ADDED: "Added to the plan",
  NOT_A_PICTURE: "This picture could not be added to the plan.",
  TOO_MANY: "This plan already holds as many pictures as it can.",
  NOT_SAVED: "The plan could not be saved just now.",
  UNDONE: "Taken out of the plan",
  NOT_UNDONE: "The plan changed since, so the picture stays in it.",
} as const;

/** How many times an edit is written again on the text as it stands before it gives up. */
const EDIT_TRIES = 3;

/** The file's own bytes, read from its `data:` URL. */
function fileOf(chip: FileChip): File {
  const base64 = chip.url.slice(chip.url.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0));
  return new File([bytes], chip.name, { type: chip.mediaType });
}

/** A picture's words: the name the viewer saves it by, without its extension. */
function wordsOf(chip: FileChip): string {
  const dot = chip.name.lastIndexOf(".");
  return dot > 0 ? chip.name.slice(0, dot) : chip.name;
}

/** The plan's text after an edit written on whatever it stands as now; nothing where no edit saved. */
async function edited(
  save: (base: string, value: string) => Promise<TasksEditAnswer>,
  change: (text: string) => string | undefined,
  known: string,
): Promise<string | undefined> {
  let base = known;
  for (let tried = 0; tried < EDIT_TRIES; tried += 1) {
    const value = change(base);
    if (value === undefined) return undefined;
    const answer = await save(base, value);
    if ("saved" in answer) return value;
    if (!("conflict" in answer)) return undefined;
    base = answer.conflict.current;
  }
  return undefined;
}

/**
 * The viewer's Add to plan, for a transcript drawn on a plan's page; none
 * where it is drawn off one, as an agent with no plan's is.
 */
export function useAddToPlan(): ViewerAction | undefined {
  const page = useTaskMentions();
  const { act } = useAct();
  const toast = useToast();
  return useMemo(() => {
    if (page === undefined || page.taskId === "" || page.workspace === "") return undefined;
    const { taskId, workspace } = page;
    const failed = (words: string) =>
      toast({ words, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    const save = (base: string, value: string): Promise<TasksEditAnswer> =>
      act(ACT_KIND.TASKS_EDIT, { taskId: taskId, edit: { document: { base, value } } }).catch(
        (): TasksEditAnswer => ({ failure: TASK_CALL_FAILURE.UNANSWERED }),
      );
    const add = async (chip: FileChip) => {
      const encoded = await encodeImage(fileOf(chip), PICTURE_BOUNDS.MAX_BYTES);
      if (encoded === undefined) return failed(ADD_WORDS.NOT_A_PICTURE);
      const url = `data:${encoded.mediaType};base64,${encoded.base64}`;
      const kept = await act(ACT_KIND.TASKS_PICTURE_KEEP, { planId: taskId, picture: url }).catch(
        () => ({
          failure: PICTURE_KEEP_FAILURE.UNANSWERED,
        }),
      );
      if ("failure" in kept) {
        return failed(
          kept.failure === PICTURE_KEEP_FAILURE.TOO_MANY ? ADD_WORDS.TOO_MANY : ADD_WORDS.NOT_SAVED,
        );
      }
      keepPictureRead(taskId, kept.id, url);
      const address = planAttachmentAddress({ taskId: taskId, attachmentId: kept.id }, workspace);
      const line = taskPictureLine(wordsOf(chip), address);
      // Note that the edit is written on the plan's words as the page last read
      // them, and a conflict answers the text as it stands for the next.
      // Note that what was added is kept from the edit that saved, since a
      // retry on a moved text may add other line breaks than the first try.
      let addition = "";
      const saved = await edited(
        save,
        (text) => {
          const next = withPictureLine(text, line);
          addition = next.added;
          return next.text;
        },
        page.text(),
      );
      if (saved === undefined) return failed(ADD_WORDS.NOT_SAVED);
      const added = addition;
      const undo = async () => {
        const undone = await edited(save, (text) => withoutPictureLine(text, added), saved);
        toast(
          undone === undefined
            ? { words: ADD_WORDS.NOT_UNDONE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED }
            : { words: ADD_WORDS.UNDONE, tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE },
        );
      };
      toast({
        words: ADD_WORDS.ADDED,
        tone: TOAST_TONE.DONE,
        action: { label: UNDO_LABEL, onPress: () => void undo() },
      });
    };
    return {
      label: ADD_LABEL,
      icon: <ImagePlusIcon aria-hidden="true" />,
      onPress: (chip: FileChip) => void add(chip),
    };
  }, [act, page, toast]);
}

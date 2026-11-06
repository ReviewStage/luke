import {
  taskPictureLine,
  withoutPictureLine,
  withPictureLine,
} from "@repo/features/agent-pictures-model";
import type { FileChip } from "@repo/features/attachment-model";
import { PICTURE_BOUNDS } from "@repo/features/picture-wire";
import { descriptionAttachmentAddress } from "@repo/features/description-attachment-link";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  PICTURE_KEEP_FAILURE,
  TASK_CALL_FAILURE,
  type TasksEditAnswer,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { isVideoDataUrl, STATUS_TONE } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlusIcon } from "lucide-react";
import { useMemo } from "react";
import { unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { encodeImage } from "../feedback-images.js";
import { keepPictureRead } from "../picture-query.js";
import { TOAST_HOLD, undoToast, useToast, useWorkingToast } from "../toast.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import type { ViewerAction } from "./attachment-viewer.js";
import { holderTaskId } from "./mention-holder.js";
import { useTaskMentions } from "./task-mentions.js";

/**
 * add-to-description.tsx -- a picture or a recording an agent showed, added to its task's description: kept on the description as one of its own and written at the end of its text, as the developer's edit, with Undo.
 *
 * The picture is the agent's, read from its transcript, so it is kept on the
 * description again, as a picture pasted from another description is, and the description's
 * readers see it on the description's own terms. The Mac re-encodes a picture to
 * the description's bound first (`encodeImage`), since an agent's picture may be
 * larger than a description's may. A recording is kept as it is, never re-encoded,
 * where it is no larger than a video sent to the description may be
 * (`PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES`), and the description plays it in place. The line is written at the end of the description's text, a paragraph
 * of its own, through the same edit a developer's save is; an edit that
 * meets the text moved on is written again on the text as it stands. Note
 * that it is never written at the editor's caret, because the description's editor
 * closes as focus leaves it, and the press that adds the picture is in the
 * agent's tab. The toast says the adding is under way from the press, since
 * re-encoding, keeping, and writing can take a moment, and turns in place
 * into what came of it. Undo takes the line back out where it still stands alone;
 * the kept picture goes with the description.
 */

/** What the press is called. */
const ADD_LABEL = "Add to description";

/** What each outcome says in the window's toast. */
const ADD_WORDS = {
  ADDING: "Adding to the description…",
  ADDED: "Added to the description",
  NOT_A_PICTURE: "This picture could not be added to the description.",
  VIDEO_TOO_LARGE: `This video is over ${String(PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES / 1_000_000)} MB, too large to add to the description from here.`,
  TOO_MANY: "This description already holds as many pictures as it can.",
  TOO_MANY_VIDEOS: "This description already holds as many videos as it can.",
  NOT_SAVED: "The description could not be saved.",
  UNDONE: "Taken out of the description",
  NOT_UNDONE: "The description changed since, so the picture stays in it.",
} as const;

/** How many times an edit is written again on the text as it stands before it gives up. */
const EDIT_TRIES = 3;

/** The file's own bytes, read from its `data:` URL. */
function fileOf(chip: FileChip): File {
  const base64 = chip.url.slice(chip.url.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0));
  return new File([bytes], chip.name, { type: chip.mediaType });
}

/** Why a keep failed, in the toast's words. */
const KEEP_FAILED_WORDS = {
  [PICTURE_KEEP_FAILURE.TOO_MANY]: ADD_WORDS.TOO_MANY,
  [PICTURE_KEEP_FAILURE.TOO_MANY_VIDEOS]: ADD_WORDS.TOO_MANY_VIDEOS,
  [PICTURE_KEEP_FAILURE.NOT_FOUND]: ADD_WORDS.NOT_SAVED,
  [PICTURE_KEEP_FAILURE.UNANSWERED]: ADD_WORDS.NOT_SAVED,
} as const;

/**
 * The `data:` URL the file is kept on the description as, or why it cannot be: a
 * recording as it is, within a sent video's bound, and a picture re-encoded
 * within a picture's.
 */
async function keptUrlOf(chip: FileChip): Promise<{ url: string } | { refused: string }> {
  if (isVideoDataUrl(chip.url)) {
    return fileOf(chip).size > PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES
      ? { refused: ADD_WORDS.VIDEO_TOO_LARGE }
      : { url: chip.url };
  }
  const encoded = await encodeImage(fileOf(chip), PICTURE_BOUNDS.MAX_BYTES);
  if (encoded === undefined) return { refused: ADD_WORDS.NOT_A_PICTURE };
  return { url: `data:${encoded.mediaType};base64,${encoded.base64}` };
}

/** A picture's words: the name the viewer saves it by, without its extension. */
function wordsOf(chip: FileChip): string {
  const dot = chip.name.lastIndexOf(".");
  return dot > 0 ? chip.name.slice(0, dot) : chip.name;
}

/** The description's text after an edit written on whatever it stands as now; what refused it where no edit saved: the answer that refused it, or the condition where nothing more was said. */
async function edited(
  save: (base: string, value: string) => Promise<TasksEditAnswer>,
  change: (text: string) => string | undefined,
  known: string,
): Promise<string | { readonly refused: unknown }> {
  let base = known;
  for (let tried = 0; tried < EDIT_TRIES; tried += 1) {
    const value = change(base);
    if (value === undefined) return { refused: FAILURE_CONDITION.NOT_KEPT };
    const answer = await save(base, value);
    if ("saved" in answer) return value;
    if (!("conflict" in answer)) return { refused: answer };
    base = answer.conflict.current;
  }
  return { refused: FAILURE_CONDITION.CONFLICT };
}

/**
 * The viewer's Add to description, for a transcript drawn on a plan's page; none
 * where it is drawn off one, as an agent with no plan's is, nor while the
 * account has Descriptions off.
 */
export function useAddToDescription(): ViewerAction | undefined {
  const descriptionsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true;
  const page = useTaskMentions();
  const { mutateAsync: sendEdit } = useMutation(actMutation(ACT_KIND.TASKS_EDIT));
  const { mutateAsync: sendKeep } = useMutation(actMutation(ACT_KIND.TASKS_PICTURE_KEEP));
  const queryClient = useQueryClient();
  const toast = useToast();
  const working = useWorkingToast();
  return useMemo(() => {
    const taskId = holderTaskId(page?.holder);
    if (!descriptionsOn || page === undefined || taskId === undefined || page.workspace === "") {
      return undefined;
    }
    const { workspace } = page;
    const save = (base: string, value: string): Promise<TasksEditAnswer> =>
      sendEdit({ taskId: taskId, edit: { document: { base, value } } }).catch(
        unreachedAs(TASK_CALL_FAILURE.UNANSWERED),
      );
    const add = async (chip: FileChip) => {
      const settle = working(ADD_WORDS.ADDING);
      const failed = (words: string, cause: unknown, refused?: true) =>
        settle({
          words,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: {
            surface: FAILURE_SURFACE.DESCRIPTION_ADD,
            cause,
            about: { taskId },
            ...(refused === undefined ? {} : { refused }),
          },
        });
      const keeping = await keptUrlOf(chip);
      if ("refused" in keeping) return failed(keeping.refused, keeping.refused, true);
      const { url } = keeping;
      const kept = await sendKeep({ planId: taskId, picture: url }).catch(
        unreachedAs(PICTURE_KEEP_FAILURE.UNANSWERED),
      );
      if ("failure" in kept) return failed(KEEP_FAILED_WORDS[kept.failure], kept);
      keepPictureRead(queryClient, taskId, kept.id, url);
      const address = descriptionAttachmentAddress(
        { taskId: taskId, attachmentId: kept.id },
        workspace,
      );
      const line = taskPictureLine(wordsOf(chip), address);
      // Note that the edit is written on the description's words as the page last read
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
      if (typeof saved !== "string") return failed(ADD_WORDS.NOT_SAVED, saved.refused);
      const added = addition;
      const undo = async () => {
        const undone = await edited(save, (text) => withoutPictureLine(text, added), saved);
        toast(
          typeof undone !== "string"
            ? {
                replayUnmasked: true,
                words: ADD_WORDS.NOT_UNDONE,
                tone: STATUS_TONE.DANGER,
                hold: TOAST_HOLD.FAILED,
                failure: {
                  surface: FAILURE_SURFACE.DESCRIPTION_ADD,
                  cause: undone.refused,
                  about: { taskId },
                },
              }
            : {
                replayUnmasked: true,
                words: ADD_WORDS.UNDONE,
                tone: STATUS_TONE.COMPLETE,
                hold: TOAST_HOLD.DONE,
              },
        );
      };
      settle({ ...undoToast(ADD_WORDS.ADDED, () => void undo()), replayUnmasked: true });
    };
    return {
      label: ADD_LABEL,
      icon: <ImagePlusIcon aria-hidden="true" />,
      onPress: (chip: FileChip) => void add(chip),
    };
  }, [descriptionsOn, sendEdit, sendKeep, queryClient, page, toast, working]);
}

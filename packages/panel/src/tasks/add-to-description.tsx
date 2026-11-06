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

const ADD_LABEL = "Add to description";

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

const EDIT_TRIES = 3;

function fileOf(chip: FileChip): File {
  const base64 = chip.url.slice(chip.url.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0));
  return new File([bytes], chip.name, { type: chip.mediaType });
}

const KEEP_FAILED_WORDS = {
  [PICTURE_KEEP_FAILURE.TOO_MANY]: ADD_WORDS.TOO_MANY,
  [PICTURE_KEEP_FAILURE.TOO_MANY_VIDEOS]: ADD_WORDS.TOO_MANY_VIDEOS,
  [PICTURE_KEEP_FAILURE.NOT_FOUND]: ADD_WORDS.NOT_SAVED,
  [PICTURE_KEEP_FAILURE.UNANSWERED]: ADD_WORDS.NOT_SAVED,
} as const;

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

function wordsOf(chip: FileChip): string {
  const dot = chip.name.lastIndexOf(".");
  return dot > 0 ? chip.name.slice(0, dot) : chip.name;
}

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

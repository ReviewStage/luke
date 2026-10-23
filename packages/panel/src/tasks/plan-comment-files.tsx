import type { FileChip } from "@luke/features/attachment-model";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import type { PlanCommentFile } from "@luke/features/plan-comment-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { imageFiles } from "../feedback-images.js";
import { AttachedFileChips } from "./attached-file-chips.js";
import { readFiles, withFiles } from "./attached-files.js";

/**
 * plan-comment-files.tsx -- the files on a plan's comment: the ones a comment carries, drawn over its words, and the ones its field holds before it is sent.
 *
 * A comment's files are kept by the service beside the comment and named
 * on its entry by id; the window reads each one's bytes through the plan's
 * own attachment read, the one its pictures take, under the account, and
 * draws them as the agent box draws a sent message's files: a row of chips,
 * a picture by its thumbnail and any other file by its type's icon, each
 * opening over the window. A chip whose bytes have not landed, or whose read
 * failed, is drawn by its name alone.
 *
 * A comment's field takes files by its + (`attach-files-button.tsx`), a
 * paste of pictures, or a drop, read into the coding agent's file shape
 * (`attached-files.ts`) and held to the bounds a message to an agent is.
 */

/** A comment's files over its words, each read once as it is first drawn. */
export function CommentFiles({
  planId,
  files,
}: {
  planId: string;
  files: readonly PlanCommentFile[];
}): React.ReactNode {
  const { act } = useAct();
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  // The files asked for, so a thread read again, which hands down new arrays of the same files, reads none twice.
  const asked = useRef(new Set<string>());
  const urlsNow = useRef(urls);
  urlsNow.current = urls;
  useEffect(() => {
    let standing = true;
    for (const file of files) {
      if (asked.current.has(file.attachmentId)) continue;
      asked.current.add(file.attachmentId);
      void act(ACT_KIND.TASKS_PICTURE_READ, { planId, attachmentId: file.attachmentId }).then(
        (answer) => {
          if (!standing || "failure" in answer) return;
          const url = `data:${answer.contentType};base64,${answer.base64}`;
          setUrls((was) => new Map(was).set(file.attachmentId, url));
        },
        () => undefined,
      );
    }
    return () => {
      standing = false;
      // Note that a read cut short by the effect standing down is asked again by the next one.
      for (const file of files) {
        if (!urlsNow.current.has(file.attachmentId)) asked.current.delete(file.attachmentId);
      }
    };
  }, [act, planId, files]);

  const chips: FileChip[] = files.map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: urls.get(file.attachmentId) ?? "",
  }));
  return (
    <div className="comment-files">
      <AttachedFileChips files={chips} />
    </div>
  );
}

/** The files a comment's field holds before it is sent, and the ways it takes more and lets them go. */
export interface CommentAttaching {
  readonly attachments: readonly CodingAgentAttachment[];
  /** Why the last files handed to the field did not all come; nothing once they did. */
  readonly refusal: string | undefined;
  /** How many reads of handed files have not landed, which a send waits on. */
  readonly reading: number;
  readonly attach: (files: readonly File[]) => void;
  /** Takes the pictures among pasted files, answering whether there were any, so text pastes as it always does. */
  readonly paste: (files: readonly File[]) => boolean;
  readonly remove: (index: number) => void;
  /** The files the field holds this moment, for a callback that outlives the render it was made in. */
  readonly now: () => readonly CodingAgentAttachment[];
  /** Sets the files the field holds outright, as a send empties it and a send that failed puts them back. */
  readonly set: (attachments: readonly CodingAgentAttachment[]) => void;
}

/** The files a comment's field holds, read as they are handed to it and taken after the ones it holds. */
export function useCommentAttaching(): CommentAttaching {
  const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>([]);
  // The files held as of the last change, which a read that lands late is taken after.
  const held = useRef<readonly CodingAgentAttachment[]>([]);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [reading, setReading] = useState(0);
  const hold = (next: readonly CodingAgentAttachment[]) => {
    held.current = next;
    setAttachments(next);
  };
  const attach = (files: readonly File[]) => {
    if (files.length === 0) return;
    setReading((count) => count + 1);
    void readFiles(files)
      .then((read) => {
        // Note that the read is taken after whatever the field holds as it lands, so a chip taken off meanwhile stays off.
        const taken = withFiles(held.current, read);
        hold(taken.attachments);
        setRefusal(taken.refusal);
      })
      .finally(() => setReading((count) => count - 1));
  };
  return {
    attachments,
    refusal,
    reading,
    attach,
    now: () => held.current,
    paste: (files) => {
      const pasted = imageFiles(files);
      if (pasted.length === 0) return false;
      attach(pasted);
      return true;
    },
    remove: (index) => {
      setRefusal(undefined);
      hold(held.current.filter((_, at) => at !== index));
    },
    set: (next) => {
      setRefusal(undefined);
      hold(next);
    },
  };
}

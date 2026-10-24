import type { FileChip } from "@luke/features/attachment-model";
import type { PlanCommentFile } from "@luke/features/plan-comment-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { AttachedFileChips } from "./attached-file-chips.js";

/**
 * plan-comment-files.tsx -- the files a plan's comment carries, drawn over its words.
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
 * paste of pictures, or a drop, as every message box does
 * (`../use-attached-files.ts`), held to the bounds a message to an agent is.
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

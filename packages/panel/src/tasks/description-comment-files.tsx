import type { FileChip } from "@repo/features/attachment-model";
import type { DescriptionCommentFile } from "@repo/features/description-comment-wire";
import { ACT_KIND } from "@repo/host/acts";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useQueries } from "@tanstack/react-query";
import { sendAct } from "../act.js";
import { pictureQuery } from "../picture-query.js";
import { AttachedFileChips } from "./attached-file-chips.js";

/**
 * description-comment-files.tsx -- the files a description's comment carries, drawn over its words.
 *
 * A comment's files are kept by the service beside the comment and named
 * on its entry by id; the window reads each one's bytes through the description's
 * own attachment read, the one its pictures take and keep it under
 * (`../picture-query.ts`), under the account, and
 * draws them as the agent box draws a sent message's files: a row of chips,
 * a picture by its thumbnail and any other file by its type's icon, each
 * opening over the window. A chip whose bytes have not landed, or whose read
 * failed, is drawn by its name alone.
 *
 * A comment's field takes files by its + (`attach-files-button.tsx`), a
 * paste of pictures, or a drop, as every message box does
 * (`../use-attached-files.ts`), held to the bounds a message to an agent is.
 */

/** How a plan's comment's file is read: as the plan's attachment, which its pictures read too. */
function readDescriptionFile(planId: string, attachmentId: string) {
  return sendAct(ACT_KIND.TASKS_PICTURE_READ, { planId, attachmentId });
}

/** A comment's files over its words, each read once and kept as the plan's pictures are (`../picture-query.ts`). */
export function CommentFiles({
  planId,
  files,
}: {
  planId: string;
  files: readonly DescriptionCommentFile[];
}): React.ReactNode {
  const reads = useQueries({
    queries: files.map((file) => pictureQuery(planId, file.attachmentId, readDescriptionFile)),
    combine: (results) => results.map((result) => result.data),
  });
  const chips: FileChip[] = files.map((file, index) => {
    const read = reads[index];
    return {
      name: file.name,
      mediaType: file.mediaType,
      url: read?.kind === PICTURE_STATE.READY ? read.url : "",
    };
  });
  return (
    <div className="comment-files mx-0 mt-tight-gap mb-item-gap">
      <AttachedFileChips files={chips} />
    </div>
  );
}

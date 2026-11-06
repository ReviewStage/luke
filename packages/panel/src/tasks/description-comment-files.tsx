import type { FileChip } from "@repo/features/attachment-model";
import type { DescriptionCommentFile } from "@repo/features/description-comment-wire";
import { ACT_KIND } from "@repo/host/acts";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useQueries } from "@tanstack/react-query";
import { sendAct } from "../act.js";
import { pictureQuery } from "../picture-query.js";
import { AttachedFileChips } from "./attached-file-chips.js";

function readDescriptionFile(planId: string, attachmentId: string) {
  return sendAct(ACT_KIND.TASKS_PICTURE_READ, { planId, attachmentId });
}

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

import type { ReactNode } from "react";
import { FileInputIcon } from "../../icons/icons.js";
import { IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";
import { CodeCard } from "./code-card.js";

/**
 * file-code-card.tsx -- lines of a file as a `CodeCard`: the file named in its header, the file's opening as a button of its own beside the one Copy, over the lines the caller draws.
 *
 * An Inbox item's code stands in it. The header's title is the caller's
 * chip naming the file and its lines, which opens the file too, and the
 * button beside it opens it again for a reader who looks to the header's
 * end for what the card does.
 */

/** What the card's button that opens the whole file is called. */
const OPEN_FILE_LABEL = "Open file";

/** A file's lines in a code card, headed by the file and its opening; no opening where `onOpen` is none. */
export function FileCodeCard({
  title,
  label,
  copied,
  copy,
  onOpen,
  body,
  data,
}: {
  /** The file and the lines as the caller names them, a chip that opens the file where it can be. */
  title: ReactNode;
  /** The card's accessible name: the file's path and its lines in words. */
  label: string;
  /** The lines a copy carries; none where the card holds no lines yet, which draws no Copy. */
  copied: string | undefined;
  /** The caller's platform act that puts words on the clipboard (`CopyButton`). */
  copy: (text: string) => Promise<void>;
  /** Opens the file on the card's lines; none where the file cannot be opened, which draws no button. */
  onOpen: (() => void) | undefined;
  /** What stands under the header: the lines, or why there are none. */
  body: ReactNode;
  /** Data attributes the card is found by. */
  data?: Readonly<Record<`data-${string}`, string>> | undefined;
}): React.JSX.Element {
  return (
    <CodeCard
      title={title}
      label={label}
      data={data}
      copied={copied}
      copy={copy}
      actions={
        onOpen === undefined ? null : (
          <Tooltip label={OPEN_FILE_LABEL}>
            <IconButton
              icon={<FileInputIcon aria-hidden="true" />}
              label={OPEN_FILE_LABEL}
              onClick={onOpen}
            />
          </Tooltip>
        )
      }
      body={body}
    />
  );
}

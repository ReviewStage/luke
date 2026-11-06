import type { ReactNode } from "react";
import { FileInputIcon } from "../../icons/icons.js";
import { IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";
import { CodeCard } from "./code-card.js";

const OPEN_FILE_LABEL = "Open file";

export function FileCodeCard({
  title,
  label,
  copied,
  copy,
  onOpen,
  body,
  data,
}: {
  title: ReactNode;
  label: string;
  copied: string | undefined;
  copy: (text: string) => Promise<void>;
  onOpen: (() => void) | undefined;
  body: ReactNode;
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

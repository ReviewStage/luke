import { CopyIcon, DownloadIcon, EllipsisIcon, IconButton, useMenu } from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import { ClipboardCopyIcon, FolderTreeIcon } from "lucide-react";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { Tooltip } from "../tooltip.js";
import { WHOLE_TEXT, type WholeText } from "./file-tab-model.js";

/**
 * file-menu.tsx -- the File view bar's ⋯: what is done with the file shown.
 *
 * The window's own menu (`../desktop/action-menu.tsx`), as the task's ⋯
 * draws it: the file's name, its path, or its whole text copied, said in the copy
 * toast as every copy from a menu is, and the file saved where the system's
 * save dialog chooses (`appPlatform().saveFile`). The text is read only
 * when it is asked for, raw and in one read, so what is copied or saved is
 * the file as it holds it, its long lines uncut, rather than the lines the
 * tab draws, which the service cuts.
 *
 * Every bar over lines hangs the same ⋯ with its own actions (`BarMenu`),
 * an agent's Files changed view and a page's source alike; how the lines
 * are drawn is set from the View settings button beside it
 * (`view-settings.tsx`), never from the ⋯.
 */

/** What the menu says where the file's text could not be read, or the service will not carry it whole. */
const UNREAD = "Could not read the whole file.";
const REFUSED = "This file is too large to copy whole. Open it on GitHub instead.";

/** What copying a file's path says, from a header's path or a ⋯ alike, so one copy reads the same wherever it is pressed. */
export const PATH_COPY_WORDS = {
  COPY_PATH: "Copy path",
  COPY_OLD_PATH: "Copy old path",
  COPY_NEW_PATH: "Copy new path",
  PATH_COPIED: "Path copied",
} as const;

/** The ⋯'s Copy path for a file, from the repository's root. */
export function copyPathAction(
  path: string,
  copy: (text: string, words: string) => void,
): MenuAction {
  return {
    label: PATH_COPY_WORDS.COPY_PATH,
    icon: <FolderTreeIcon aria-hidden="true" />,
    onSelect: () => copy(path, PATH_COPY_WORDS.PATH_COPIED),
  };
}

/** The ⋯ at the end of a bar over lines: the actions given. */
export function BarMenu({
  label,
  actions,
}: {
  /** What the ⋯ and its menu are called. */
  label: string;
  actions: readonly MenuAction[];
}): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <Tooltip label={label}>
        <IconButton icon={<EllipsisIcon />} label={label} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={[actions]} onClose={menu.close} />
      )}
    </>
  );
}

/** Saves text where the system's save dialog chooses, as a file of the name given, the save or its failure said in a toast. */
export function useSaveText(): (name: string, text: string) => Promise<void> {
  const show = useToast();
  return (name, text) =>
    appPlatform()
      .saveFile({ name, text })
      .then(
        (saved) => {
          if (saved) show({ words: "File saved", tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
        },
        () =>
          show({
            words: "Could not save the file.",
            tone: TOAST_TONE.FAILED,
            hold: TOAST_HOLD.FAILED,
          }),
      );
}

export function FileMenu({
  path,
  ready,
  readText,
}: {
  /** The file shown, from the repository's root. */
  path: string;
  /** Whether the file was read, so its text can be: a file refused or still loading offers its name alone. */
  ready: boolean;
  /** The file's whole text, read a window at a time, or why it is not at hand. */
  readText: () => Promise<WholeText>;
}): React.JSX.Element {
  const copyWithToast = useCopyToast();
  const show = useToast();
  const saveText = useSaveText();
  const name = fileName(path);

  const withText = (use: (text: string) => void) =>
    readText().then((whole) => {
      if (whole.kind === WHOLE_TEXT.READ) use(whole.text);
      else {
        const words = whole.kind === WHOLE_TEXT.REFUSED ? REFUSED : UNREAD;
        show({ words, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      }
    });

  return (
    <BarMenu
      label="File actions"
      actions={[
        {
          label: "Copy file name",
          icon: <CopyIcon />,
          onSelect: () => copyWithToast(name, "File name copied"),
        },
        copyPathAction(path, copyWithToast),
        {
          label: "Copy file contents",
          icon: <ClipboardCopyIcon aria-hidden="true" />,
          disabled: !ready,
          onSelect: () => withText((text) => copyWithToast(text, "File contents copied")),
        },
        {
          label: "Download file",
          icon: <DownloadIcon />,
          disabled: !ready,
          onSelect: () => withText((text) => saveText(name, text)),
        },
      ]}
    />
  );
}

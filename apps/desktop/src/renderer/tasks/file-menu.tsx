import { appPlatform } from "@luke/panel/app-platform";
import { useFileViewSettings } from "@luke/panel/tasks/file-view-settings";
import { TOAST_HOLD, TOAST_TONE, useToast } from "@luke/panel/toast";
import { CopyIcon, DownloadIcon, EllipsisIcon, IconButton, useMenu } from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import { ClipboardCopyIcon, ListOrderedIcon, WrapTextIcon } from "lucide-react";
import { useCopyToast } from "../copy-feedback";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { Tooltip } from "../tooltip";
import { WHOLE_TEXT, type WholeText } from "./file-tab-model";

/**
 * file-menu.tsx -- the File view bar's ⋯: what is done with the file shown, then how every File tab draws its lines.
 *
 * The window's own menu (`../desktop/action-menu.tsx`), as the task's ⋯
 * draws it: the file's name or its whole text copied, said in the copy
 * toast as every copy from a menu is; the file saved where the system's
 * save dialog chooses (`appPlatform().saveFile`); and, under a rule, the
 * File tabs' two settings as checks (`file-view-settings.ts`). The text is
 * read only when it is asked for, raw and in one read, so what is copied
 * or saved is the file as it holds it, its long lines uncut, rather than
 * the lines the tab draws, which the service cuts.
 *
 * An agent's Files changed view hangs the same menu with its own actions
 * over the same two settings (`LinesMenu`), so a diff's lines are numbered
 * and wrapped as every File tab's are, and adds the diff's own two under
 * them (`DiffLooks`).
 */

/** What the menu says where the file's text could not be read, or the service will not carry it whole. */
const UNREAD = "Could not read the whole file.";
const REFUSED = "This file is too large to copy whole. Open it on GitHub instead.";

/**
 * The ⋯ at the end of a bar over lines: the actions given, then, under a
 * rule, the File tabs' two settings as checks, which every run of lines
 * drawn in the panel's code type follows, and any settings of the bar's own
 * after them.
 */
export function LinesMenu({
  label,
  actions,
  looks = [],
}: {
  /** What the ⋯ and its menu are called. */
  label: string;
  actions: readonly MenuAction[];
  /** Settings only this bar's lines follow, as checks under the File tabs' own. */
  looks?: readonly MenuAction[];
}): React.JSX.Element {
  const menu = useMenu(true);
  const { settings, change } = useFileViewSettings();
  const groups: readonly (readonly MenuAction[])[] = [
    actions,
    [
      {
        label: "Line numbers",
        icon: <ListOrderedIcon aria-hidden="true" />,
        checked: settings.lineNumbers,
        onSelect: () => change("lineNumbers", !settings.lineNumbers),
      },
      {
        label: "Word wrap",
        icon: <WrapTextIcon aria-hidden="true" />,
        checked: settings.wordWrap,
        onSelect: () => change("wordWrap", !settings.wordWrap),
      },
      ...looks,
    ],
  ];

  return (
    <>
      <Tooltip label={label}>
        <IconButton icon={<EllipsisIcon />} label={label} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={groups} onClose={menu.close} />
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
    <LinesMenu
      label="File actions"
      actions={[
        {
          label: "Copy file name",
          icon: <CopyIcon />,
          onSelect: () => copyWithToast(name, "File name copied"),
        },
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

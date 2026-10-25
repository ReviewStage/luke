import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { TaskFileRequest } from "@luke/features/task-wire";
import type { TaskCode, TasksFileAnswer } from "@luke/features/tasks-view";
import { readingWords } from "@luke/features/words";
import { APP_COMMAND, FILES_CHANGED_KEY, filesChangedKeyFor } from "@luke/settings/shortcuts";
import {
  ANNOUNCE,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  type ErrorStatePlacement,
  FILL_ELEMENT,
  Fill,
  SCROLL_FADE,
  ScrollArea,
  SpinnerRegion,
  TabNotice,
} from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { typingInto } from "./changes-list.js";
import { CodeSnippet } from "./code-snippet.js";
import { FileNoteAnnotation, type FileNotes, type NoteLines, noteLineOf } from "./file-note.js";
import {
  FILE_READ,
  type FileRead,
  type FileText,
  lineCountOf,
  refusalLine,
  refusalPasses,
} from "./file-tab-model.js";
import { useFileViewSettings } from "./file-view-settings.js";
import { useMentionDrop, useTaskMentions } from "./task-mentions.js";
import type { OpenFile } from "./use-side-panel.js";
import { WholeFile, type WholeFileHandle, type WholeFileNote } from "./whole-file.js";

/**
 * file-tab.tsx -- a File tab: one whole file of the open task's repository, opened from a snippet Luke showed, its lines lit and scrolled into view.
 *
 * The Code tab's cards hold the lines a snippet pointed at and a few around
 * them; opening a card's file draws the file whole here, numbered and
 * coloured as every code is, by Pierre's diffs (`whole-file.tsx`). The file
 * is read through the service whole (\`ACT_KIND.TASKS_FILE\`, raw), since
 * Pierre numbers a file from its first line, and drawn only near the view,
 * however long. A file an inbox item's code opened is read at the commit the
 * agent named, so its lines are the ones it meant, and one a snippet opened
 * at the commit Luke's checkout stood at when he read it, so a file main has
 * since moved or deleted still reads as he showed it. Note that the service
 * otherwise reads the file from GitHub as it stands now on the repository's
 * default branch, so the tab first reads one line of it, which names the
 * commit the head stands at, and then the whole text at that commit, so a
 * mention of its lines and its page on GitHub name the lines it draws. A file
 * changed since a snippet was shown is drawn as it is now, the snippet's
 * lines lit where they fall, and a file gone, or one the service refuses,
 * says so in the file's place, over the lines Luke showed of it where the
 * task holds them. Under the last line of each range Luke showed with a
 * note stands his note on it (\`file-note.tsx\`), on the file and on those
 * lines alike, or the chip it is put away behind while Minimize inline
 * comments is on, which \`I\` turns as it does in Files changed. The tab
 * draws no heading of its own: the File view's bar over it names the file
 * and offers what is done with it (\`file-view.tsx\`), told how the read
 * stands as it moves. The lines are drawn as every code is
 * (\`file-view-settings.ts\`), and ⌘F finds in the whole file, drawn or not
 * (\`file-find.ts\`). Every line here is the repository's, so the root is
 * left out of the screen recording (\`ph-no-capture\`) as a second line
 * behind the recording's text masking.
 */

/** What stands over the lines Luke showed, drawn where the file cannot be. */
const SNIPPET_LABEL = "The lines Luke showed, from his copy of the repository";

/** The first line of a file, the one read to learn the commit the head stands at. */
const FIRST_LINE = { firstLine: 1, lastLine: 1 } as const;

/** Reads a file of the tab's: one window of its lines, or, raw, its whole text; the answer, or a rejection where main refused the act. */
export type ReadFileWindow = (window: TaskFileRequest) => Promise<TasksFileAnswer>;

/** The read a refusal or a failure stands for, from an answer that carried no file. */
function notRead(answer: TasksFileAnswer): FileRead {
  if ("refusal" in answer) {
    return { kind: FILE_READ.REFUSED, refusal: answer.refusal, branch: answer.branch };
  }
  return { kind: FILE_READ.FAILED };
}

/**
 * The whole text of `path` through `read`: at `commit` where the tab is
 * pinned to one, and otherwise at the commit its first line names as the
 * head's, so the text and the commit a mention names are one.
 */
async function readWholeText(
  read: ReadFileWindow,
  path: string,
  pinned: string | undefined,
): Promise<FileRead> {
  let commit = pinned;
  if (commit === undefined) {
    const head = await read({ path, ...FIRST_LINE });
    if (!("file" in head)) return notRead(head);
    commit = head.file.commit;
  }
  const whole = await read({
    path,
    ...FIRST_LINE,
    raw: true,
    ...(commit === undefined || pinned !== undefined ? {} : { ref: commit }),
  });
  if (!("text" in whole)) return notRead(whole);
  const { repository, branch, text } = whole.text;
  const file: FileText = { repository, branch, commit, text, lineCount: lineCountOf(text) };
  return { kind: FILE_READ.READY, ...file };
}

/** The notes shown under their chips while Minimize inline comments is on, by call, forgotten whenever the setting turns. */
function useShownNotes(minimize: boolean) {
  const [shown, setShown] = useState<{ readonly of: boolean; readonly calls: ReadonlySet<string> }>(
    {
      of: minimize,
      calls: new Set(),
    },
  );
  // Note that a setting turned forgets what was shown at once, as it is drawn, so turning it back shows nothing again.
  if (shown.of !== minimize) setShown({ of: minimize, calls: new Set() });
  const show = useCallback((callId: string, open: boolean) => {
    setShown((was) => {
      const calls = new Set(was.calls);
      if (open) calls.add(callId);
      else calls.delete(callId);
      return { of: was.of, calls };
    });
  }, []);
  return { calls: shown.of === minimize ? shown.calls : new Set<string>(), show };
}

/**
 * The file drawn whole, the lines it was opened on lit and centred each time
 * it is opened, and each of Luke's notes under its line, as its card or its
 * chip; the lines of the note the pointer or the keyboard is on lit in
 * their place.
 */
function FileTextView({
  file,
  held,
  notes,
  handleRef,
}: {
  file: OpenFile;
  held: FileText;
  notes: FileNotes;
  handleRef: React.RefObject<WholeFileHandle | null>;
}): React.JSX.Element {
  const [litNote, setLitNote] = useState<NoteLines | undefined>(undefined);
  const { settings } = useFileViewSettings();
  const minimize = settings.diffMinimizeComments;
  const shown = useShownNotes(minimize);
  const drawn: FileNotes = { ...notes, onLight: setLitNote };
  const placed: WholeFileNote[] = notes.notes.flatMap((note) => {
    const line = noteLineOf(note, held.lineCount);
    if (line === undefined) return [];
    return [
      {
        key: note.callId,
        line,
        content: (
          <div className="whole-file-note whitespace-normal py-item-gap pr-list-inset pl-0">
            <FileNoteAnnotation
              note={note}
              notes={drawn}
              minimized={
                minimize
                  ? {
                      shown: shown.calls.has(note.callId),
                      onShown: (open) => shown.show(note.callId, open),
                    }
                  : undefined
              }
            />
          </div>
        ),
      },
    ];
  });
  return (
    <WholeFile
      name={file.path}
      text={held.text}
      revision={held.commit ?? held.branch}
      lit={litNote ?? file.range}
      notes={placed}
      findFrom={file.range?.startLine ?? 1}
      reveal={{ range: file.range ?? { startLine: 1, endLine: 1 }, at: file.opened }}
      handleRef={handleRef}
    />
  );
}

/**
 * Why a file read is not drawn: a read that did not land, or a refusal that
 * may pass, as a read failure with Retry; any other refusal in the notice's
 * own ink, with Open Settings where signing in is what it waits on.
 */
function ReadNotice({
  read,
  commit,
  onRetry,
  place,
}: {
  read: Exclude<FileRead, { kind: typeof FILE_READ.READY | typeof FILE_READ.READING }>;
  /** The commit the file was read at, where one pinned it. */
  commit: string | undefined;
  onRetry: () => void;
  place: ErrorStatePlacement;
}): React.JSX.Element {
  const retries = read.kind === FILE_READ.FAILED || refusalPasses(read.refusal);
  // Note that a read failure and a centred refusal are said by the components that draw them, so only this line's own words are said here.
  const refusal =
    retries || place === ERROR_STATE_PLACEMENT.CENTRED
      ? ""
      : refusalLine(read.refusal, read.branch, commit);
  useAnnounceShown(ANNOUNCE.ALERT, refusal);
  if (retries) {
    const line =
      read.kind === FILE_READ.FAILED
        ? "The file could not be read."
        : refusalLine(read.refusal, read.branch, commit);
    return (
      <ErrorState onRetry={onRetry} placement={place}>
        {line}
      </ErrorState>
    );
  }
  if (place === ERROR_STATE_PLACEMENT.CENTRED) {
    return <EmptyState alert>{refusalLine(read.refusal, read.branch, commit)}</EmptyState>;
  }
  return <p className="m-0">{refusal}</p>;
}

/** A file's lines as their mention's chip names them: the file's name and the lines, `app.ts:12–20`, or the one line. */
function linesName(path: string, lines: { readonly startLine: number; readonly endLine: number }) {
  const span =
    lines.startLine === lines.endLine
      ? String(lines.startLine)
      : `${lines.startLine}–${lines.endLine}`;
  return `${fileName(path)}:${span}`;
}

/**
 * The tab: the file, or why it is not shown over the lines Luke showed of
 * it. The file is read once for the tab, which is drawn anew for another
 * file or commit (\`file-view.tsx\`), and opened again on other lines only
 * scrolls to them.
 */
export function FileTab({
  file,
  snippet,
  notes,
  readFile,
  onRead,
}: {
  file: OpenFile;
  /** The lines Luke showed of the file, drawn where the file cannot be. */
  snippet: TaskCode | undefined;
  /** Luke's notes on the file's lines, each drawn under the last line of its range. */
  notes: FileNotes;
  readFile: ReadFileWindow;
  /** Hears how the read of the file stands each time it moves, the bar over the tab offering what it allows. */
  onRead: (read: FileRead) => void;
}): React.JSX.Element {
  const [read, setRead] = useState<FileRead>({ kind: FILE_READ.READING });
  const page = useTaskMentions();
  const drop = useMentionDrop();
  const handle = useRef<WholeFileHandle | null>(null);
  const viewSettings = useFileViewSettings();
  const told = useRef(onRead);
  told.current = onRead;
  useEffect(() => {
    told.current(read);
  }, [read]);

  // Note that the read goes through a ref to the latest file and door, so it
  // asks again only on a Retry, never because a parent drew a fresh door.
  const latest = useRef({ file, readFile });
  latest.current = { file, readFile };
  // Each read counted, so only the latest one asked lands.
  const asks = useRef(0);
  const readWhole = useCallback(() => {
    asks.current += 1;
    const asked = asks.current;
    setRead({ kind: FILE_READ.READING });
    const { file: open, readFile: reader } = latest.current;
    const land = (next: FileRead) => {
      if (asks.current === asked) setRead(next);
    };
    readWholeText(reader, open.path, open.commit).then(land, () =>
      land({ kind: FILE_READ.FAILED }),
    );
  }, []);
  useEffect(() => {
    readWhole();
    // Note that a read still out when the tab is taken down lands nowhere.
    return () => {
      asks.current += 1;
    };
  }, [readWhole]);

  // ⌥⌘K hands the agent's message box the lines picked here, pinned to the commit they were read at.
  const commit = read.kind === FILE_READ.READY ? (read.commit ?? file.commit) : undefined;
  const mentionLines =
    page === undefined || drop === undefined || commit === undefined
      ? undefined
      : () => {
          const lines = handle.current?.pickedLines();
          if (lines === undefined) return;
          const mention = { kind: MENTION_KIND.FILE, path: file.path, lines: { commit, ...lines } };
          drop({
            name: linesName(file.path, lines),
            target: encodeMention(mention, page.doors.place),
          });
        };
  useAppCommand(APP_COMMAND.MENTION_LINES, mentionLines);

  // I turns Minimize inline comments, as it does in Files changed, while the keys are the tab's.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || typingInto(event.target)) return;
    if (filesChangedKeyFor(event) !== FILES_CHANGED_KEY.MINIMIZE_COMMENTS) return;
    event.preventDefault();
    viewSettings.change("diffMinimizeComments", !viewSettings.settings.diffMinimizeComments);
  };

  return (
    // The tab only hears the key its lines answer while its focus is in them; the lines and the cards are the controls.
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="file-tab ph-no-capture bg-card-code"
      aria-label={file.path}
      onKeyDown={onKeyDown}
    >
      {read.kind === FILE_READ.READY ? (
        <FileTextView file={file} held={read} notes={notes} handleRef={handle} />
      ) : read.kind === FILE_READ.READING ? (
        <SpinnerRegion delay label={readingWords("the file")} />
      ) : snippet === undefined ? (
        <ReadNotice
          read={read}
          commit={file.commit}
          onRetry={readWhole}
          place={ERROR_STATE_PLACEMENT.CENTRED}
        />
      ) : (
        <>
          <TabNotice>
            <ReadNotice
              read={read}
              commit={file.commit}
              onRetry={readWhole}
              place={ERROR_STATE_PLACEMENT.INLINE}
            />
          </TabNotice>
          <p className="m-0 px-list-inset pt-row-inset pb-tight-gap text-caption-inline text-muted-foreground">
            {SNIPPET_LABEL}
          </p>
          {/* The lines and their notes scroll up and down in the room the notice leaves; unwrapped lines scroll sideways in Pierre's own way. */}
          <ScrollArea fade={SCROLL_FADE.START}>
            <CodeSnippet code={snippet} notes={notes} />
          </ScrollArea>
        </>
      )}
    </Fill>
  );
}

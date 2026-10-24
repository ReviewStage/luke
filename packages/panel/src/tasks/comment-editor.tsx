import { PULL_REQUEST_WRITE_BOUNDS } from "@luke/features/pull-request-write-wire";
import { BLOCK_MENU_GROUP, COMPOSER_LOOK, ComposerFrame, IconButton, Tooltip } from "@luke/ui";
import { FileDiffIcon } from "@luke/ui/icons";
import { markdownClass } from "@luke/ui/markdown-class";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { modEnterSends } from "../enter-sends.js";
import {
  FINISH,
  type Finish,
  PLACEMENT_END,
  type PlanEditorHandle,
} from "../plan-editor/contract.js";
import type { OwnBlock } from "./block-picker.js";
import { MarkdownEditor } from "./markdown-editor.js";
import { fencedBlock } from "./markdown-fence.js";

/**
 * comment-editor.tsx -- words a member sends to GitHub as Markdown, written on the plan's editor: a pull request's comment, a review's, a line's, a thread's reply, and a pending comment's edit.
 *
 * The words are written where they are drawn (`markdown-editor.tsx`), so
 * no Preview stands beside them: the format toolbar over selected words,
 * Turn into among it, the `/` menu, and the writing chords are the editor's
 * own, and each block left untouched is handed back as it was written, so
 * an edit of a comment changes only what was changed. ⌘↩ or Ctrl+↩ sends, a bare Enter adds a line, and Esc
 * lets go, where the owner answers either; the keys the editor took go no
 * further, so a menu's Esc never closes what holds the box. The owner holds
 * the words: a change it makes, such as letting them go once GitHub took
 * them, opens the editor again on what it now holds. A comment on lines of
 * the head offers a suggestion, from `/` and from a press over the words:
 * GitHub's ```suggestion block holding those lines as they read now, drawn
 * as a suggested change. GitHub takes no more than its bound for a comment,
 * so words past it say by how much, and the owner sends none.
 */

/** The box's own words. */
const COMMENT_EDITOR_WORDS = {
  SUGGESTION: "Suggestion",
  ADD_SUGGESTION: "Add a suggestion",
  /** What the room the editor stands in is named. */
  room: (label: string) => `${label}, in Markdown`,
  /** What words past GitHub's bound say. */
  over: (by: number) =>
    `${by.toLocaleString("en-US")} ${by === 1 ? "character" : "characters"} over GitHub's limit.`,
} as const;

/** The info string GitHub reads a suggested change by. */
const SUGGESTION_INFO = "suggestion";

/** Whether the words are more than GitHub takes for a comment, which no box sends. */
export function overCommentBound(body: string): boolean {
  return body.length > PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS;
}

/** The suggestion a comment on `lines` offers in its `/` menu: GitHub's suggestion block holding them as they read now. */
function suggestionBlock(lines: string): OwnBlock {
  return {
    group: BLOCK_MENU_GROUP.BLOCKS,
    row: {
      id: SUGGESTION_INFO,
      label: COMMENT_EDITOR_WORDS.SUGGESTION,
      icon: <FileDiffIcon aria-hidden="true" />,
    },
    aliases: ["suggest"],
    markdown: fencedBlock(lines, SUGGESTION_INFO),
  };
}

/** The text the editor opens on, and the count that opens it anew, kept for an owner's words changed outside it. */
interface Opened {
  readonly markdown: string;
  readonly key: number;
}

/**
 * Note that the editor opens on its words once, so words the owner changed
 * outside it, rather than the ones it last handed over, open it again.
 */
function useOpened(value: string): { opened: Opened; said: (markdown: string) => void } {
  const handed = useRef(value);
  const opened = useRef<Opened>({ markdown: value, key: 0 });
  if (value !== handed.current) {
    handed.current = value;
    opened.current = { markdown: value, key: opened.current.key + 1 };
  }
  return {
    opened: opened.current,
    said: (markdown) => {
      handed.current = markdown;
    },
  };
}

/**
 * The words, named `label` to a reader, on the plan's editor in a text
 * field's frame; ⌘↩ or Ctrl+↩ is `onSubmit` and Esc `onCancel` where given,
 * `suggestion`, the lines a comment is on as they read at the head, offers
 * a suggestion where given, and `foot` stands under the words inside the
 * frame, as a reply's Cancel and send do (`reply-form.tsx`).
 */
export function CommentEditor({
  label,
  placeholder,
  value,
  onChange,
  busy,
  focus = false,
  onSubmit,
  onCancel,
  suggestion,
  fieldRef,
  foot,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Whether the words are on their way to GitHub. */
  busy: boolean;
  /** Whether the words take the keyboard as they open, at their end, once they stand in the window. */
  focus?: boolean | undefined;
  /** What ⌘↩ or Ctrl+↩ in the words does; none passes it on. */
  onSubmit?: (() => void) | undefined;
  /** What Esc in the words does; none passes it on. */
  onCancel?: (() => void) | undefined;
  /** The lines a comment is on as they read at the head, which a suggestion holds for the member to change; none offers no suggestion. */
  suggestion?: string | undefined;
  /** Where the words' own element is kept once the editor stands, for an owner that hands it the focus as it opens. */
  fieldRef?: RefObject<HTMLElement | null> | undefined;
  /** What stands under the words inside the frame, the box's own foot. */
  foot?: ReactNode;
}): React.JSX.Element {
  const { opened, said } = useOpened(value);
  const handle = useRef<PlanEditorHandle | undefined>(undefined);
  const room = useRef<HTMLElement>(null);
  // Whether the last key the editor finished on is one no owner answers, which goes on as an untaken key does.
  const unanswered = useRef(false);
  const block = suggestion === undefined ? undefined : suggestionBlock(suggestion);
  const over = value.length - PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS;

  // Note that a box drawn into a note the diff stands only once it draws again takes the keyboard once it stands in the window.
  useEffect(() => {
    const placed = room.current;
    if (!focus || placed === null || placed.isConnected) return undefined;
    const standing = new MutationObserver(() => {
      if (!placed.isConnected) return;
      standing.disconnect();
      handle.current?.focusAt(PLACEMENT_END);
    });
    standing.observe(document.body, { childList: true, subtree: true });
    return () => standing.disconnect();
  }, [focus]);

  useEffect(() => {
    if (fieldRef !== undefined) {
      fieldRef.current = room.current?.querySelector<HTMLElement>('[role="textbox"]') ?? null;
    }
  });

  const finish = (how: Finish) => {
    const answer = how === FINISH.SUBMIT ? onSubmit : onCancel;
    unanswered.current = answer === undefined;
    answer?.();
  };

  return (
    <div className="comment-editor">
      <ComposerFrame
        look={COMPOSER_LOOK.INPUT}
        className="comment-editor-frame"
        aria-busy={busy}
        onKeyDown={(event) => {
          const finishing = event.key === "Escape" || modEnterSends(event);
          if (!finishing || !event.defaultPrevented) return;
          // Note that a key the editor took, a menu's Esc or an answered finish, is the box's alone.
          if (unanswered.current) {
            unanswered.current = false;
            return;
          }
          event.stopPropagation();
        }}
      >
        {block === undefined ? null : (
          <div className="comment-editor-head">
            <Tooltip label={COMMENT_EDITOR_WORDS.ADD_SUGGESTION}>
              <IconButton
                icon={block.row.icon}
                label={COMMENT_EDITOR_WORDS.ADD_SUGGESTION}
                disabled={busy}
                keepFocus
                onClick={() => handle.current?.insertBlock({ markdown: block.markdown })}
              />
            </Tooltip>
          </div>
        )}
        <MarkdownEditor
          key={opened.key}
          markdown={opened.markdown}
          label={label}
          roomLabel={COMMENT_EDITOR_WORDS.room(label)}
          placeholder={placeholder}
          className={markdownClass("comment-editor-text")}
          focus={focus}
          placement={focus ? PLACEMENT_END : undefined}
          handle={handle}
          room={room}
          onDraft={(markdown) => {
            said(markdown);
            onChange(markdown);
          }}
          onFinish={(_section, how) => finish(how)}
          ownBlocks={block === undefined ? undefined : [block]}
        />
        {foot}
      </ComposerFrame>
      {over > 0 ? (
        <p className="comment-editor-note" role="alert">
          {COMMENT_EDITOR_WORDS.over(over)}
        </p>
      ) : null}
    </div>
  );
}

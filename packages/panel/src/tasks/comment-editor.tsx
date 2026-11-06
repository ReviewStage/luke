import { PULL_REQUEST_WRITE_BOUNDS } from "@repo/features/pull-request-write-wire";
import {
  ANNOUNCE,
  BLOCK_MENU_GROUP,
  COMPOSER_LOOK,
  ComposerFrame,
  IconButton,
  Tooltip,
} from "@repo/ui";
import { FileDiffIcon } from "@repo/ui/icons";
import { markdownClass } from "@repo/ui/markdown-class";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { enterSends } from "../enter-sends.js";
import {
  EDITOR_ROOT_SELECTOR,
  FINISH,
  type Finish,
  PLACEMENT_END,
  type DescriptionEditorHandle,
} from "../description-editor/contract.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import type { OwnBlock } from "./block-picker.js";
import { MarkdownEditor } from "./markdown-editor.js";
import { fencedBlock } from "./markdown-fence.js";

const COMMENT_EDITOR_WORDS = {
  SUGGESTION: "Suggestion",
  ADD_SUGGESTION: "Add a suggestion",
  room: (label: string) => `${label}, in Markdown`,
  over: (by: number) =>
    `${by.toLocaleString("en-US")} ${by === 1 ? "character" : "characters"} over GitHub's limit.`,
} as const;

const SUGGESTION_INFO = "suggestion";

export function overCommentBound(body: string): boolean {
  return body.length > PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS;
}

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

interface Opened {
  readonly markdown: string;
  readonly key: number;
}

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
  busy: boolean;
  focus?: boolean | undefined;
  onSubmit?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  suggestion?: string | undefined;
  fieldRef?: RefObject<HTMLElement | null> | undefined;
  foot?: ReactNode;
}): React.JSX.Element {
  const { opened, said } = useOpened(value);
  const handle = useRef<DescriptionEditorHandle | undefined>(undefined);
  const room = useRef<HTMLElement>(null);
  const unanswered = useRef(false);
  const block = suggestion === undefined ? undefined : suggestionBlock(suggestion);
  const over = value.length - PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS;
  useAnnounceShown(ANNOUNCE.ALERT, over > 0 ? COMMENT_EDITOR_WORDS.over(over) : "");

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
      fieldRef.current = room.current?.querySelector<HTMLElement>(EDITOR_ROOT_SELECTOR) ?? null;
    }
  });

  const finish = (how: Finish) => {
    const answer = how === FINISH.SUBMIT ? onSubmit : onCancel;
    unanswered.current = answer === undefined;
    answer?.();
  };

  return (
    <div className="flex min-w-0 flex-col gap-item-gap">
      <ComposerFrame
        look={COMPOSER_LOOK.INPUT}
        className="comment-editor-frame relative box-border min-h-comment-editor px-control-inset py-item-gap"
        aria-busy={busy}
        onKeyDown={(event) => {
          const finishing = event.key === "Escape" || enterSends(event);
          if (!finishing || !event.defaultPrevented) return;
          if (unanswered.current) {
            unanswered.current = false;
            return;
          }
          event.stopPropagation();
        }}
      >
        {block === undefined ? null : (
          <div className="comment-editor-head absolute top-ui-2 right-ui-2">
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
          className={markdownClass(
            "comment-editor-text text-body-size leading-reading text-foreground",
          )}
          focus={focus}
          placement={focus ? PLACEMENT_END : undefined}
          handle={handle}
          room={room}
          onDraft={(markdown) => {
            said(markdown);
            onChange(markdown);
          }}
          onFinish={(_section, how) => finish(how)}
          sendsOnEnter={onSubmit !== undefined}
          ownBlocks={block === undefined ? undefined : [block]}
        />
        {foot}
      </ComposerFrame>
      {over > 0 ? (
        <p className="comment-editor-note m-0 text-caption-inline text-destructive">
          {COMMENT_EDITOR_WORDS.over(over)}
        </p>
      ) : null}
    </div>
  );
}

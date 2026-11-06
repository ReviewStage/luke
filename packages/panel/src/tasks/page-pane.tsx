import { LINK_PLACE } from "@repo/features/link-grammar";
import {
  PAGE_FIND_ACT,
  PAGE_FIND_KEY,
  PAGE_FIND_TYPE,
  type PageFindAsk,
  pageFindAnswerSchema,
} from "@repo/features/page-find";
import { pageLinkPressSchema } from "@repo/features/page-link";
import {
  type FrameBox,
  PAGE_PICK_ACT,
  PAGE_PICK_TYPE,
  type PageMark,
  type PagePickAsk,
  type PagePicked,
  pagePickAnswerSchema,
} from "@repo/features/page-pick";
import { type PageLine, type PagePlace, pagePlaceId } from "@repo/features/page-wire";
import {
  DESCRIPTION_COMMENT_SCOPE,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { CodeLines, TasksPageSourceAnswer } from "@repo/features/tasks-view";
import { readingWords } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  CornerCount,
  cn,
  cssCustomProperties,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  IconButton,
  PaneBar,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  SidePanelIcon,
  SpinnerRegion,
  Tooltip,
  useResizeEdge,
} from "@repo/ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  GLYPH,
  MessageSquarePlusIcon,
  RotateCwIcon,
} from "@repo/ui/icons";
import type { DescriptionCommentsControl } from "@repo/ui/description-comments";
import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { appPlatform } from "../app-platform.js";
import { type DescriptionCommentPlace, useDraftWriter } from "../composer-drafts.js";
import { useCopyToast } from "../copy-feedback.js";
import { useLinkWorkspace } from "../copy-link-item.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { PAGE_COMMENTS_WIDTH, usePageCommentsWidth } from "../desktop/folded-groups.js";
import { usePaneSlide } from "../desktop/pane-motion.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import { unreadShown } from "../failure-report.js";
import {
  type FindChord,
  FindScope,
  type FindSource,
  type FindTally,
  useFindPress,
  useFindSource,
} from "../find-in-tab.js";
import { openPageInBrowserItem } from "../open-in-browser-item.js";
import { usePhoneRoom } from "../stage-room.js";
import { type HeldComment, PageReviewSection, usePageReview } from "./page-review.js";
import { PAGE_ROOM, usePageTheme } from "./page-theme.js";
import {
  COMMENTS_FILTER,
  type CommentsFilter,
  HeldCommentCard,
  ownWordsIn,
  PAGE_COMMENT_WORDS,
  PageCommentLayer,
  type PageCommentOn,
  PageComments,
  pageDraftPlace,
  threadsByElement,
  withQuote,
} from "./description-comments.js";
import { pageSourceQueryOptions, pageSourcesKey } from "./repository-reads.js";
import { opensAsLink, useOpenLink } from "./use-open-link.js";
import { useViewSettingsSheet, VIEW_SETTINGS_SCOPE, ViewSettingsButton } from "./view-settings.js";
import { WholeFile, type WholeFileNote } from "./whole-file.js";

/**
 * page-pane.tsx -- one page an agent wrote for the task, in the side panel: the page itself, drawn at the version chosen, and a bar to step between its versions and reload it.
 *
 * The page is HTML an agent wrote, so it is drawn in a frame from an address
 * the shell names (`appPlatform().pageFrameUrl`: on the desktop, the
 * `app-page:` scheme main serves under a policy of its own; on the web, the
 * service's frame of the version, which sends it on to the sandbox's own
 * site) and sandboxed to its scripts alone: no same origin, so it holds an opaque
 * origin with no storage and no reach into this window; no popups, forms,
 * top navigation, or modals; and no permission to delegate. The frame's
 * address names the version, so stepping to another loads that version,
 * and the newest is followed until the developer steps back from it. A
 * link out of the page is not followed in the frame, which may draw nothing
 * but a page: the frame hands its press to the pane
 * (`@repo/features/page-link`), which opens it as any link of the window
 * opens (`useOpenLink`), a site in the browser and a link of ours in the
 * window. Reload draws the page again. What the page draws is the
 * task's, so the pane is left out of the screen recording (`ph-no-capture`);
 * the recording could not see into the frame in any case.
 *
 * The bar's code toggle shows the version's HTML in the frame's place, as a
 * File tab draws a file (`file-tab.tsx`): the same numbered, colored lines
 * under the same settings, and ⌘F over them. The tab's one ⋯, the strip's,
 * offers its Copy link, then Open in browser, then Copy source while the
 * source is shown, then Reload page, which the page hands up on every
 * screen (`useTabActions`). Open in browser opens the page's own app
 * link, never the address the frame is drawn from (`open-in-browser-item.tsx`).
 * The frame's own read is the frame's alone, so the source is read again,
 * once a version, through main, which colors it as HTML
 * (`ACT_KIND.TASKS_PAGE_SOURCE`), and is held by the tab until Reload.
 * The tab stays on the source or the page while its versions are stepped.
 *
 * ⌘F over the page itself finds in the frame: no find of this window reaches
 * the page's words, so the find bar asks the frame, whose page is served
 * with a find of our own ahead of it (`@repo/features/page-find`), and
 * hears back its tally and its selection, from that frame alone and only
 * in the find's own shape.
 *
 * On a task's page the comments stand over the page itself
 * (`PageCommentLayer`): each element holding open threads is pinned with
 * their count, which opens them in a card by it. The bar's Comment enters
 * comment mode, the frame outlining the element under the pointer, and the
 * element pressed opens the comment by it, its words quoted in the field;
 * words selected in the page offer Reply, which quotes them into the
 * comment being written, or starts one on the element holding them. The
 * frame does its part with a script of our own ahead of the page
 * (`@repo/features/page-pick`), saying where each pinned element and the
 * words selected stand as the page moves; the pane takes a pick only from
 * the frame it drew, only while it asked, and only while the window holds a
 * press of the developer's, as it takes a link. The bar's last toggle, the
 * side panel's own glyph as a File tab's tree has it, opens the page's
 * comments pane on its right, listed as the plan's comments list lists the
 * plan's (`PageComments`); it slides in and out as the tree does, is
 * dragged wider or narrower by its left edge, one width for every page,
 * and shut by a drag past its least width. The bar's comment controls stand
 * at its end, Comment then that toggle, as the tree's toggle ends a File
 * tab's bar. A page an agent on no task showed has no comments.
 */

/** What a frame drawing a page lets it do: run its own scripts, and nothing else. */
export const PAGE_SANDBOX = "allow-scripts";

/** What the tab shows: the page drawn, or its HTML as source. */
const PAGE_VIEW = {
  PAGE: "page",
  SOURCE: "source",
} as const;

type PageView = (typeof PAGE_VIEW)[keyof typeof PAGE_VIEW];

/** Where a read of one version's source stands. */
const SOURCE_READ = {
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
} as const;

type SourceRead =
  | { readonly kind: typeof SOURCE_READ.READING }
  | { readonly kind: typeof SOURCE_READ.READY; readonly lines: CodeLines }
  | { readonly kind: typeof SOURCE_READ.FAILED };

const SOURCE_READING: SourceRead = { kind: SOURCE_READ.READING };

/** The find chord each key the frame hands on is. */
const CHORD_OF_KEY = {
  [PAGE_FIND_KEY.FIND]: APP_COMMAND.FIND,
  [PAGE_FIND_KEY.NEXT]: APP_COMMAND.FIND_NEXT,
  [PAGE_FIND_KEY.PREVIOUS]: APP_COMMAND.FIND_PREVIOUS,
} as const satisfies Record<(typeof PAGE_FIND_KEY)[keyof typeof PAGE_FIND_KEY], FindChord>;

/** Reads a message the frame posted as the find's answer, nothing for anything else the page posts. */
const readFindAnswer = Schema.decodeUnknownOption(pageFindAnswerSchema);

/** Reads a message the frame posted as a link pressed, nothing for anything else the page posts. */
const readLinkPress = Schema.decodeUnknownOption(pageLinkPressSchema);

/** Reads a message the frame posted as an element picked or a pick let go, nothing for anything else the page posts. */
const readPick = Schema.decodeUnknownOption(pagePickAnswerSchema);

/** The source's lines as the page's text. */
function sourceText(lines: CodeLines): string {
  return lines.map((line) => line.map((run) => run.text).join("")).join("\n");
}

/**
 * The find over the frame, as the find bar's source: each ask posted to the
 * frame's window, and its tally and selection heard back from that window
 * alone. The query last searched is asked again each time the frame loads,
 * a reload or another version, since a new document holds no find. A tally
 * heard while no query stands is a late answer to one cleared, and is let go.
 */
function useFrameFind(frame: RefObject<HTMLIFrameElement | null>) {
  const press = useFindPress();
  const [find] = useState(() => {
    const listeners = new Set<(tally: FindTally) => void>();
    const held = { query: "", selection: "" };
    const post = (ask: PageFindAsk) => frame.current?.contentWindow?.postMessage(ask, "*");
    const search = (query: string) => {
      held.query = query;
      post({ type: PAGE_FIND_TYPE, act: PAGE_FIND_ACT.SEARCH, query });
    };
    const source: FindSource = {
      search,
      step: (query, by) => {
        held.query = query;
        post({ type: PAGE_FIND_TYPE, act: PAGE_FIND_ACT.STEP, query, by });
      },
      clear: () => {
        held.query = "";
        post({ type: PAGE_FIND_TYPE, act: PAGE_FIND_ACT.CLEAR });
      },
      onTally: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      selection: () =>
        held.selection.length === 0 || held.selection.includes("\n") ? undefined : held.selection,
    };
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined || event.source !== framed) return;
      const answer = readFindAnswer(event.data);
      if (Option.isNone(answer)) return;
      if ("key" in answer.value) {
        press(CHORD_OF_KEY[answer.value.key]);
      } else if ("selection" in answer.value) {
        held.selection = answer.value.selection;
      } else if (held.query.length > 0) {
        const { count, at } = answer.value.tally;
        for (const listener of listeners) listener({ count, at: at < count ? at : -1 });
      }
    };
    const loaded = () => {
      held.selection = "";
      if (held.query.length > 0) search(held.query);
    };
    return { source, hear, loaded };
  });
  useEffect(() => {
    window.addEventListener("message", find.hear);
    return () => window.removeEventListener("message", find.hear);
  }, [find]);
  useFindSource(find.source);
  return find.loaded;
}

/**
 * Opens the link out the frame says was pressed, as any link of the window
 * opens. Note that the press is taken only from the frame drawn, only for an
 * address the window opens from any link, and only while the window holds a
 * press of the developer's, which a press in the frame hands it, because the
 * page's own scripts can post the same message without one.
 */
export function useFrameLinks(frame: RefObject<HTMLIFrameElement | null>): void {
  const open = useOpenLink();
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined || event.source !== framed) return;
      const press = readLinkPress(event.data);
      if (Option.isNone(press) || !opensAsLink(press.value.href)) return;
      if (navigator.userActivation?.isActive !== true) return;
      open(press.value.href);
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [frame, open]);
}

/** What the frame is asked for a page's comments, and who hears what it picks. */
interface FrameComments {
  /** Whether the frame takes the next press as a comment's element. */
  readonly picking: boolean;
  /** The path of the element outlined, whose threads are open; none outlined. */
  readonly shown: string | undefined;
  /** The path of the element outlined faintly, whose pin the pointer is over; none outlined. */
  readonly hinted: string | undefined;
  /** The elements holding threads, whose boxes the frame says, and the words their threads quote. */
  readonly marks: readonly PageMark[];
  readonly onPicked: (picked: PagePicked) => void;
  /** The pick let go in the page, by Escape. */
  readonly onStopped: () => void;
  /** A press landed in the page, selecting nothing, which closes what stands over it as a press away does. */
  readonly onPressed: () => void;
}

/** What the frame said for a page's comments: where each element marked stands, by its path, and the words selected in it. */
interface FrameSaid {
  readonly marks: ReadonlyMap<string, FrameBox | null>;
  readonly selected: PagePicked | undefined;
}

const NOTHING_SAID: FrameSaid = { marks: new Map(), selected: undefined };

function sameMarks(a: readonly PageMark[], b: readonly PageMark[]): boolean {
  return (
    a.length === b.length &&
    a.every((mark, at) => mark.path === b[at]?.path && mark.words === b[at]?.words)
  );
}

/**
 * The frame's part in a page's comments, kept in step with `asks`: the pick,
 * the element outlined, and the elements marked, each told only as it
 * changes, and told again whole each time the frame loads, a reload or
 * another version, since a new document holds none of it; and what the
 * frame says back. Note that an element picked is taken only from the frame
 * drawn, only while a pick is asked, and only while the window holds a press
 * of the developer's, because the page's own scripts can post the same
 * message without one; a box or the words selected need no press, since the
 * worst a page that lies about them does is misplace a pin or a quote of its
 * own. Answers what was said, and what the frame's load runs.
 */
function useFrameComments(frame: RefObject<HTMLIFrameElement | null>, asks: FrameComments) {
  const latest = useRef(asks);
  latest.current = asks;
  const [said, setSaid] = useState<FrameSaid>(NOTHING_SAID);
  const post = useCallback(
    (ask: PagePickAsk) => frame.current?.contentWindow?.postMessage(ask, "*"),
    [frame],
  );
  // Note that a page no one comments on is asked nothing.
  const told = useRef<{
    picking: boolean;
    shown: string | undefined;
    hinted: string | undefined;
    marks: readonly PageMark[];
  }>({ picking: false, shown: undefined, hinted: undefined, marks: [] });
  const { picking, shown, hinted, marks } = asks;
  useEffect(() => {
    if (picking !== told.current.picking) {
      post({ type: PAGE_PICK_TYPE, act: picking ? PAGE_PICK_ACT.START : PAGE_PICK_ACT.STOP });
    }
    if (shown !== told.current.shown) {
      post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.SHOW, path: shown ?? "" });
    }
    if (hinted !== told.current.hinted) {
      post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.HINT, path: hinted ?? "" });
    }
    if (!sameMarks(marks, told.current.marks)) {
      post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.MARK, marks });
    }
    told.current = { picking, shown, hinted, marks };
  }, [post, picking, shown, hinted, marks]);
  const loaded = useCallback(() => {
    const { picking, shown, marks } = latest.current;
    setSaid(NOTHING_SAID);
    if (picking) post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.START });
    if (shown !== undefined) post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.SHOW, path: shown });
    if (marks.length > 0) post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.MARK, marks });
  }, [post]);
  const unselect = useCallback(() => {
    setSaid((was) => ({ ...was, selected: undefined }));
    post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.UNSELECT });
  }, [post]);
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined || event.source !== framed) return;
      const answer = readPick(event.data);
      if (Option.isNone(answer)) return;
      const message = answer.value;
      if ("marks" in message) {
        const marks = new Map(message.marks.map(({ path, box }) => [path, box]));
        return setSaid((was) => ({ ...was, marks }));
      }
      if ("selected" in message) {
        const selected = message.selected ?? undefined;
        return setSaid((was) => ({ ...was, selected }));
      }
      if ("pressed" in message) return latest.current.onPressed();
      if (!latest.current.picking) return;
      if ("stopped" in message) return latest.current.onStopped();
      if (navigator.userActivation?.isActive !== true) return;
      latest.current.onPicked(message.picked);
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [frame]);
  return { said, loaded, unselect };
}

/**
 * Says the focus went into the frame where this window hears it: a click
 * in a frame stirs no event of this document's but the window's blur, so
 * the focus the frame took is told as a `focusin` on the frame, which
 * hands its column the window's keys as a focus anywhere in it does
 * (`useColumnFocus`).
 */
function useFrameFocus(frame: RefObject<HTMLIFrameElement | null>): void {
  useEffect(() => {
    const blurred = () => {
      const element = frame.current;
      if (element !== null && document.activeElement === element) {
        element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      }
    };
    window.addEventListener("blur", blurred);
    return () => window.removeEventListener("blur", blurred);
  }, [frame]);
}

/**
 * The page drawn in its sandboxed frame, found in through the frame (`useFrameFind`), its links
 * out opened outside it (`useFrameLinks`), and what its owner draws over it in its room, a page's
 * comments, told the frame has loaded.
 * Note that the frame stands from the start, its ring over it until `onLoad` of the `src` it
 * shows, because the page reads only as the frame loads it, a version stepped to included, and a
 * frame left blank says nothing of that. Until then the frame is hidden, as a page's thumb is,
 * because the blank document it loads through is light only, and a frame worn by a dark panel
 * paints it on an opaque white canvas: hidden, the ring stands on the panel's own ground.
 */
function PageFrame({
  title,
  src,
  frame,
  room,
  onLoaded,
  children,
}: {
  title: string;
  src: string;
  frame: RefObject<HTMLIFrameElement | null>;
  room: RefObject<HTMLDivElement | null>;
  onLoaded?: (() => void) | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const [framedSrc, setFramedSrc] = useState<string>();
  const found = useFrameFind(frame);
  useFrameLinks(frame);
  usePageTheme(frame, PAGE_ROOM.OWN);
  useFrameFocus(frame);
  const loaded = framedSrc === src;
  return (
    <div ref={room} className="page-view-room relative flex min-h-0 flex-1">
      <iframe
        ref={frame}
        className={cn("block min-h-0 w-full flex-1 border-0", !loaded && "invisible")}
        title={title}
        src={src}
        sandbox={PAGE_SANDBOX}
        allow=""
        referrerPolicy="no-referrer"
        onLoad={() => {
          setFramedSrc(src);
          found();
          onLoaded?.();
        }}
      />
      {loaded ? null : (
        <div className="pointer-events-none absolute inset-0 flex">
          <SpinnerRegion delay label={readingWords("the page")} />
        </div>
      )}
      {children}
    </div>
  );
}

/** A step between a page's versions: a press of one of the bar's chevrons. */
function VersionStep({
  label,
  to,
  icon,
  onStep,
}: {
  label: string;
  to: number | undefined;
  icon: React.JSX.Element;
  onStep: (version: number) => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <IconButton
        icon={icon}
        label={label}
        disabled={to === undefined}
        onClick={() => {
          if (to !== undefined) onStep(to);
        }}
      />
    </Tooltip>
  );
}

/** Where the read of the version's source stands, a failed read being read again shown as reading. */
function sourceRead(source: UseQueryResult<TasksPageSourceAnswer>): SourceRead {
  if (source.isPending || (source.isFetching && !source.isSuccess)) return SOURCE_READING;
  if (source.isError || !("lines" in source.data)) return { kind: SOURCE_READ.FAILED };
  return { kind: SOURCE_READ.READY, lines: source.data.lines };
}

/** The name a page's source is colored under: an HTML document's. */
const PAGE_SOURCE_NAME = "page.html";

/** No notes on a page's source. */
const NO_NOTES: readonly WholeFileNote[] = [];

/** The version's source in the frame's place: its text drawn as a File tab draws a file, or why it is not. */
function PageSource({
  title,
  version,
  read,
  onRetry,
}: {
  title: string;
  /** The page and the version whose source this is, which its colors are kept under. */
  version: string;
  read: SourceRead;
  onRetry: () => void;
}): React.JSX.Element {
  const text = useMemo(
    () => (read.kind === SOURCE_READ.READY ? sourceText(read.lines) : ""),
    [read],
  );
  if (read.kind === SOURCE_READ.READING)
    return <SpinnerRegion delay label={readingWords("the source")} />;
  if (read.kind === SOURCE_READ.FAILED) {
    return (
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.PAGE_READ)}
        onRetry={onRetry}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
      >
        The page's source could not be read.
      </ErrorState>
    );
  }
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      className="page-view-room file-tab bg-card-code"
      aria-label={`${title} source`}
    >
      <WholeFile
        name={PAGE_SOURCE_NAME}
        text={text}
        revision={version}
        lit={undefined}
        notes={NO_NOTES}
        findFrom={1}
      />
    </Fill>
  );
}

/** Copy source, copying the version's source text, which stands dimmed until it is read. */
function copySourceAction(
  read: SourceRead | undefined,
  copy: (text: string, words: string) => void,
): MenuAction {
  return {
    label: "Copy source",
    icon: <GLYPH.COPY />,
    disabled: read?.kind !== SOURCE_READ.READY,
    onSelect: () => {
      if (read?.kind === SOURCE_READ.READY) copy(sourceText(read.lines), "Source copied");
    },
  };
}

/** A step to another version as an item of a phone's ⋯, dimmed with none that way, as the bar's arrow is. */
function versionStepAction(
  label: string,
  to: number | undefined,
  icon: React.JSX.Element,
  onStep: (version: number) => void,
  detail: string,
): MenuAction {
  return {
    label,
    icon,
    detail,
    disabled: to === undefined,
    onSelect: () => {
      if (to !== undefined) onStep(to);
    },
  };
}

/**
 * Where commenting on the page stands: whether its column is open beside
 * it, whether the frame is picking an element, the thread being started,
 * and the threads open. An element picked, or words selected and replied
 * to, are quoted into the comment being started, the first starting one on
 * that element; Whole page starts one on the page as a whole. A comment
 * being started is let go on Escape, Cancel, or a press away, its draft
 * kept where it holds words or files of the writer's own, and dropped where
 * it holds only the quotes it was started from, so the next starts afresh.
 */
function useCommenting(place: DescriptionCommentPlace | undefined) {
  const drafts = useDraftWriter();
  const [column, setColumn] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<PageCommentOn | undefined>(undefined);
  const [open, setOpen] = useState<readonly string[] | undefined>(undefined);
  const begin = (on: PageCommentOn, quote: string | undefined) => {
    setPicking(false);
    setOpen(undefined);
    if (place !== undefined && quote !== undefined) {
      drafts.update(place, (was) => ({ ...was, text: withQuote(was.text, quote) }));
    }
    if (pending === undefined) setPending(on);
  };
  const dismiss = () => {
    setPicking(false);
    setOpen(undefined);
    if (pending === undefined) return;
    setPending(undefined);
    if (place === undefined) return;
    drafts.update(place, (was) =>
      ownWordsIn(was.text) || was.attachments.length > 0 ? was : { ...was, text: "" },
    );
  };
  return {
    column,
    picking,
    pending,
    open,
    toggleColumn: () => setColumn(!column),
    showColumn: () => setColumn(true),
    startPick: () => {
      setOpen(undefined);
      setPicking(true);
    },
    stopPick: () => setPicking(false),
    quote: ({ box, ...element }: PagePicked) => begin({ element, box }, element.quote),
    wholePage: () => begin({ element: undefined, box: undefined }, undefined),
    started: (threadId: string) => {
      setPending(undefined);
      setOpen([threadId]);
    },
    dismiss,
    setOpen,
  };
}

/**
 * The most of the row it stands in the comments pane takes, which the
 * stylesheet holds it to as well (`.page-comments-column`'s 50%), so a drag
 * starts from the width drawn and the page keeps at least half the row.
 */
const COMMENTS_SHARE = 0.5;

/** What a drag of the comments pane leaves the page beside it in their row, in CSS pixels: the rest of the row past the pane's share. */
function pageReserve(row: HTMLElement): number {
  return row.getBoundingClientRect().width * (1 - COMMENTS_SHARE);
}

/** The elements holding open threads, each once, in the order their threads were started, with the words the first quotes where it was started on words selected; then those holding only comments held in the reader's review. */
function threadMarks(
  threads: readonly DescriptionCommentThread[],
  held: readonly HeldComment[],
): readonly PageMark[] {
  const posted = [...threadsByElement(threads)].map(([path, [first]]) =>
    first?.scope === DESCRIPTION_COMMENT_SCOPE.WORDS ? { path, words: first.quote } : { path },
  );
  const marked = new Set(posted.map((mark) => mark.path));
  const heldMarks = held.flatMap((comment) => {
    const on = comment.element;
    if (on === undefined || marked.has(on.path)) return [];
    marked.add(on.path);
    return [on.words === true ? { path: on.path, words: on.quote } : { path: on.path }];
  });
  return [...posted, ...heldMarks];
}

/**
 * The page's tab: its title, its versions where it has more than one, the
 * source's toggle, a reload, and the page or its source. On a phone, whose
 * task's header names the page, the bar is not drawn: its header's ⋯
 * offers every control of it, the version shown said under its steps. The side panel
 * finds in no page tab, since a page's words stand in a frame no find of
 * the window reaches, so the tab offers ⌘F itself: through the frame while
 * the page is drawn, and in the lines while its source is.
 */
export function PagePane({
  place,
  page,
  findActive,
  comments,
}: {
  /** The plan the page stands on, or the agent on no task that showed it. */
  place: PagePlace;
  page: PageLine;
  /** Whether the panel holds the window's keys, so the tab's find answers ⌘F. */
  findActive: boolean;
  /** The page's comment threads and who writes them; none for a page with no comments, one an agent on no task showed. */
  comments?:
    | {
        readonly control: DescriptionCommentsControl;
        readonly doors: Parameters<typeof PageComments>[0]["doors"];
      }
    | undefined;
}): React.JSX.Element {
  // The version stepped to, none while the newest is followed.
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const [view, setView] = useState<PageView>(PAGE_VIEW.PAGE);
  const commenting = useCommenting(
    comments === undefined ? undefined : pageDraftPlace(comments.control.planId, page.id),
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const threads = comments?.control.threads;
  const review = usePageReview(comments?.control, page.id);
  const marks = useMemo(() => threadMarks(threads ?? [], review.held), [threads, review.held]);
  const [hinted, setHinted] = useState<string | undefined>(undefined);
  const shown = threads?.find((thread) => commenting.open?.includes(thread.id) === true)?.page
    ?.element;
  const framed = useFrameComments(frame, {
    picking: commenting.picking,
    shown,
    hinted,
    marks,
    onPicked: commenting.quote,
    onStopped: commenting.stopPick,
    onPressed: commenting.dismiss,
  });
  const copyWithToast = useCopyToast();
  const queryClient = useQueryClient();
  const version = chosen === undefined ? page.version : Math.min(chosen, page.version);
  const step = (to: number) => setChosen(to === page.version ? undefined : to);
  const showingSource = view === PAGE_VIEW.SOURCE;
  // The source of the version shown is read the first time it is asked for.
  const sourceQuery = useQuery({
    ...pageSourceQueryOptions(place, page.id, version),
    enabled: showingSource,
  });
  const source = showingSource || sourceQuery.isSuccess ? sourceRead(sourceQuery) : undefined;
  const toggleLabel = showingSource ? "View page" : "View source";
  const toggleView = () => setView(showingSource ? PAGE_VIEW.PAGE : PAGE_VIEW.SOURCE);
  const commentsLabel = commenting.column ? "Hide comments" : "Show comments";
  // Note that the pane's filter is the tab's, so the pane shut and opened again lists what it listed.
  const [commentsFilter, setCommentsFilter] = useState<CommentsFilter>(COMMENTS_FILTER.OPEN);
  const commentsWidth = usePageCommentsWidth();
  // Note that the edge is the tab's, which outlives the pane a drag shuts.
  const commentsEdge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.LEFT,
    width: commentsWidth.width,
    bounds: PAGE_COMMENTS_WIDTH,
    reserve: pageReserve,
    label: "Resize comments",
    onResize: commentsWidth.onResize,
    onToggleCollapsed: commenting.toggleColumn,
  });
  const commentsSlide = usePaneSlide(comments !== undefined && commenting.column);
  // Note that Comment asks the page itself for an element, so it shows the page where its source stood.
  const comment = () => {
    if (commenting.picking) return commenting.stopPick();
    setView(PAGE_VIEW.PAGE);
    commenting.startPick();
  };
  const commentsAction: MenuAction[] =
    comments === undefined
      ? []
      : [
          {
            label: PAGE_COMMENT_WORDS.COMMENT,
            icon: <MessageSquarePlusIcon aria-hidden="true" />,
            onSelect: comment,
          },
          {
            label: commentsLabel,
            icon: <SidePanelIcon />,
            onSelect: commenting.toggleColumn,
          },
        ];
  const reload = () => {
    setReloads((was) => was + 1);
    void queryClient.resetQueries({ queryKey: pageSourcesKey(place, page.id) });
  };
  const copySource = copySourceAction(source, copyWithToast);
  const reloadAction: MenuAction = {
    label: "Reload page",
    icon: <RotateCwIcon aria-hidden="true" />,
    onSelect: reload,
  };
  const settings = useViewSettingsSheet({ kind: VIEW_SETTINGS_SCOPE.LINES });
  const workspace = useLinkWorkspace();
  // None where the surface hands down no workspace to write the page's link under, as Copy link stands nowhere there.
  const inBrowser =
    workspace === undefined
      ? []
      : [
          openPageInBrowserItem(
            "taskId" in place
              ? { kind: LINK_PLACE.PAGE, planId: place.taskId, pageId: page.id }
              : { kind: LINK_PLACE.PAGE, agentId: place.agentId, pageId: page.id },
            workspace,
          ),
        ];
  const phone = usePhoneRoom();
  const versionWords = `Version ${version} of ${page.version}`;
  useTabActions(
    phone
      ? [
          page.version > 1
            ? [
                versionStepAction(
                  "Earlier version",
                  version > 1 ? version - 1 : undefined,
                  <ChevronLeftIcon aria-hidden="true" />,
                  step,
                  versionWords,
                ),
                versionStepAction(
                  "Later version",
                  version < page.version ? version + 1 : undefined,
                  <ChevronRightIcon aria-hidden="true" />,
                  step,
                  versionWords,
                ),
              ]
            : [],
          [
            ...commentsAction,
            { label: toggleLabel, icon: <CodeXmlIcon aria-hidden="true" />, onSelect: toggleView },
            reloadAction,
          ],
          showingSource ? [settings.action, copySource] : [],
          inBrowser,
        ].filter((group) => group.length > 0)
      : // Note that the strip's one ⋯ for the tab offers these after its Copy link, so the bar draws no ⋯ of its own.
        [inBrowser, showingSource ? [copySource] : [], [reloadAction]].filter(
          (group) => group.length > 0,
        ),
  );
  return (
    <FindScope
      className="page-view-find"
      active={findActive}
      subject={{ task: pagePlaceId(place), tab: { page: page.id } }}
    >
      <Fill className="page-view file-view ph-no-capture">
        {phone ? (
          settings.sheet
        ) : (
          <PaneBar
            title={page.title}
            actions={
              <>
                {page.version > 1 ? (
                  <div className="mr-page-versions-end flex items-center gap-list-gap">
                    <VersionStep
                      label="Earlier version"
                      to={version > 1 ? version - 1 : undefined}
                      icon={<ChevronLeftIcon aria-hidden="true" />}
                      onStep={step}
                    />
                    {/* In a narrow panel the count stands alone (tasks.css). */}
                    <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                      <span className="page-view-version-words">
                        Version {version} of {page.version}
                      </span>
                      <span className="page-view-version-count">
                        {version}/{page.version}
                      </span>
                    </span>
                    <VersionStep
                      label="Later version"
                      to={version < page.version ? version + 1 : undefined}
                      icon={<ChevronRightIcon aria-hidden="true" />}
                      onStep={step}
                    />
                  </div>
                ) : null}
                <Tooltip label={toggleLabel}>
                  <IconButton
                    icon={<CodeXmlIcon aria-hidden="true" />}
                    label={toggleLabel}
                    onClick={toggleView}
                  />
                </Tooltip>
                <Tooltip label="Reload page">
                  <IconButton
                    icon={<RotateCwIcon aria-hidden="true" />}
                    label="Reload page"
                    turns
                    onClick={reload}
                  />
                </Tooltip>
                {showingSource ? (
                  <ViewSettingsButton scope={{ kind: VIEW_SETTINGS_SCOPE.LINES }} />
                ) : null}
                {comments === undefined ? null : (
                  <>
                    <Tooltip label={PAGE_COMMENT_WORDS.COMMENT}>
                      <IconButton
                        icon={<MessageSquarePlusIcon aria-hidden="true" />}
                        label={PAGE_COMMENT_WORDS.COMMENT}
                        pressed={commenting.picking}
                        onClick={comment}
                      />
                    </Tooltip>
                    <Tooltip label={commentsLabel}>
                      <IconButton
                        // Note that the column's toggle wears how many comments the reader holds in their review, which the column lists at its head.
                        icon={
                          <CornerCount count={review.held.length}>
                            <SidePanelIcon />
                          </CornerCount>
                        }
                        label={commentsLabel}
                        aria-expanded={commenting.column}
                        onClick={commenting.toggleColumn}
                      />
                    </Tooltip>
                  </>
                )}
              </>
            }
          />
        )}
        <div className="page-view-row relative flex min-h-0 flex-1">
          {showingSource ? (
            <PageSource
              title={page.title}
              version={`${page.id}@${version}`}
              read={source ?? SOURCE_READING}
              onRetry={() => void sourceQuery.refetch()}
            />
          ) : (
            <PageFrame
              key={reloads}
              title={page.title}
              src={appPlatform().pageFrameUrl({ ...place, pageId: page.id, version })}
              frame={frame}
              room={room}
              onLoaded={framed.loaded}
            >
              {comments === undefined ? null : (
                <PageCommentLayer
                  control={comments.control}
                  doors={comments.doors}
                  page={{ id: page.id, version }}
                  room={room}
                  marks={framed.said.marks}
                  selected={framed.said.selected}
                  picking={commenting.picking}
                  pending={commenting.pending}
                  open={commenting.open}
                  floats={!commenting.column}
                  onOpen={commenting.setOpen}
                  onHint={setHinted}
                  onReply={(selected) => {
                    framed.unselect();
                    commenting.quote(selected);
                  }}
                  onWholePage={commenting.wholePage}
                  onStopPick={commenting.stopPick}
                  onStarted={commenting.started}
                  onCancel={commenting.dismiss}
                  // Note that a phone draws no bar for the review's press, so its comments post at once.
                  review={{
                    // Note that holding a comment opens the column, where the review it joins is listed.
                    control: {
                      ...review,
                      hold: (comment) => {
                        review.hold(comment);
                        commenting.showColumn();
                      },
                    },
                    onOpen: commenting.showColumn,
                  }}
                />
              )}
            </PageFrame>
          )}
          {comments === undefined || !commentsSlide.drawn ? null : (
            <aside
              ref={(node) => {
                commentsSlide.pane.current = node;
              }}
              className="page-comments-column"
              aria-label="Comments"
              // Note that a pane standing over a narrow page steps aside while the page is picked in.
              data-aside={commenting.picking ? "" : undefined}
              data-leaving={commentsSlide.leaving ? "" : undefined}
              inert={commentsSlide.leaving}
              style={cssCustomProperties({ "--page-comments-width": `${commentsWidth.width}px` })}
            >
              <ResizeEdge edge={commentsEdge} />
              <PageComments
                control={comments.control}
                doors={comments.doors}
                open={commenting.open}
                filter={commentsFilter}
                onFilter={setCommentsFilter}
                onOpen={(thread) =>
                  commenting.setOpen(thread === undefined ? undefined : [thread.id])
                }
                lead={
                  <PageReviewSection
                    review={review}
                    cardOf={(held, onRemove) => (
                      <HeldCommentCard comment={held} onRemove={onRemove} />
                    )}
                  />
                }
              />
            </aside>
          )}
        </div>
      </Fill>
    </FindScope>
  );
}

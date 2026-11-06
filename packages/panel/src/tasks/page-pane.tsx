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

export const PAGE_SANDBOX = "allow-scripts";

const PAGE_VIEW = {
  PAGE: "page",
  SOURCE: "source",
} as const;

type PageView = (typeof PAGE_VIEW)[keyof typeof PAGE_VIEW];

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

const CHORD_OF_KEY = {
  [PAGE_FIND_KEY.FIND]: APP_COMMAND.FIND,
  [PAGE_FIND_KEY.NEXT]: APP_COMMAND.FIND_NEXT,
  [PAGE_FIND_KEY.PREVIOUS]: APP_COMMAND.FIND_PREVIOUS,
} as const satisfies Record<(typeof PAGE_FIND_KEY)[keyof typeof PAGE_FIND_KEY], FindChord>;

const readFindAnswer = Schema.decodeUnknownOption(pageFindAnswerSchema);

const readLinkPress = Schema.decodeUnknownOption(pageLinkPressSchema);

const readPick = Schema.decodeUnknownOption(pagePickAnswerSchema);

function sourceText(lines: CodeLines): string {
  return lines.map((line) => line.map((run) => run.text).join("")).join("\n");
}

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

interface FrameComments {
  readonly picking: boolean;
  readonly shown: string | undefined;
  readonly hinted: string | undefined;
  readonly marks: readonly PageMark[];
  readonly onPicked: (picked: PagePicked) => void;
  readonly onStopped: () => void;
  readonly onPressed: () => void;
}

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

function useFrameComments(frame: RefObject<HTMLIFrameElement | null>, asks: FrameComments) {
  const latest = useRef(asks);
  latest.current = asks;
  const [said, setSaid] = useState<FrameSaid>(NOTHING_SAID);
  const post = useCallback(
    (ask: PagePickAsk) => frame.current?.contentWindow?.postMessage(ask, "*"),
    [frame],
  );
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

function sourceRead(source: UseQueryResult<TasksPageSourceAnswer>): SourceRead {
  if (source.isPending || (source.isFetching && !source.isSuccess)) return SOURCE_READING;
  if (source.isError || !("lines" in source.data)) return { kind: SOURCE_READ.FAILED };
  return { kind: SOURCE_READ.READY, lines: source.data.lines };
}

const PAGE_SOURCE_NAME = "page.html";

const NO_NOTES: readonly WholeFileNote[] = [];

function PageSource({
  title,
  version,
  read,
  onRetry,
}: {
  title: string;
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

const COMMENTS_SHARE = 0.5;

function pageReserve(row: HTMLElement): number {
  return row.getBoundingClientRect().width * (1 - COMMENTS_SHARE);
}

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

export function PagePane({
  place,
  page,
  findActive,
  comments,
}: {
  place: PagePlace;
  page: PageLine;
  findActive: boolean;
  comments?:
    | {
        readonly control: DescriptionCommentsControl;
        readonly doors: Parameters<typeof PageComments>[0]["doors"];
      }
    | undefined;
}): React.JSX.Element {
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
  const sourceQuery = useQuery({
    ...pageSourceQueryOptions(place, page.id, version),
    enabled: showingSource,
  });
  const source = showingSource || sourceQuery.isSuccess ? sourceRead(sourceQuery) : undefined;
  const toggleLabel = showingSource ? "View page" : "View source";
  const toggleView = () => setView(showingSource ? PAGE_VIEW.PAGE : PAGE_VIEW.SOURCE);
  const commentsLabel = commenting.column ? "Hide comments" : "Show comments";
  const [commentsFilter, setCommentsFilter] = useState<CommentsFilter>(COMMENTS_FILTER.OPEN);
  const commentsWidth = usePageCommentsWidth();
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
      : [inBrowser, showingSource ? [copySource] : [], [reloadAction]].filter(
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
                  review={{
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

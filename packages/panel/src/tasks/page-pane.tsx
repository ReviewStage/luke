import { LINK_PLACE } from "@luke/features/link-grammar";
import {
  PAGE_FIND_ACT,
  PAGE_FIND_KEY,
  PAGE_FIND_TYPE,
  type PageFindAsk,
  pageFindAnswerSchema,
} from "@luke/features/page-find";
import { pageLinkPressSchema } from "@luke/features/page-link";
import {
  PAGE_PICK_ACT,
  PAGE_PICK_TYPE,
  type PagePickAsk,
  type PagePicked,
  pagePickAnswerSchema,
} from "@luke/features/page-pick";
import { type PageLine, type PagePlace, pagePlaceId } from "@luke/features/page-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import type { CodeLines, TasksPageSourceAnswer } from "@luke/features/tasks-view";
import { readingWords } from "@luke/features/words";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  IconButton,
  PaneBar,
  SpinnerRegion,
  Tooltip,
} from "@luke/ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  GLYPH,
  MessageSquareIcon,
  RotateCwIcon,
} from "@luke/ui/icons";
import type { PlanCommentsControl } from "@luke/ui/plan-comments";
import { Option, Schema } from "effect";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import { useLinkWorkspace } from "../copy-link-item.js";
import type { MenuAction } from "../desktop/action-menu.js";
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
import { type PageCommentOn, PageComments } from "./plan-comments.js";
import { opensAsLink, useOpenLink } from "./use-open-link.js";
import { useViewSettingsSheet, VIEW_SETTINGS_SCOPE, ViewSettingsButton } from "./view-settings.js";
import { WholeFile, type WholeFileNote } from "./whole-file.js";

/**
 * page-pane.tsx -- one page an agent wrote for the task, in the side panel: the page itself, drawn at the version chosen, and a bar to step between its versions and reload it.
 *
 * The page is HTML an agent wrote, so it is drawn in a frame from an address
 * the shell names (`appPlatform().pageFrameUrl`: on the desktop, the
 * `luke-page:` scheme main serves under a policy of its own; on the web, the
 * service's frame of the version, which sends it on to the sandbox's own
 * site) and sandboxed to its scripts alone: no same origin, so it holds an opaque
 * origin with no storage and no reach into this window; no popups, forms,
 * top navigation, or modals; and no permission to delegate. The frame's
 * address names the version, so stepping to another loads that version,
 * and the newest is followed until the developer steps back from it. A
 * link out of the page is not followed in the frame, which may draw nothing
 * but a page: the frame hands its press to the pane
 * (`@luke/features/page-link`), which opens it as any link of the window
 * opens (`useOpenLink`), a site in the browser and a link of ours in the
 * window. Reload draws the page again. What the page draws is the
 * task's, so the pane is left out of the screen recording (`ph-no-capture`);
 * the recording could not see into the frame in any case.
 *
 * The bar's code toggle shows the version's HTML in the frame's place, as a
 * File tab draws a file (`file-tab.tsx`): the same numbered, coloured lines
 * under the same settings, and ⌘F over them. The tab's one ⋯, the strip's,
 * offers its Copy link, then Open in browser, then Copy source while the
 * source is shown, then Reload page, which the page hands up on every
 * screen (`useTabActions`). Open in browser opens the page's own app
 * link, never the address the frame is drawn from (`open-in-browser-item.tsx`).
 * The frame's own read is the frame's alone, so the source is read again,
 * once a version, through main, which colours it as HTML
 * (`ACT_KIND.TASKS_PAGE_SOURCE`), and is held by the tab until Reload.
 * The tab stays on the source or the page while its versions are stepped.
 *
 * ⌘F over the page itself finds in the frame: no find of this window reaches
 * the page's words, so the find bar asks the frame, whose page is served
 * with a find of our own ahead of it (`@luke/features/page-find`), and
 * hears back its tally and its selection, from that frame alone and only
 * in the find's own shape.
 *
 * On a task's page the bar's Comments opens the page's comment threads in a
 * column beside it (`PageComments`), read and written as the plan's are,
 * naming the page. Its Comment asks the frame to pick an element, which the
 * frame does with a script of our own ahead of the page
 * (`@luke/features/page-pick`), handing back what was pressed; the pane
 * takes that only from the frame it drew, only while it asked, and only
 * while the window holds a press of the developer's, as it takes a link.
 * A thread's quote asks the frame to outline its element and bring it into
 * view. A page an agent on no task showed has no comments.
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

/** Reads one version's source: the answer, or a rejection where main refused the act. */
export type ReadPageSource = (version: number) => Promise<TasksPageSourceAnswer>;

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
function useFrameLinks(frame: RefObject<HTMLIFrameElement | null>): void {
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

/** What the frame is asked to pick and show for a comment, and who hears what it picks. */
interface FramePick {
  /** Whether the frame takes the next press as a comment's element. */
  readonly picking: boolean;
  /** The path of the element outlined for the thread whose quote was pressed; none outlined. */
  readonly shown: string | undefined;
  readonly onPicked: (picked: PagePicked) => void;
  /** The pick let go in the page, by Escape. */
  readonly onStopped: () => void;
}

/**
 * The frame's pick for a comment, kept in step with `pick`: asked again each
 * time the frame loads, a reload or another version, since a new document
 * holds no pick. Note that an element picked is taken only from the frame
 * drawn, only while a pick is asked, and only while the window holds a press
 * of the developer's, because the page's own scripts can post the same
 * message without one. Answers what the frame's load runs.
 */
function useFramePick(frame: RefObject<HTMLIFrameElement | null>, pick: FramePick): () => void {
  const latest = useRef(pick);
  latest.current = pick;
  const post = useCallback(
    (ask: PagePickAsk) => frame.current?.contentWindow?.postMessage(ask, "*"),
    [frame],
  );
  const sync = useCallback(() => {
    const { picking, shown } = latest.current;
    post({ type: PAGE_PICK_TYPE, act: picking ? PAGE_PICK_ACT.START : PAGE_PICK_ACT.STOP });
    post({ type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.SHOW, path: shown ?? "" });
  }, [post]);
  useEffect(sync, [sync, pick.picking, pick.shown]);
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      const framed = frame.current?.contentWindow;
      if (framed === null || framed === undefined || event.source !== framed) return;
      const answer = readPick(event.data);
      if (Option.isNone(answer) || !latest.current.picking) return;
      if ("stopped" in answer.value) return latest.current.onStopped();
      if (navigator.userActivation?.isActive !== true) return;
      latest.current.onPicked(answer.value.picked);
    };
    window.addEventListener("message", hear);
    return () => window.removeEventListener("message", hear);
  }, [frame]);
  return sync;
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

/** No pick asked of the frame, for a page with no comments. */
const NO_PICK: FramePick = {
  picking: false,
  shown: undefined,
  onPicked: () => undefined,
  onStopped: () => undefined,
};

/**
 * The page drawn in its sandboxed frame, found in through the frame (`useFrameFind`), its links
 * out opened outside it (`useFrameLinks`), a comment's element picked in it (`useFramePick`).
 * Note that the frame stands from the start, its ring over it until `onLoad` of the `src` it
 * shows, because the page reads only as the frame loads it, a version stepped to included, and a
 * frame left blank says nothing of that.
 */
function PageFrame({
  title,
  src,
  pick = NO_PICK,
}: {
  title: string;
  src: string;
  pick?: FramePick;
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const [framedSrc, setFramedSrc] = useState<string>();
  const found = useFrameFind(frame);
  useFrameLinks(frame);
  useFrameFocus(frame);
  const picked = useFramePick(frame, pick);
  return (
    <div className="page-view-room relative flex min-h-0 flex-1">
      <iframe
        ref={frame}
        className="block min-h-0 w-full flex-1 border-0"
        title={title}
        src={src}
        sandbox={PAGE_SANDBOX}
        allow=""
        referrerPolicy="no-referrer"
        onLoad={() => {
          setFramedSrc(src);
          found();
          picked();
        }}
      />
      {framedSrc === src ? null : (
        <div className="pointer-events-none absolute inset-0 flex">
          <SpinnerRegion delay label={readingWords("the page")} />
        </div>
      )}
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

/**
 * The sources the tab has read, by version: each read the first time the
 * source of its version is shown, and held until Reload forgets them all.
 * A read that failed is held as one, so it is asked again only on Retry.
 * Note that only the latest read of a version lands, because one asked
 * before a Reload or a Retry may answer after it.
 */
function usePageSources(readSource: ReadPageSource) {
  const [held, setHeld] = useState<ReadonlyMap<number, SourceRead>>(new Map());
  const latest = useRef(readSource);
  latest.current = readSource;
  const asks = useRef({ count: 0, latest: new Map<number, number>() });
  const ask = useCallback((version: number) => {
    asks.current.count += 1;
    const asked = asks.current.count;
    asks.current.latest.set(version, asked);
    const land = (read: SourceRead) => {
      if (asks.current.latest.get(version) === asked) {
        setHeld((was) => new Map(was).set(version, read));
      }
    };
    land({ kind: SOURCE_READ.READING });
    latest.current(version).then(
      (answer) =>
        land(
          "lines" in answer
            ? { kind: SOURCE_READ.READY, lines: answer.lines }
            : { kind: SOURCE_READ.FAILED },
        ),
      () => land({ kind: SOURCE_READ.FAILED }),
    );
  }, []);
  const forget = useCallback(() => {
    asks.current.latest.clear();
    setHeld(new Map());
  }, []);
  return { held, ask, forget };
}

/** The name a page's source is coloured under: an HTML document's. */
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
  /** The page and the version whose source this is, which its colours are kept under. */
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
        placement={ERROR_STATE_PLACEMENT.CENTRED}
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
 * Where commenting on the page stands: whether its column is open, whether
 * the frame is picking an element, the thread being started once one is
 * picked or the whole page chosen, and the element outlined for a thread.
 * Closing the column lets go of the pick and the thread being started.
 */
function useCommenting() {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<PageCommentOn | undefined>(undefined);
  const [shown, setShown] = useState<string | undefined>(undefined);
  const begin = useCallback((on: PageCommentOn) => {
    setPicking(false);
    setPending(on);
  }, []);
  const cancel = useCallback(() => {
    setPicking(false);
    setPending(undefined);
  }, []);
  const pick: FramePick = useMemo(
    () => ({
      picking,
      shown,
      onPicked: (element) => begin({ element }),
      onStopped: () => setPicking(false),
    }),
    [picking, shown, begin],
  );
  return {
    open,
    pending,
    pick,
    begin,
    cancel,
    toggle: () => {
      if (open) cancel();
      setShown(undefined);
      setOpen(!open);
    },
    startPick: () => {
      setPending(undefined);
      setShown(undefined);
      setPicking(true);
    },
    show: setShown,
  };
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
  readSource,
  findActive,
  comments,
}: {
  /** The plan the page stands on, or the agent on no task that showed it. */
  place: PagePlace;
  page: PageLine;
  readSource: ReadPageSource;
  /** Whether the panel holds the window's keys, so the tab's find answers ⌘F. */
  findActive: boolean;
  /** The page's comment threads and who writes them; none for a page with no comments, one an agent on no task showed. */
  comments?:
    | {
        readonly control: PlanCommentsControl;
        readonly doors: Parameters<typeof PageComments>[0]["doors"];
      }
    | undefined;
}): React.JSX.Element {
  // The version stepped to, none while the newest is followed.
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const [view, setView] = useState<PageView>(PAGE_VIEW.PAGE);
  const commenting = useCommenting();
  const copyWithToast = useCopyToast();
  const sources = usePageSources(readSource);
  const version = chosen === undefined ? page.version : Math.min(chosen, page.version);
  const step = (to: number) => setChosen(to === page.version ? undefined : to);
  const showingSource = view === PAGE_VIEW.SOURCE;
  const source = sources.held.get(version);
  const { ask } = sources;
  // The source of the version shown is read the first time it is asked for.
  useEffect(() => {
    if (showingSource && source === undefined) ask(version);
  }, [showingSource, source, version, ask]);
  const toggleLabel = showingSource ? "View page" : "View source";
  const toggleView = () => setView(showingSource ? PAGE_VIEW.PAGE : PAGE_VIEW.SOURCE);
  const commentsLabel = commenting.open ? "Hide comments" : "Show comments";
  const commentsAction: MenuAction[] =
    comments === undefined
      ? []
      : [
          {
            label: commentsLabel,
            icon: <MessageSquareIcon aria-hidden="true" />,
            onSelect: commenting.toggle,
          },
        ];
  const reload = () => {
    setReloads((was) => was + 1);
    sources.forget();
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
                {comments === undefined ? null : (
                  <Tooltip label={commentsLabel}>
                    <IconButton
                      icon={<MessageSquareIcon aria-hidden="true" />}
                      label={commentsLabel}
                      pressed={commenting.open}
                      onClick={commenting.toggle}
                    />
                  </Tooltip>
                )}
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
              </>
            }
          />
        )}
        <div className="page-view-row relative flex min-h-0 flex-1">
          {showingSource ? (
            <PageSource
              title={page.title}
              version={`${page.id}@${version}`}
              read={source ?? { kind: SOURCE_READ.READING }}
              onRetry={() => ask(version)}
            />
          ) : (
            <PageFrame
              key={reloads}
              title={page.title}
              src={appPlatform().pageFrameUrl({ ...place, pageId: page.id, version })}
              pick={commenting.pick}
            />
          )}
          {comments === undefined || !commenting.open ? null : (
            <div className="page-comments-column">
              <PageComments
                control={comments.control}
                doors={comments.doors}
                page={{ id: page.id, version }}
                picking={commenting.pick.picking}
                pending={commenting.pending}
                onComment={() => {
                  setView(PAGE_VIEW.PAGE);
                  commenting.startPick();
                }}
                onWholePage={() => commenting.begin({ element: undefined })}
                onCancel={commenting.cancel}
                onShowElement={(thread) => {
                  setView(PAGE_VIEW.PAGE);
                  commenting.show(thread.page?.element);
                }}
              />
            </div>
          )}
        </div>
      </Fill>
    </FindScope>
  );
}

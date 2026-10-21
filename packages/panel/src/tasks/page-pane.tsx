import {
  PAGE_FIND_ACT,
  PAGE_FIND_KEY,
  PAGE_FIND_TYPE,
  type PageFindAsk,
  pageFindAnswerSchema,
} from "@luke/features/page-find";
import { type PageLine, type PagePlace, pagePlaceId } from "@luke/features/page-wire";
import type { CodeLines, TasksPageSourceAnswer } from "@luke/features/tasks-view";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ERROR_STATE_PLACEMENT, ErrorState, IconButton } from "@luke/ui";
import { useClipped } from "@luke/ui/use-clipped";
import { Option, Schema } from "effect";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  CodeXmlIcon,
  RotateCwIcon,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import {
  type FindChord,
  FindScope,
  type FindSource,
  type FindTally,
  useFindPress,
  useFindSource,
} from "../find-in-tab.js";
import { SpinnerRegion } from "../spinner.js";
import { Tooltip } from "../tooltip.js";
import { BarMenu } from "./file-menu.js";
import { VIEW_SETTINGS_SCOPE, ViewSettingsButton } from "./view-settings.js";
import { WholeFile, type WholeFileNote } from "./whole-file.js";

/**
 * page-pane.tsx -- one page an agent wrote for the task, in the side panel: the page itself, drawn at the version chosen, and a bar to step between its versions and reload it.
 *
 * The page is HTML an agent wrote, so it is drawn in a frame from an address
 * the shell names (`appPlatform().pageFrameUrl`: on the desktop, the
 * `luke-page:` scheme main serves under a policy of its own) and
 * sandboxed to its scripts alone: no same origin, so it holds an opaque
 * origin with no storage and no reach into this window; no popups, forms,
 * top navigation, or modals; and no permission to delegate. The frame's
 * address names the version, so stepping to another loads that version,
 * and the newest is followed until the developer steps back from it. A
 * link the page follows goes nowhere, since this window may frame nothing
 * but a page, and Reload draws the page again. What the page draws is the
 * task's, so the pane is left out of the screen recording (`ph-no-capture`);
 * the recording could not see into the frame in any case.
 *
 * The bar's code toggle shows the version's HTML in the frame's place, as a
 * File tab draws a file (`file-tab.tsx`): the same numbered, coloured lines
 * under the same settings, the same ⋯ to copy them by, and ⌘F over them.
 * The frame's own read is the frame's alone, so the source is read again,
 * once a version, through main, which colours it as HTML
 * (`ACT_KIND.TASKS_PAGE_SOURCE`), and is held by the tab until Reload.
 * The tab stays on the source or the page while its versions are stepped.
 *
 * ⌘F over the page itself finds in the frame: no find of this window reaches
 * the page's words, so the find bar asks the frame, whose page is served
 * with a find of Luke's own ahead of it (`@luke/features/page-find`), and
 * hears back its tally and its selection, from that frame alone and only
 * in the find's own shape.
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

/** The page drawn in its sandboxed frame, found in through the frame (`useFrameFind`). */
function PageFrame({ title, src }: { title: string; src: string }): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useFrameFind(frame);
  useFrameFocus(frame);
  return (
    <iframe
      ref={frame}
      className="page-view-frame"
      title={title}
      src={src}
      sandbox={PAGE_SANDBOX}
      allow=""
      referrerPolicy="no-referrer"
      onLoad={loaded}
    />
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
  if (read.kind === SOURCE_READ.READING) return <SpinnerRegion label="Loading source" />;
  if (read.kind === SOURCE_READ.FAILED) {
    return (
      <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
        The page's source could not be read.
      </ErrorState>
    );
  }
  return (
    <section className="file-tab" aria-label={`${title} source`}>
      <WholeFile
        name={PAGE_SOURCE_NAME}
        text={text}
        revision={version}
        lit={undefined}
        notes={NO_NOTES}
        findFrom={1}
      />
    </section>
  );
}

/** The bar's ⋯ over the source: its text copied. */
function SourceMenu({ read }: { read: SourceRead | undefined }): React.JSX.Element {
  const copyWithToast = useCopyToast();
  return (
    <BarMenu
      label="Source actions"
      actions={[
        {
          label: "Copy source",
          icon: <ClipboardCopyIcon aria-hidden="true" />,
          disabled: read?.kind !== SOURCE_READ.READY,
          onSelect: () => {
            if (read?.kind === SOURCE_READ.READY) {
              copyWithToast(sourceText(read.lines), "Source copied");
            }
          },
        },
      ]}
    />
  );
}

/**
 * The page's tab: its title, its versions where it has more than one, the
 * source's toggle, a reload, and the page or its source. The side panel
 * finds in no page tab, since a page's words stand in a frame no find of
 * the window reaches, so the tab offers ⌘F itself: through the frame while
 * the page is drawn, and in the lines while its source is.
 */
export function PagePane({
  place,
  page,
  readSource,
  findActive,
}: {
  /** The plan the page stands on, or the agent on no task that showed it. */
  place: PagePlace;
  page: PageLine;
  readSource: ReadPageSource;
  /** Whether the panel holds the window's keys, so the tab's find answers ⌘F. */
  findActive: boolean;
}): React.JSX.Element {
  // The version stepped to, none while the newest is followed.
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const [view, setView] = useState<PageView>(PAGE_VIEW.PAGE);
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
  const [titleBox, titleClipped] = useClipped(page.title);
  return (
    <FindScope
      className="page-view-find"
      active={findActive}
      subject={{ task: pagePlaceId(place), tab: { page: page.id } }}
    >
      <div className="page-view file-view ph-no-capture">
        <header className="file-view-bar">
          <Tooltip label={titleClipped ? page.title : undefined}>
            <span ref={titleBox} className="page-view-title" data-overflow={String(titleClipped)}>
              {page.title}
            </span>
          </Tooltip>
          <div className="file-view-actions">
            {page.version > 1 ? (
              <div className="page-view-versions">
                <VersionStep
                  label="Earlier version"
                  to={version > 1 ? version - 1 : undefined}
                  icon={<ChevronLeftIcon aria-hidden="true" />}
                  onStep={step}
                />
                {/* In a narrow panel the count stands alone (tasks.css). */}
                <span className="page-view-version">
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
                onClick={() => setView(showingSource ? PAGE_VIEW.PAGE : PAGE_VIEW.SOURCE)}
              />
            </Tooltip>
            <Tooltip label="Reload">
              <IconButton
                icon={<RotateCwIcon aria-hidden="true" />}
                label="Reload page"
                onClick={() => {
                  setReloads((was) => was + 1);
                  sources.forget();
                }}
              />
            </Tooltip>
            {showingSource ? (
              <>
                <ViewSettingsButton scope={{ kind: VIEW_SETTINGS_SCOPE.LINES, notes: false }} />
                <SourceMenu read={source} />
              </>
            ) : null}
          </div>
        </header>
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
          />
        )}
      </div>
    </FindScope>
  );
}

import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageLine } from "@luke/features/page-wire";
import type { CodeLines, TasksPageSourceAnswer } from "@luke/features/tasks-view";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  CodeXmlIcon,
  RotateCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopyToast } from "../copy-feedback";
import { FindScope } from "../find-in-tab";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { CodeLineRows } from "./code-pane";
import { LinesMenu } from "./file-menu";
import { useLinesLook } from "./file-tab";

/**
 * page-pane.tsx -- one page an agent wrote for the task, in the side panel: the page itself, drawn at the version chosen, and a bar to step between its versions and reload it.
 *
 * The page is HTML an agent wrote, so it is drawn in a frame of its own
 * scheme (`luke-page:`, served by main under a policy of its own) and
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

/** The source's lines as the page's text. */
function sourceText(lines: CodeLines): string {
  return lines.map((line) => line.map((run) => run.text).join("")).join("\n");
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
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        disabled={to === undefined}
        onClick={() => {
          if (to !== undefined) onStep(to);
        }}
      >
        {icon}
      </button>
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

/** The version's source in the frame's place: its lines as a File tab draws them, or why they are not. */
function PageSource({
  title,
  read,
  onRetry,
}: {
  title: string;
  read: SourceRead;
  onRetry: () => void;
}): React.JSX.Element {
  const look = useLinesLook();
  if (read.kind === SOURCE_READ.READING) return <SpinnerRegion label="Loading source" />;
  if (read.kind === SOURCE_READ.FAILED) {
    return (
      <div className="side-panel-empty">
        <ReadFailure
          line="The page's source could not be read."
          onRetry={onRetry}
          place={READ_FAILURE_PLACE.CENTRED}
        />
      </div>
    );
  }
  return (
    <section className="file-tab" aria-label={`${title} source`}>
      <div className="code-lines file-tab-lines scroll-fade-top" {...look}>
        <CodeLineRows firstLine={1} lines={read.lines} pointed={{ path: title }} />
      </div>
    </section>
  );
}

/** The bar's ⋯ over the source: its text copied, then the File tabs' settings its lines follow. */
function SourceMenu({ read }: { read: SourceRead | undefined }): React.JSX.Element {
  const copyWithToast = useCopyToast();
  return (
    <LinesMenu
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
 * finds in no page tab, since a page's words stand in a frame no find
 * reaches, so the tab offers ⌘F itself while its source is drawn.
 */
export function PagePane({
  taskId,
  page,
  readSource,
  findActive,
}: {
  taskId: string;
  page: PageLine;
  readSource: ReadPageSource;
  /** Whether the panel holds the window's keys, so the source's find answers ⌘F. */
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
  const [titleBox, titleClipped] = useClipped();
  return (
    <FindScope
      className="page-view-find"
      active={findActive && showingSource}
      subject={{ task: taskId, tab: { page: page.id } }}
    >
      <div className="page-view file-view ph-no-capture">
        <header className="file-view-bar">
          <Tooltip label={titleClipped ? page.title : undefined}>
            <span ref={titleBox} className="page-view-title">
              {page.title}
            </span>
          </Tooltip>
          <div className="file-view-actions">
            {page.version > 1 ? (
              <>
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
              </>
            ) : null}
            <Tooltip label={toggleLabel}>
              <button
                type="button"
                className="icon-button page-view-source-toggle"
                aria-label={toggleLabel}
                data-source={String(showingSource)}
                onClick={() => setView(showingSource ? PAGE_VIEW.PAGE : PAGE_VIEW.SOURCE)}
              >
                <CodeXmlIcon aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="Reload">
              <button
                type="button"
                className="icon-button"
                aria-label="Reload page"
                onClick={() => {
                  setReloads((was) => was + 1);
                  sources.forget();
                }}
              >
                <RotateCwIcon aria-hidden="true" />
              </button>
            </Tooltip>
            {showingSource ? <SourceMenu read={source} /> : null}
          </div>
        </header>
        {showingSource ? (
          <PageSource
            title={page.title}
            read={source ?? { kind: SOURCE_READ.READING }}
            onRetry={() => ask(version)}
          />
        ) : (
          <iframe
            key={reloads}
            className="page-view-frame"
            title={page.title}
            src={pageFrameUrl({ taskId: taskId, pageId: page.id, version })}
            sandbox={PAGE_SANDBOX}
            allow=""
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </FindScope>
  );
}

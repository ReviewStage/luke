import type { PageLine } from "@sidecar/hosted/page-wire";
import { ChevronLeftIcon, ChevronRightIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { pageFrameUrl } from "#shared/page-frame";
import { Tooltip } from "../tooltip";

/**
 * page-pane.tsx -- one page an agent wrote for the plan, in the side panel: the page itself, drawn at the version chosen, and a bar to step between its versions and reload it.
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
 * plan's, so the pane is left out of the screen recording (`ph-no-capture`);
 * the recording could not see into the frame in any case.
 */

const PAGE_SANDBOX = "allow-scripts";

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

/** The page's tab: its title, its versions where it has more than one, a reload, and the page. */
export function PagePane({ planId, page }: { planId: string; page: PageLine }): React.JSX.Element {
  // The version stepped to, none while the newest is followed.
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const version = chosen === undefined ? page.version : Math.min(chosen, page.version);
  const step = (to: number) => setChosen(to === page.version ? undefined : to);
  return (
    <div className="page-view file-view ph-no-capture">
      <header className="file-view-bar">
        <span className="page-view-title">{page.title}</span>
        <div className="file-view-actions">
          {page.version > 1 ? (
            <>
              <VersionStep
                label="Earlier version"
                to={version > 1 ? version - 1 : undefined}
                icon={<ChevronLeftIcon aria-hidden="true" />}
                onStep={step}
              />
              <span className="page-view-version">
                Version {version} of {page.version}
              </span>
              <VersionStep
                label="Later version"
                to={version < page.version ? version + 1 : undefined}
                icon={<ChevronRightIcon aria-hidden="true" />}
                onStep={step}
              />
            </>
          ) : null}
          <Tooltip label="Reload">
            <button
              type="button"
              className="icon-button"
              aria-label="Reload page"
              onClick={() => setReloads((was) => was + 1)}
            >
              <RotateCwIcon aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>
      <iframe
        key={reloads}
        className="page-view-frame"
        title={page.title}
        src={pageFrameUrl({ planId, pageId: page.id, version })}
        sandbox={PAGE_SANDBOX}
        allow=""
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

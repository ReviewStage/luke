import { ProviderMark } from "@sidecar/panel";
import { useState } from "react";
import { AGENTS, APPS, type RosterEntry } from "./connections-roster";

/**
 * Five drastically different treatments of the same "works with" roster,
 * switchable live on the landing page for design review. This file is a
 * comparison rig, not a shipped surface — once one variant is chosen,
 * `WorksWith.tsx` should absorb it and this file (and the switcher's App.tsx
 * wiring) should come back out.
 *
 * Round two, after feedback on round one: individual black tiles scattered
 * across the light page read as noisy, several rosters felt overstuffed, and
 * Cursor, Radius, Replicas, and Conductor each drew their icon twice — once
 * as an agent, once as the same-named app. `packages/panel/src/provider-marks.tsx`
 * really does render those four agent ids with the exact same mark component
 * as their app counterpart, so `FEATURED_AGENTS` below drops them: apps win
 * the icon, agents keep the name. Every variant here also either puts marks on
 * one deliberate shared dark surface (the thing that read right about the
 * first round's Status Log) rather than many isolated boxes, or shrinks the
 * per-mark tile into a small soft chip instead of a hard black square.
 */

const DUPLICATED_BY_AN_APP_MARK = new Set(["cursor", "radius", "replicas", "conductor"]);

const FEATURED_AGENTS: readonly RosterEntry[] = AGENTS.filter(
  (agent) => !DUPLICATED_BY_AN_APP_MARK.has(agent.id),
);

const VARIANT = {
  PANEL: "panel",
  CONSOLE: "console",
  RAIL: "rail",
  LIST: "list",
  MINIMAL: "minimal",
} as const;

type Variant = (typeof VARIANT)[keyof typeof VARIANT];

const VARIANTS: readonly { readonly id: Variant; readonly label: string }[] = [
  { id: VARIANT.PANEL, label: "Device Panel" },
  { id: VARIANT.CONSOLE, label: "Console" },
  { id: VARIANT.RAIL, label: "Rail Marquee" },
  { id: VARIANT.LIST, label: "Compact List" },
  { id: VARIANT.MINIMAL, label: "Minimal Row" },
];

export function WorksWithSwitcher(): React.JSX.Element {
  const [variant, setVariant] = useState<Variant>(VARIANT.PANEL);

  return (
    <section className="hairline pt-12 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="m-0 text-2xl leading-[1.15] font-semibold tracking-[-0.02em] text-pretty">
            Works with the agents you already run.
          </h2>
          <p className="mt-4 mb-0 max-w-[34rem] text-base text-pretty text-muted-foreground">
            Luke reads what each agent writes about its own sessions — on this machine or in its
            cloud — and tells the agents apart from the apps that hold them, so a Codex chat inside
            Conductor stays one row.
          </p>
        </div>

        <div
          className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1"
          role="tablist"
          aria-label="Works-with presentation"
        >
          {VARIANTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={variant === option.id}
              onClick={() => setVariant(option.id)}
              className={
                variant === option.id
                  ? "rounded-md bg-card px-3 py-1.5 font-mono text-xs font-medium text-foreground shadow-sm"
                  : "rounded-md px-3 py-1.5 font-mono text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10">
        {variant === VARIANT.PANEL && <DevicePanel />}
        {variant === VARIANT.CONSOLE && <Console />}
        {variant === VARIANT.RAIL && <RailMarquee />}
        {variant === VARIANT.LIST && <CompactList />}
        {variant === VARIANT.MINIMAL && <MinimalRow />}
      </div>
    </section>
  );
}

/* 1. Device Panel — one shared dark card, the way the hero mock above is
   already a dark surface on this light page. Apps get the icon treatment,
   full-size and bare (no per-icon box needed — the whole card is already
   dark); the rest of the roster is named, not iconified, as quiet pills. */
function DevicePanel(): React.JSX.Element {
  return (
    <div className="panel-card">
      <p className="panel-eyebrow">Apps</p>
      <div className="panel-app-row">
        {APPS.map((app) => (
          <div className="panel-app" key={app.id}>
            <span className="mark-tile mark-tile--bare panel-app-mark">
              <ProviderMark providerId={app.id} />
            </span>
            <span className="panel-app-name">{app.name}</span>
          </div>
        ))}
      </div>

      <div className="panel-divider" />

      <p className="panel-eyebrow">Also works with</p>
      <div className="panel-agent-row">
        {FEATURED_AGENTS.map((agent) => (
          <span className="panel-agent-pill" key={agent.id}>
            {agent.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* 2. Console — the one thing round one got right, kept and tightened: real
   command output rather than a decorated list. Marks sit bare on the
   terminal's own dark ground instead of inside a second, smaller box, and
   the roster is deduped so nothing prints twice. */
function Console(): React.JSX.Element {
  return (
    <div className="term-window">
      <div className="term-titlebar">
        <span className="term-dot term-dot-red" />
        <span className="term-dot term-dot-yellow" />
        <span className="term-dot term-dot-green" />
        <span className="term-title">luke — observe --all</span>
      </div>
      <div className="term-body">
        <p className="term-line">
          <span className="term-prompt">$</span> luke observe --all
        </p>
        <ConsoleSection label="apps" entries={APPS} />
        <ConsoleSection label="agents" entries={FEATURED_AGENTS} />
        <p className="term-line term-cursor-line">
          <span className="term-prompt">$</span>
          <span className="term-cursor" aria-hidden="true" />
        </p>
      </div>
    </div>
  );
}

function ConsoleSection({
  label,
  entries,
}: {
  label: string;
  entries: readonly RosterEntry[];
}): React.JSX.Element {
  return (
    <>
      <p className="term-line term-heading">{label}:</p>
      {entries.map((entry) => (
        <p className="term-line term-row" key={entry.id}>
          <span className="term-ok">✓</span>
          <span className="mark-tile mark-tile--bare term-mark">
            <ProviderMark providerId={entry.id} />
          </span>
          {entry.name}
        </p>
      ))}
    </>
  );
}

/* 3. Rail Marquee — a single dark rail (not two competing belts) scrolling
   only the apps, since those are what a visitor actually recognizes on
   sight; the rest of the roster is named underneath in plain prose rather
   than drawn twice. */
function RailMarquee(): React.JSX.Element {
  const doubled = [...APPS, ...APPS];
  return (
    <div>
      <div className="rail">
        <div className="rail-track">
          {doubled.map((app, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the roster is doubled for the seamless loop, so app.id repeats.
            <span className="rail-item" key={`${app.id}-${index}`}>
              <span className="mark-tile mark-tile--bare rail-mark">
                <ProviderMark providerId={app.id} />
              </span>
              <span className="rail-name">{app.name}</span>
            </span>
          ))}
        </div>
      </div>
      <p className="rail-footnote">
        Also works with {FEATURED_AGENTS.map((agent) => agent.name).join(", ")}, wherever they run.
      </p>
    </div>
  );
}

/* 4. Compact List — the plainest reading: no card, no border, a small soft
   chip (not a hard black square) beside each name in a wrapped row. */
function CompactList(): React.JSX.Element {
  return (
    <div className="compact-list">
      <CompactGroup label="Apps" entries={APPS} />
      <CompactGroup label="Agents" entries={FEATURED_AGENTS} />
    </div>
  );
}

function CompactGroup({
  label,
  entries,
}: {
  label: string;
  entries: readonly RosterEntry[];
}): React.JSX.Element {
  return (
    <div>
      <h3 className="compact-label">{label}</h3>
      <ul className="compact-items">
        {entries.map((entry) => (
          <li className="compact-item" key={entry.id}>
            <span className="mark-tile mark-tile--soft compact-mark">
              <ProviderMark providerId={entry.id} />
            </span>
            <span className="compact-name">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 5. Minimal Row — the calmest option: a single row of small soft app
   marks, everything else carried as a sentence rather than a chip. */
function MinimalRow(): React.JSX.Element {
  return (
    <div className="minimal-row">
      <div className="minimal-marks">
        {APPS.map((app) => (
          <span className="mark-tile mark-tile--soft minimal-mark" key={app.id} title={app.name}>
            <ProviderMark providerId={app.id} />
          </span>
        ))}
      </div>
      <p className="minimal-copy">
        Shows up wherever you already work — {APPS.map((app) => app.name).join(", ")} — and reads
        what {FEATURED_AGENTS.map((agent) => agent.name).join(", ")}, and more, write about their
        own sessions.
      </p>
    </div>
  );
}

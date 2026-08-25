import { ProviderMark } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useState } from "react";
import { AGENTS, APPS, type RosterEntry } from "./connections-roster";

/**
 * Five drastically different treatments of the same "works with" roster,
 * switchable live on the landing page for design review. This file is a
 * comparison rig, not a shipped surface — once one variant is chosen,
 * `WorksWith.tsx` should absorb it and this file (and the switcher's App.tsx
 * wiring) should come back out.
 */

const VARIANT = {
  GRID: "grid",
  BELT: "belt",
  ORBIT: "orbit",
  LOG: "log",
  INDEX: "index",
} as const;

type Variant = (typeof VARIANT)[keyof typeof VARIANT];

const VARIANTS: readonly { readonly id: Variant; readonly label: string }[] = [
  { id: VARIANT.GRID, label: "Signal Grid" },
  { id: VARIANT.BELT, label: "Rolling Belt" },
  { id: VARIANT.ORBIT, label: "Orbit" },
  { id: VARIANT.LOG, label: "Status Log" },
  { id: VARIANT.INDEX, label: "The Roster" },
];

export function WorksWithSwitcher(): React.JSX.Element {
  const [variant, setVariant] = useState<Variant>(VARIANT.GRID);

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
        {variant === VARIANT.GRID && <SignalGrid />}
        {variant === VARIANT.BELT && <RollingBelt />}
        {variant === VARIANT.ORBIT && <Orbit />}
        {variant === VARIANT.LOG && <StatusLog />}
        {variant === VARIANT.INDEX && <TheRoster />}
      </div>
    </section>
  );
}

/* 1. Signal Grid — a bordered card per provider, mark over name, agents and
   apps each their own responsive grid. The most literal "roster" reading: a
   spec sheet of everything Luke plugs into. */
function SignalGrid(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <GridGroup label="Agents" entries={AGENTS} />
      <GridGroup label="Apps" entries={APPS} />
    </div>
  );
}

function GridGroup({
  label,
  entries,
}: {
  label: string;
  entries: readonly RosterEntry[];
}): React.JSX.Element {
  return (
    <div>
      <h3 className="m-0 font-mono text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </h3>
      <ul className="m-0 mt-3 grid grid-cols-2 gap-2 p-0 sm:grid-cols-3 md:grid-cols-4">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex list-none flex-col items-start gap-3 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-muted-foreground"
          >
            <span className="mark-tile">
              <ProviderMark providerId={entry.id} />
            </span>
            <span className="text-sm font-medium">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 2. Rolling Belt — oversized display type in two counter-scrolling
   marquees, one per roster. Reads as a ticker of everything Luke plugs into
   rather than a reference list. */
function RollingBelt(): React.JSX.Element {
  return (
    <div className="-mx-5 flex flex-col gap-3">
      <BeltRow entries={AGENTS} direction="left" />
      <BeltRow entries={APPS} direction="right" />
    </div>
  );
}

function BeltRow({
  entries,
  direction,
}: {
  entries: readonly RosterEntry[];
  direction: "left" | "right";
}): React.JSX.Element {
  // Doubled so the belt can loop at -50% with no seam.
  const doubled = [...entries, ...entries];
  return (
    <div className="belt-row">
      <div
        className={
          direction === "left" ? "belt-track belt-track-left" : "belt-track belt-track-right"
        }
      >
        {doubled.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the roster is doubled for the seamless loop, so entry.id repeats.
          <span className="belt-item" key={`${entry.id}-${index}`}>
            <span className="mark-tile belt-mark">
              <ProviderMark providerId={entry.id} />
            </span>
            <span className="belt-name">{entry.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* 3. Orbit — Luke's own mark at the center, agents in the inner ring, apps
   in the outer ring, each mark upright and evenly spaced around its circle. */
function Orbit(): React.JSX.Element {
  return (
    <div className="orbit-stage">
      <OrbitRing
        entries={AGENTS}
        radius="clamp(72px, 24vw, 108px)"
        ringClassName="orbit-ring-inner"
      />
      <OrbitRing
        entries={APPS}
        radius="clamp(126px, 40vw, 188px)"
        ringClassName="orbit-ring-outer"
      />
      <div className="orbit-center">
        <span className="orbit-center-dot" aria-hidden="true" />
        <span className="orbit-center-label">Luke</span>
      </div>
    </div>
  );
}

function OrbitRing({
  entries,
  radius,
  ringClassName,
}: {
  entries: readonly RosterEntry[];
  radius: string;
  ringClassName: string;
}): React.JSX.Element {
  return (
    <div
      className={`orbit-ring ${ringClassName}`}
      style={cssCustomProperties({ "--orbit-radius": radius })}
    >
      {entries.map((entry, index) => {
        const angle = (360 / entries.length) * index;
        return (
          <div
            key={entry.id}
            className="orbit-node"
            style={cssCustomProperties({ "--orbit-angle": `${angle}deg` })}
            title={entry.name}
          >
            <span className="mark-tile orbit-mark">
              <ProviderMark providerId={entry.id} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* 4. Status Log — a terminal window reading out `luke observe --all`,
   listing the roster as command output. */
function StatusLog(): React.JSX.Element {
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
        <TermSection label="agents" entries={AGENTS} />
        <TermSection label="apps" entries={APPS} />
        <p className="term-line term-cursor-line">
          <span className="term-prompt">$</span>
          <span className="term-cursor" aria-hidden="true" />
        </p>
      </div>
    </div>
  );
}

function TermSection({
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
          <span className="mark-tile term-mark">
            <ProviderMark providerId={entry.id} />
          </span>
          {entry.name}
        </p>
      ))}
    </>
  );
}

/* 5. The Roster — a print-style typographic directory. No colour, no marks:
   hierarchy carries the whole thing, the way a masthead or an index does. */
function TheRoster(): React.JSX.Element {
  return (
    <div className="index-sheet">
      <IndexColumn label="Agents" entries={AGENTS} />
      <IndexColumn label="Apps" entries={APPS} />
    </div>
  );
}

function IndexColumn({
  label,
  entries,
}: {
  label: string;
  entries: readonly RosterEntry[];
}): React.JSX.Element {
  return (
    <div className="index-column">
      <h3 className="index-heading">{label}</h3>
      <ol className="index-list">
        {entries.map((entry, position) => (
          <li className="index-row" key={entry.id}>
            <span className="index-number">{String(position + 1).padStart(2, "0")}</span>
            <span className="index-name">{entry.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

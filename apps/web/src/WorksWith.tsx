import { ProviderMark } from "@sidecar/panel";
import { AGENTS, APPS, type RosterEntry } from "./connections-roster";

/**
 * The landing page's answer to "does it work with mine?": the agents Luke
 * observes and the apps that hold their sessions, each under its own mark.
 *
 * The roster itself lives in `connections-roster.ts`, walking the product's
 * own id lists in each list's own registry order rather than a hand-written
 * array, so a renamed or removed provider breaks this page's build instead of
 * leaving it advertising one the app no longer knows.
 *
 * `ProviderMark` is `@sidecar/panel`'s own, the same component the desktop
 * panel and the hero mock above draw with — not a duplicate traced from path
 * data, per the standing decision in `packages/surface/AGENTS.md` that
 * `@sidecar/panel` is the one shared React layer for provider marks.
 */
function Roster({
  label,
  entries,
}: {
  label: string;
  entries: readonly RosterEntry[];
}): React.JSX.Element {
  return (
    <div className="mt-8">
      {/* The group label is a technical token rather than a sentence, so it
          takes the mono the page reserves for those. */}
      <h3 className="m-0 font-mono text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </h3>
      <ul className="m-0 mt-4 flex list-none flex-wrap gap-x-7 gap-y-4 p-0">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2.5">
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

export function WorksWith(): React.JSX.Element {
  return (
    <section className="hairline pt-12 pb-16">
      <h2 className="m-0 text-2xl leading-[1.15] font-semibold tracking-[-0.02em] text-pretty">
        Works with the agents you already run.
      </h2>
      <p className="mt-4 mb-0 max-w-[34rem] text-base text-pretty text-muted-foreground">
        Luke reads what each agent writes about its own sessions — on this machine or in its cloud —
        and tells the agents apart from the apps that hold them, so a Codex chat inside Conductor
        stays one row.
      </p>

      <Roster label="Agents" entries={AGENTS} />
      <Roster label="Apps" entries={APPS} />
    </section>
  );
}

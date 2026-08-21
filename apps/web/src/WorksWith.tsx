import { ProviderMark } from "@sidecar/panel";
import {
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_ID_LIST,
  type SessionApplicationId,
} from "@sidecar/session";

/**
 * The landing page's answer to "does it work with mine?": the agents Luke
 * observes and the apps that hold their sessions, each under its own mark.
 *
 * Both rosters walk the product's own id lists — `PROVIDER_ID_LIST` and
 * `SESSION_APPLICATION_ID_LIST` — in each list's own registry order, an agent
 * being a session provider and an app holding agent sessions without becoming
 * their provider. Because the rosters are the id lists rather than a
 * hand-written array, a renamed or removed provider breaks this page's build
 * instead of leaving it advertising one the app no longer knows. Agent names
 * come from the registry's own `displayName`; apps have no such registry, so
 * `APPLICATION_DISPLAY_NAME` stands in as one, typed to require an entry for
 * every id `SESSION_APPLICATION_ID_LIST` can hand it.
 *
 * `ProviderMark` is `@sidecar/panel`'s own, the same component the desktop
 * panel and the hero mock above draw with — not a duplicate traced from path
 * data, per the standing decision in `packages/surface/AGENTS.md` that
 * `@sidecar/panel` is the one shared React layer for provider marks.
 */
interface RosterEntry {
  readonly id: string;
  readonly name: string;
}

const AGENTS: readonly RosterEntry[] = PROVIDER_ID_LIST.map((id) => ({
  id,
  name: PROVIDER_IDENTITY_BY_ID[id].displayName,
}));

const APPLICATION_DISPLAY_NAME = {
  [SESSION_APPLICATION_ID.CHATGPT]: "ChatGPT",
  [SESSION_APPLICATION_ID.CMUX]: "cmux",
  [SESSION_APPLICATION_ID.CONDUCTOR]: "Conductor",
  [SESSION_APPLICATION_ID.CURSOR]: "Cursor",
  [SESSION_APPLICATION_ID.ORCA]: "Orca",
  [SESSION_APPLICATION_ID.RADIUS]: "Radius",
  [SESSION_APPLICATION_ID.REPLICAS]: "Replicas",
  [SESSION_APPLICATION_ID.SUPERSET]: "Superset",
} as const satisfies Readonly<Record<SessionApplicationId, string>>;

const APPS: readonly RosterEntry[] = SESSION_APPLICATION_ID_LIST.map((id) => ({
  id,
  name: APPLICATION_DISPLAY_NAME[id],
}));

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

import { ProviderMark } from "@sidecar/panel";
import {
  PROVIDER_IDENTITY_BY_ID,
  PROVIDER_LOCATION_KIND,
  type ProviderLocationKind,
} from "@sidecar/session";

/**
 * Every agent Luke observes, read from the same narrow identity catalog the
 * README's platform table is generated from. The page states no list of its
 * own: an adapter added to the product appears here at the next build, and one
 * removed leaves, which is the only way a marketing page can promise a
 * provider without a person having to remember it.
 *
 * Alphabetical, like the generated table, so the wall and the README read in
 * the same order.
 */
const AGENTS = Object.values(PROVIDER_IDENTITY_BY_ID).toSorted((left, right) =>
  left.displayName.localeCompare(right.displayName),
);

export const AGENT_COUNT = AGENTS.length;

/** Where a provider's sessions run, worded as the tag under each mark. */
const LOCATION_TAGS = {
  [PROVIDER_LOCATION_KIND.LOCAL]: ["local"],
  [PROVIDER_LOCATION_KIND.CLOUD]: ["cloud"],
  [PROVIDER_LOCATION_KIND.LOCAL_AND_CLOUD]: ["local", "cloud"],
} as const satisfies Readonly<Record<ProviderLocationKind, readonly string[]>>;

export function AgentWall(): React.JSX.Element {
  return (
    /* Chips that wrap rather than a ruled grid: the catalog is whatever length
       the product's is, and a grid of cells leaves the last row ragged the day
       an adapter lands. `provider-brand` is what paints the marks — the same
       scope the mock draws its rows under — and the inherited colour is what
       every mark without a brand colour of its own falls back to. */
    <ul className="provider-brand m-0 flex list-none flex-wrap gap-2 p-0 text-foreground">
      {AGENTS.map((agent) => (
        <li
          className="flex items-center gap-2.5 rounded-lg border border-border bg-card py-2.5 pr-4 pl-3 transition-colors duration-150 hover:border-muted-foreground motion-reduce:transition-none"
          key={agent.id}
        >
          <span className="grid size-5 shrink-0 place-items-center [&>svg]:size-5">
            <ProviderMark providerId={agent.id} />
          </span>
          <span>
            <span className="block text-sm leading-tight font-medium">{agent.displayName}</span>
            <span className="block font-mono text-[0.6875rem] text-muted-foreground">
              {LOCATION_TAGS[agent.location].join(" · ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

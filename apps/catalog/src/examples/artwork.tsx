import { harnessNameOf } from "@repo/features/agent-runtime-models";
import {
  AUTOMATION_FIRING,
  type AutomationFiring,
  type AutomationTrigger,
  GITHUB_TRIGGER_EVENT,
} from "@repo/features/automation-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import * as ui from "@repo/ui";
import {
  FiringGlyph,
  HarnessMark,
  MARK_PROVIDER,
  PROVIDER_MARK_SIZE,
  ProductMark,
  ProviderMark,
} from "@repo/ui";
import codexOneX from "../../../../packages/panel/marks/codex-16.png";
import codexTwoX from "../../../../packages/panel/marks/codex-32.png";
import codexThreeX from "../../../../packages/panel/marks/codex-48.png";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * artwork.tsx -- the production artwork `@repo/ui` draws from `@repo/brand`'s
 * generated sources: the product's mark, every glyph, every provider's
 * mark, and what fires an automation, each drawn from the package itself
 * rather than from a copy.
 */

/** Codex's picture as the desktop serves it, from the panel's own files. */
const CODEX_ART = { oneX: codexOneX, twoX: codexTwoX, threeX: codexThreeX };

/** One of each thing that fires an automation or a run, as its row's glyph draws it. Synthetic. */
const FIRINGS = [
  {
    name: "Schedule",
    of: { kind: AUTOMATION_FIRING.SCHEDULE, cron: "0 9 * * 1-5", timezone: "America/New_York" },
  },
  {
    name: "GitHub",
    of: { kind: AUTOMATION_FIRING.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED },
  },
  {
    name: "Sentry",
    of: {
      kind: AUTOMATION_FIRING.INTEGRATION,
      provider: TRIGGER_PROVIDER.SENTRY,
      event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
    },
  },
  { name: "Webhook", of: { kind: AUTOMATION_FIRING.WEBHOOK } },
  { name: "Run now", of: { kind: AUTOMATION_FIRING.MANUAL } },
] as const satisfies readonly { name: string; of: AutomationFiring | AutomationTrigger }[];

/** A glyph's name as `@repo/ui` exports it: every glyph ends in `Icon`, a heading's starts with `Heading`. */
type GlyphName = Extract<keyof typeof ui, `${string}Icon` | `Heading${string}`>;

/** Whether an export of the package is a glyph, by the name it is exported under. */
function isGlyph(entry: [string, unknown]): entry is [GlyphName, (typeof ui)[GlyphName]] {
  return entry[0].endsWith("Icon") || entry[0].startsWith("Heading");
}

/** Every glyph `face/glyphs.tsx` draws, by the name it is exported under, read off the package so none is left out. */
const GLYPHS = Object.entries(ui).filter(isGlyph);

function Artwork(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="artwork-mark" title="Mark">
        <div className="catalog-mark">
          <ProductMark />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-mark-muted" title="Muted mark, filling its box">
        <div className="catalog-mark">
          <ProductMark muted fill />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-mark-inherit" title="Mark in its holder's ink, filling its box">
        <div className="catalog-mark">
          <ProductMark fill inherit />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-mark-small" title="The small cut, for 32 pixels and under">
        <div className="catalog-mark catalog-mark-small">
          <ProductMark fill small />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-glyphs" title="Glyphs">
        <ul className="catalog-tiles">
          {GLYPHS.map(([name, Glyph]) => (
            <li key={name} className="catalog-tile">
              <span className="catalog-glyph">
                <Glyph />
              </span>
              <span className="catalog-tile-name">{name}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
      <CatalogSection id="artwork-harness-marks" title="Harness marks">
        <ul className="catalog-tiles">
          {Object.values(MODEL_PROVIDER).map((provider) => (
            <li key={provider} className="catalog-tile">
              <span className="catalog-glyph">
                <HarnessMark provider={provider} codexArt={CODEX_ART} />
              </span>
              <span className="catalog-tile-name">{harnessNameOf(provider)}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
      <CatalogSection id="artwork-firings" title="What fires an automation">
        <ul className="catalog-tiles">
          {FIRINGS.map(({ name, of }) => (
            <li key={name} className="catalog-tile">
              <span className="catalog-glyph">
                <FiringGlyph of={of} />
              </span>
              <span className="catalog-tile-name">{name}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
      <CatalogSection id="artwork-marks" title="Provider marks">
        <ul className="catalog-tiles">
          {Object.values(MARK_PROVIDER).map((provider) => (
            <li key={provider} className="catalog-tile">
              <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ROW} />
              <span className="catalog-tile-name">{provider}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
    </>
  );
}

export const ARTWORK_EXAMPLE: Example = { id: "artwork", title: "Artwork", Render: Artwork };

import { type ReactNode, useId } from "react";
import {
  LANDING_SCENE,
  LandingHeroScene,
  type LandingScene,
  LandingSceneView,
} from "./landing-scenes.js";
import { SiteFrame } from "./site-frame.js";

export { SiteBarPages } from "./site-frame.js";

/**
 * landing-page.tsx -- the product's landing: a bar that floats once the page scrolls, the one line centered over the Inbox at work, a section per feature each centered over a moving screen, and a close.
 *
 * It stands in the site's frame (`site-frame.tsx`), plain: no rails and no
 * wordmark under the foot, because the page sets its own grounds, each
 * section a band of the page's ground or of a slightly lifted one in turn.
 * The composition is centered, as a product page is: a large heading and
 * one sentence over a stage, a soft, round-cornered tile holding the
 * feature's screen, the app's own components playing a short story
 * (`landing-scenes.tsx`), with an aside beside it where the caller gives
 * one. The close carries the page's last call.
 *
 * Its words and its links are the caller's; its art, scenes, and rhythm are
 * its own, drawn in the theme's roles and the web profile's display styles
 * (`tokens/display.css`). It is drawn in `landing.css`.
 */

export { LANDING_SCENE, type LandingScene };

/** A feature: `title` and `lead` over its scene's stage, `aside` beside the stage where given. */
export function LandingSection({
  title,
  lead,
  scene,
  aside,
}: {
  title: ReactNode;
  lead: ReactNode;
  scene: LandingScene;
  /** What stands beside the stage, such as `LandingFacts`; none lets the stage take the column. */
  aside?: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const stage = (
    <div className="ui-landing-stage" data-scene={scene}>
      <LandingSceneView scene={scene} />
    </div>
  );
  return (
    <section className="ui-landing-section" aria-labelledby={titleId}>
      <div className="ui-landing-section-body">
        <h2 className="ui-landing-section-title" id={titleId}>
          {title}
        </h2>
        <p className="ui-landing-lead">{lead}</p>
        {aside === undefined ? (
          stage
        ) : (
          <div className="ui-landing-beside">
            {stage}
            {aside}
          </div>
        )}
      </div>
    </section>
  );
}

/** A short list of facts, each a name and a sentence, ruled one from the next. */
export function LandingFacts({
  facts,
}: {
  facts: readonly { readonly title: string; readonly detail: ReactNode }[];
}): React.JSX.Element {
  return (
    <dl className="ui-landing-facts">
      {facts.map((fact) => (
        <div key={fact.title} className="ui-landing-fact">
          <dt>{fact.title}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The landing: `bar` over the hero's `title`, `lead`, and `actions` over the Inbox, the sections, the `close`, and the `footer` over the wordmark. */
export function LandingPage({
  bar,
  barCall,
  title,
  lead,
  actions,
  children,
  close,
  footer,
}: {
  /** The site's wordmark and links, laid across the bar. */
  bar: ReactNode;
  /** The bar's call at its end, which a page narrower than a phone's leaves to the hero. */
  barCall?: ReactNode;
  /** The page's one line, its `h1`. */
  title: ReactNode;
  /** The sentence under the line; none sets the calls under the line itself. */
  lead?: ReactNode;
  /** The hero's calls, under its lead. */
  actions: ReactNode;
  /** The page's `LandingSection`s. */
  children: ReactNode;
  /** The page's last call: a heading, an optional sentence, and its calls. */
  close: { readonly title: ReactNode; readonly lead?: ReactNode; readonly actions: ReactNode };
  /** The site's closing links and notices. */
  footer: ReactNode;
}): React.JSX.Element {
  const closeId = `${useId()}close`;
  return (
    <SiteFrame bar={bar} barCall={barCall} footer={footer} plain>
      <main>
        <div className="ui-landing-hero">
          <div className="ui-landing-hero-words">
            <h1 className="ui-landing-title">{title}</h1>
            {lead === undefined ? null : <p className="ui-landing-hero-lead">{lead}</p>}
            <div className="ui-landing-actions">{actions}</div>
          </div>
          <div className="ui-landing-hero-art">
            <LandingHeroScene />
          </div>
        </div>
        {children}
        <section className="ui-landing-close" aria-labelledby={closeId}>
          <div>
            <h2 className="ui-landing-section-title" id={closeId}>
              {close.title}
            </h2>
            {close.lead === undefined ? null : <p className="ui-landing-lead">{close.lead}</p>}
          </div>
          <div className="ui-landing-actions">{close.actions}</div>
        </section>
      </main>
    </SiteFrame>
  );
}

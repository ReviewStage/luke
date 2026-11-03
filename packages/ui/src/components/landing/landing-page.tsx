import { type ReactNode, useId } from "react";
import { MarkOrb } from "../../marks/mark-orb.js";
import { LANDING_FIELD, LandingField, type LandingFieldPattern } from "./landing-field.js";
import { LANDING_SCENE, type LandingScene, LandingSceneView } from "./landing-scenes.js";
import { SiteFrame, SiteRule } from "./site-frame.js";

/**
 * landing-page.tsx -- the product's landing: a bar that floats once the page scrolls, the one line beside the copper ball, a section per feature each over a moving screen, and a close over the wordmark in dots.
 *
 * It stands in the site's frame (`site-frame.tsx`): the margin grid's
 * rails, the bar that floats once the page scrolls, and the foot over the
 * wordmark; every section opens under a rule across the rails with a cross
 * where they meet. A section is a heading and a sentence over a
 * stage, a box of drifting copper dots holding the feature's screen, the
 * app's own components playing a short story (`landing-scenes.tsx`), with
 * an aside beside it where the caller gives one. The close carries the
 * page's last call.
 *
 * Its words and its links are the caller's; its art, scenes, and rhythm are
 * its own, drawn in the theme's roles and the web profile's display styles
 * (`tokens/display.css`). It is drawn in `landing.css`.
 */

export { LANDING_SCENE, type LandingScene };

/** The field behind each scene's stage. */
const SCENE_FIELD: Readonly<Record<LandingScene, LandingFieldPattern>> = {
  [LANDING_SCENE.INBOX]: LANDING_FIELD.FLOW,
  [LANDING_SCENE.AGENTS]: LANDING_FIELD.WAVES,
  [LANDING_SCENE.AUTOMATIONS]: LANDING_FIELD.RINGS,
  [LANDING_SCENE.DEVICES]: LANDING_FIELD.FLOW,
  [LANDING_SCENE.MODELS]: LANDING_FIELD.WAVES,
};

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
      <LandingField pattern={SCENE_FIELD[scene]} />
      <LandingSceneView scene={scene} />
    </div>
  );
  return (
    <section className="ui-landing-section" aria-labelledby={titleId}>
      <SiteRule />
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

/** The landing: `bar` over the hero's `title`, `lead`, and `actions` beside the ball, the sections, the `close`, and the `footer` over the wordmark. */
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
  lead: ReactNode;
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
    <SiteFrame bar={bar} barCall={barCall} footer={footer}>
      <main>
        <div className="ui-landing-hero">
          <div className="ui-landing-hero-words">
            <h1 className="ui-landing-title">{title}</h1>
            <p className="ui-landing-hero-lead">{lead}</p>
            <div className="ui-landing-actions">{actions}</div>
          </div>
          <div className="ui-landing-hero-art">
            <MarkOrb />
          </div>
        </div>
        {children}
        <SiteRule />
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

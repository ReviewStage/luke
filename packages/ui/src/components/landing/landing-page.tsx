import { type ReactNode, useEffect, useId, useState } from "react";
import { MarkOrb } from "../../marks/mark-orb.js";
import {
  LANDING_FIELD,
  LandingField,
  type LandingFieldPattern,
  LandingWordmark,
} from "./landing-field.js";
import { LANDING_SCENE, type LandingScene, LandingSceneView } from "./landing-scenes.js";

/**
 * landing-page.tsx -- the product's landing: a bar that floats once the page scrolls, the one line beside the copper ball, a section per feature each over a moving screen, and a close over the wordmark in dots.
 *
 * The page sets a margin grid: two hairline rails run its length at the
 * content's edges, and every section opens under a rule across them with a
 * cross where they meet. The bar spans the page at its top and, once the
 * reader scrolls, narrows into a floating pill on the ground's surface,
 * standing over the rails. A section is a heading and a sentence over a
 * stage, a box of drifting copper dots holding the feature's screen, the
 * app's own components playing a short story (`landing-scenes.tsx`), with
 * an aside beside it where the caller gives one. The close carries the
 * page's last call, and the foot the site's links over the wordmark.
 *
 * Its words and its links are the caller's; its art, scenes, and rhythm are
 * its own, drawn in the theme's roles and the web profile's display styles
 * (`tokens/display.css`). It is drawn in `landing.css`.
 */

export { LANDING_SCENE, type LandingScene };

/**
 * How far the reader scrolls before the bar floats, and how near the top
 * they come back before it spans the page again, in CSS pixels. Note that
 * the two differ, because a phone's scroll bounces past the top and its
 * toolbar's collapse nudges the offset, which would flip one threshold back
 * and forth mid-animation.
 */
const FLOAT = { AFTER: 24, BEFORE: 4 } as const;

/** The field behind each scene's stage. */
const SCENE_FIELD: Readonly<Record<LandingScene, LandingFieldPattern>> = {
  [LANDING_SCENE.INBOX]: LANDING_FIELD.FLOW,
  [LANDING_SCENE.AGENTS]: LANDING_FIELD.WAVES,
  [LANDING_SCENE.AUTOMATIONS]: LANDING_FIELD.RINGS,
  [LANDING_SCENE.DEVICES]: LANDING_FIELD.FLOW,
  [LANDING_SCENE.MODELS]: LANDING_FIELD.WAVES,
};

/** Whether the page has scrolled past the bar's own height, so the bar floats. */
function useFloating(): boolean {
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    const read = (): void =>
      setFloating((was) => (was ? window.scrollY > FLOAT.BEFORE : window.scrollY > FLOAT.AFTER));
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return floating;
}

/** A rule across the page, a cross where it meets each rail. */
function Rule(): React.JSX.Element {
  return (
    <div className="ui-landing-rule" aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

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
      <Rule />
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
  /** The page's last call: a heading, a sentence, and its calls. */
  close: { readonly title: ReactNode; readonly lead: ReactNode; readonly actions: ReactNode };
  /** The site's closing links and notices. */
  footer: ReactNode;
}): React.JSX.Element {
  const floating = useFloating();
  const closeId = `${useId()}close`;
  return (
    <div className="ui-landing-page">
      <div className="ui-landing-rails" aria-hidden="true" />
      <header className="ui-landing-bar" data-floating={floating}>
        <div className="ui-landing-bar-in">
          {bar}
          {barCall === undefined ? null : <span className="ui-landing-bar-call">{barCall}</span>}
        </div>
      </header>
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
        <Rule />
        <section className="ui-landing-close" aria-labelledby={closeId}>
          <div>
            <h2 className="ui-landing-section-title" id={closeId}>
              {close.title}
            </h2>
            <p className="ui-landing-lead">{close.lead}</p>
          </div>
          <div className="ui-landing-actions">{close.actions}</div>
        </section>
      </main>
      <footer className="ui-landing-foot">
        <div className="ui-landing-foot-links">{footer}</div>
        <div className="ui-landing-foot-art">
          <LandingWordmark />
        </div>
      </footer>
    </div>
  );
}

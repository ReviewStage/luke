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

/** How far the reader scrolls before the bar floats, in CSS pixels. */
const FLOAT_AFTER = 24;

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
    const read = (): void => setFloating(window.scrollY > FLOAT_AFTER);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return floating;
}

/** A rule across the page, a cross where it meets each rail. */
function Rule(): React.JSX.Element {
  return (
    <div className="luke-landing-rule" aria-hidden="true">
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
    <div className="luke-landing-stage" data-scene={scene}>
      <LandingField pattern={SCENE_FIELD[scene]} />
      <LandingSceneView scene={scene} />
    </div>
  );
  return (
    <section className="luke-landing-section" aria-labelledby={titleId}>
      <Rule />
      <div className="luke-landing-section-body">
        <h2 className="luke-landing-section-title" id={titleId}>
          {title}
        </h2>
        <p className="luke-landing-lead">{lead}</p>
        {aside === undefined ? (
          stage
        ) : (
          <div className="luke-landing-beside">
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
    <dl className="luke-landing-facts">
      {facts.map((fact) => (
        <div key={fact.title} className="luke-landing-fact">
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
    <div className="luke-landing-page">
      <div className="luke-landing-rails" aria-hidden="true" />
      <header className="luke-landing-bar" data-floating={floating}>
        <div className="luke-landing-bar-in">
          {bar}
          {barCall === undefined ? null : <span className="luke-landing-bar-call">{barCall}</span>}
        </div>
      </header>
      <main>
        <div className="luke-landing-hero">
          <div className="luke-landing-hero-words">
            <h1 className="luke-landing-title">{title}</h1>
            <p className="luke-landing-hero-lead">{lead}</p>
            <div className="luke-landing-actions">{actions}</div>
          </div>
          <div className="luke-landing-hero-art">
            <MarkOrb />
          </div>
        </div>
        {children}
      </main>
      <footer className="luke-landing-foot">
        <Rule />
        <section className="luke-landing-close" aria-labelledby={closeId}>
          <div>
            <h2 className="luke-landing-section-title" id={closeId}>
              {close.title}
            </h2>
            <p className="luke-landing-lead">{close.lead}</p>
          </div>
          <div className="luke-landing-actions">{close.actions}</div>
        </section>
        <div className="luke-landing-foot-links">{footer}</div>
        <div className="luke-landing-foot-art">
          <LandingWordmark />
        </div>
      </footer>
    </div>
  );
}

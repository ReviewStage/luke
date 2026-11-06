import { type ReactNode, useId } from "react";
import { MarkOrb } from "../../marks/mark-orb.js";
import { LANDING_FIELD, LandingField, type LandingFieldPattern } from "./landing-field.js";
import { LANDING_SCENE, type LandingScene, LandingSceneView } from "./landing-scenes.js";
import { SiteFrame, SiteRule } from "./site-frame.js";

export { SiteBarPages } from "./site-frame.js";

export { LANDING_SCENE, type LandingScene };

const SCENE_FIELD: Readonly<Record<LandingScene, LandingFieldPattern>> = {
  [LANDING_SCENE.INBOX]: LANDING_FIELD.FLOW,
  [LANDING_SCENE.AGENTS]: LANDING_FIELD.WAVES,
  [LANDING_SCENE.AUTOMATIONS]: LANDING_FIELD.RINGS,
  [LANDING_SCENE.DEVICES]: LANDING_FIELD.FLOW,
  [LANDING_SCENE.KEYS]: LANDING_FIELD.WAVES,
};

export function LandingSection({
  title,
  lead,
  scene,
  aside,
}: {
  title: ReactNode;
  lead: ReactNode;
  scene: LandingScene;
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
  bar: ReactNode;
  barCall?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  close: { readonly title: ReactNode; readonly lead?: ReactNode; readonly actions: ReactNode };
  footer: ReactNode;
}): React.JSX.Element {
  const closeId = `${useId()}close`;
  return (
    <SiteFrame bar={bar} barCall={barCall} footer={footer}>
      <main>
        <div className="ui-landing-hero">
          <div className="ui-landing-hero-words">
            <h1 className="ui-landing-title">{title}</h1>
            {lead === undefined ? null : <p className="ui-landing-hero-lead">{lead}</p>}
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

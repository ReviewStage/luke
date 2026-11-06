import type { ReactNode } from "react";
import { LandingDotWords } from "./landing-wordmark.js";
import { SiteFrame, SiteRule } from "./site-frame.js";

export function LostPage({
  bar,
  barCall,
  footer,
  address,
  title,
  lead,
  actions,
}: {
  bar: ReactNode;
  barCall?: ReactNode;
  footer: ReactNode;
  address?: string | undefined;
  title: ReactNode;
  lead: ReactNode;
  actions: ReactNode;
}): React.JSX.Element {
  return (
    <SiteFrame bar={bar} barCall={barCall} footer={footer}>
      <main className="ui-landing-lost">
        <div className="ui-landing-lost-art" aria-hidden="true">
          <LandingDotWords words="404" />
        </div>
        <div className="ui-landing-lost-words">
          <p className="ui-landing-lost-address">
            <span>404</span>
            {address === undefined ? null : <span>{address}</span>}
          </p>
          <h1 className="ui-landing-title">{title}</h1>
          <p className="ui-landing-hero-lead">{lead}</p>
          <div className="ui-landing-actions">{actions}</div>
        </div>
      </main>
      <SiteRule />
    </SiteFrame>
  );
}

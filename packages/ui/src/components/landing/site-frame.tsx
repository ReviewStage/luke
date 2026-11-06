import { type ReactNode, useEffect, useState } from "react";
import { LandingWordmark } from "./landing-wordmark.js";

const FLOAT = { AFTER: 24, BEFORE: 4 } as const;

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

export function SiteRule(): React.JSX.Element {
  return (
    <div className="ui-landing-rule" aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

export function SiteBarPages({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="ui-landing-bar-pages">{children}</span>;
}

export function SiteFrame({
  bar,
  barCall,
  footer,
  children,
}: {
  bar?: ReactNode;
  barCall?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const floating = useFloating();
  return (
    <div className="ui-landing-page">
      <div className="ui-landing-rails" aria-hidden="true" />
      {bar === undefined || bar === null ? null : (
        <header className="ui-landing-bar" data-floating={floating}>
          <div className="ui-landing-bar-in">
            {bar}
            {barCall === undefined ? null : <span className="ui-landing-bar-call">{barCall}</span>}
          </div>
        </header>
      )}
      {children}
      {footer === undefined || footer === null ? null : (
        <footer className="ui-landing-foot">
          <div className="ui-landing-foot-links">{footer}</div>
          <div className="ui-landing-foot-art">
            <LandingWordmark />
          </div>
        </footer>
      )}
    </div>
  );
}

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { captureSiteEvent, identifySiteVisitor, SITE_EVENT, startSiteAnalytics } from "./analytics";
import { AUTH_CARD, AUTH_PILL, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import { LukeMark } from "./SiteChrome";
import "./styles.css";

const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

function Consent(): React.JSX.Element {
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    void authClient.oauth2.consent({ accept: true }).then(async (result) => {
      if (result.error) {
        setFailure(true);
        return;
      }
      // Where the two halves of the funnel join. The desktop's counts resolve
      // to the same account id from the bearer token, so naming the visitor by
      // it here links the page views they arrived through to the account they
      // just made. The id alone travels: no email, no name, no provider.
      const session = await authClient.getSession();
      const userId = session.data?.user.id;
      if (userId) identifySiteVisitor(userId);
      captureSiteEvent(SITE_EVENT.SIGN_IN_COMPLETE);
    });
  }, []);
  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD}>
        {/* The full mark, not a pair of dots: the card is the one thing on the
            page, so it carries the same face the product and the landing page
            wear. */}
        <div className="inline-flex w-13" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <div>
          {/* One word saying where things stand, in the state palette the
              product uses. */}
          <span className={AUTH_PILL} data-tone={failure ? "attention" : "settled"}>
            {failure ? "Not completed" : "Confirming"}
          </span>
        </div>
        <h1 className={AUTH_TITLE}>
          {failure ? "Luke could not continue" : "Continuing to Luke…"}
        </h1>
        <p className="m-0 text-muted-foreground">
          {failure ? "Return to Luke and start sign-in again." : "This window will close soon."}
        </p>
      </section>
    </main>
  );
}

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <Consent />
  </StrictMode>,
);

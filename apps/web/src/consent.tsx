import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { AUTH_STATUS_TONE, AuthPage } from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { captureSiteEvent, identifySiteVisitor, SITE_EVENT, startSiteAnalytics } from "./analytics";
import { LukeMark } from "./SiteChrome";
import "./styles.css";

const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

/**
 * The card carries the full mark, not a pair of dots: it is the one thing on
 * the page, so it wears the same face the product and the landing page wear.
 * One word says where things stand, in the state palette the product uses.
 */
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
      // just made.
      const account = (await authClient.getSession()).data?.user;
      if (account) {
        identifySiteVisitor(account.id, { name: account.name, email: account.email });
      }
      captureSiteEvent(SITE_EVENT.SIGN_IN_COMPLETE);
    });
  }, []);
  // The full mark, not a pair of dots: the card is the one thing on the
  // page, so it carries the same face the product and the landing page wear.
  // One word says where things stand, in the state palette the product uses.
  return (
    <AuthPage
      mark={
        <span className="inline-flex w-13">
          <LukeMark className="h-auto w-full" />
        </span>
      }
      status={
        failure
          ? { tone: AUTH_STATUS_TONE.ATTENTION, label: "Not completed" }
          : { tone: AUTH_STATUS_TONE.SETTLED, label: "Confirming" }
      }
      title={failure ? "Luke could not continue" : "Continuing to Luke…"}
      description={
        failure ? "Return to Luke and start sign-in again." : "This window will close soon."
      }
    />
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

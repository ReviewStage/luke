import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { AUTH_STATUS_TONE, AuthPage } from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { completeSiteSignIn, startSiteAnalytics } from "./analytics";
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
    const signedIn = authClient
      .getSession()
      .then((answer) => answer.data)
      .catch(() => null);
    void authClient.oauth2.consent({ accept: true }).then(async (result) => {
      if (result.error) {
        setFailure(true);
        return;
      }
      // Note that the desktop's client skips this page, so its hand-off
      // (`desktop-session.tsx`) is where a sign-in is usually counted; one
      // that passes both is counted once, by its session.
      await completeSiteSignIn(signedIn);
    });
  }, []);
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

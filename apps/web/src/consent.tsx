import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { LANDING_TONE } from "@luke/features/landing-outcome";
import { AuthMark, AuthPage } from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";
import { completeSiteSignIn, signInCountDeadline, startSiteAnalytics } from "./analytics";
import { openLukeFromMac } from "./open-luke";
import "./styles.css";
import { mountPrerenderedPage } from "./mount-page";

const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

/**
 * The page opens on Luke's mark, unbadged while the consent goes through,
 * badged as failed where it could not, when the title says so and Open
 * Luke goes back to start again.
 */
function Consent(): React.JSX.Element {
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    const signedIn = authClient
      .getSession({ fetchOptions: { signal: signInCountDeadline() } })
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
      mark={<AuthMark tone={failure ? LANDING_TONE.FAILED : undefined} />}
      title={failure ? "Luke could not continue" : "Continuing to Luke…"}
      description={failure ? "Start sign-in again." : "This window will close soon."}
      action={failure ? openLukeFromMac() : undefined}
    />
  );
}

startSiteAnalytics();

mountPrerenderedPage(<Consent />);

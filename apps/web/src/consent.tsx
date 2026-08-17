import "@fontsource-variable/bricolage-grotesque/wght.css";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LukeMark } from "./SiteChrome";
import "./styles.css";

const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

function Consent(): React.JSX.Element {
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    void authClient.oauth2.consent({ accept: true }).then((result) => {
      if (result.error) setFailure(true);
    });
  }, []);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-mark" aria-hidden="true">
          <LukeMark />
        </div>
        <div>
          <span className="auth-pill" data-tone={failure ? "attention" : "settled"}>
            {failure ? "Not completed" : "Confirming"}
          </span>
        </div>
        <h1>{failure ? "Luke could not continue" : "Continuing to Luke…"}</h1>
        <p>
          {failure ? "Return to Luke and start sign-in again." : "This window will close soon."}
        </p>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <Consent />
  </StrictMode>,
);

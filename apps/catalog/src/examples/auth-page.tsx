import {
  AUTH_STATUS_TONE,
  AuthPage,
  BUTTON_VARIANT,
  Button,
  FormField,
  MARK_PROVIDER,
  ProviderMark,
  TEXT_FIELD_TYPE,
  TextField,
  WingFace,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * auth-page.tsx -- the sign-in card with its provider choices, the consent
 * card in both its states, and a form with an error on a phone's width, each
 * in a frame the size of the screen it stands for. Every name and address is
 * made up.
 */

function Face(): React.JSX.Element {
  return (
    <span className="catalog-auth-mark">
      <WingFace />
    </span>
  );
}

function ProviderChoices(): React.JSX.Element {
  return (
    <>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<ProviderMark provider={MARK_PROVIDER.GOOGLE} className="catalog-auth-provider" />}
      >
        Continue with Google
      </Button>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} className="catalog-auth-provider" />}
      >
        Continue with GitHub
      </Button>
    </>
  );
}

function EmailForm(): React.JSX.Element {
  const [email, setEmail] = useState("someone@acme-corporation.example");
  return (
    <>
      <FormField label="Work email" description="Luke sends a sign-in link to it.">
        {(control) => (
          <TextField
            field={control}
            type={TEXT_FIELD_TYPE.EMAIL}
            value={email}
            onChange={setEmail}
          />
        )}
      </FormField>
      <Button variant={BUTTON_VARIANT.PRIMARY}>Send the link</Button>
    </>
  );
}

function AuthPages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="auth-providers" title="Provider choices">
        <div className="catalog-screen">
          <AuthPage
            mark={<Face />}
            title="Sign in to Luke"
            footnote="You can close this window after Luke confirms the sign-in."
          >
            <ProviderChoices />
          </AuthPage>
        </div>
      </CatalogSection>
      <CatalogSection id="auth-status" title="Status, settled and failed">
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<Face />}
              status={{ tone: AUTH_STATUS_TONE.SETTLED, label: "Confirming" }}
              title="Continuing to Luke…"
              description="This window will close soon."
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<Face />}
              status={{ tone: AUTH_STATUS_TONE.ATTENTION, label: "Not completed" }}
              title="Luke could not continue"
              description="Return to Luke and start sign-in again."
            />
          </div>
        </div>
      </CatalogSection>
      <CatalogSection id="auth-narrow" title="Phone width, a form, long words, an error">
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<Face />}
              title="Join acme-corporation-engineering-platform"
              description="Sign in with the provider your workspace administrator connected."
              error="The provider refused the request. Try again, or ask an administrator."
            >
              <ProviderChoices />
            </AuthPage>
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage mark={<Face />} title="Sign in with email">
              <EmailForm />
            </AuthPage>
          </div>
        </div>
      </CatalogSection>
    </>
  );
}

export const AUTH_PAGE_EXAMPLE: Example = {
  id: "auth-page",
  title: "Auth page",
  Render: AuthPages,
};

import { LANDING_TONE } from "@luke/features/landing-outcome";
import {
  AuthMark,
  AuthPage,
  BUTTON_VARIANT,
  Button,
  FormField,
  MARK_PROVIDER,
  ProviderButton,
  SocialSignInCard,
  TEXT_FIELD_TYPE,
  TextField,
  WingFace,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * auth-page.tsx -- the sign-in page with its provider choices, a landing's
 * ringed mark on its way, settled, and failed, with and
 * without Open Luke, and a form with an error on a phone's width, each in a
 * frame the size of the screen it stands for. Every name and address is
 * made up.
 */

/** Open Luke as a page offers it; the catalog goes nowhere. */
const OPEN_LUKE = { label: "Open Luke", href: "#" } as const;

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
      <ProviderButton provider={MARK_PROVIDER.GOOGLE} name="Google" onPress={() => undefined} />
      <ProviderButton provider={MARK_PROVIDER.GITHUB} name="GitHub" onPress={() => undefined} />
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
      <CatalogSection id="auth-social-card" title="Social sign-in card, opening and failed">
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <SocialSignInCard
              mark={<Face />}
              title="Luke admin"
              pending={undefined}
              onPress={() => undefined}
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <SocialSignInCard
              mark={<Face />}
              title="Sign in to accept your invitation"
              description="Sign in with the account that uses someone@acme-corporation.example."
              pending="github"
              failed
              onPress={() => undefined}
            />
          </div>
        </div>
      </CatalogSection>
      <CatalogSection id="auth-landing" title="Landing, on its way, settled, and failed">
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark provider={MARK_PROVIDER.GITHUB} />}
              title="Connecting GitHub…"
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark provider={MARK_PROVIDER.GITHUB} tone={LANDING_TONE.SETTLED} />}
              title="GitHub is connected to your workspace"
              description="Everyone in the workspace can use it. You can close this tab."
              action={OPEN_LUKE}
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark provider={MARK_PROVIDER.NOTION} tone={LANDING_TONE.FAILED} />}
              title="Luke could not reach Notion"
              description="Try again in a moment."
              action={OPEN_LUKE}
            />
          </div>
        </div>
      </CatalogSection>
      <CatalogSection
        id="auth-luke"
        title="Luke's own mark, on its way and failed, with no Open Luke"
      >
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark />}
              title="Continuing to Luke…"
              description="This window will close soon."
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark tone={LANDING_TONE.FAILED} />}
              title="Luke could not continue"
              description="Start sign-in again."
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

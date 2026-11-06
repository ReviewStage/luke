import { LANDING_TONE } from "@repo/features/landing-outcome";
import { ON_THIS_COMPUTER, oauthScopeLines } from "@repo/features/oauth-consent";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { inviteesOf } from "@repo/features/workspace-invitation-wire";
import {
  AuthMark,
  AuthPage,
  AuthStepFoot,
  BUTTON_VARIANT,
  Button,
  CONSENT_ANSWER,
  ConsentCard,
  EMAIL_CHIP_STATE,
  type EmailChip,
  EmailChipsField,
  FormField,
  MARK_PROVIDER,
  ProductMark,
  ProviderButton,
  SocialSignInCard,
  TEXT_FIELD_TYPE,
  TextField,
} from "@repo/ui";
import { useState } from "react";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * auth-page.tsx -- the sign-in page with its provider choices, a landing's
 * ringed mark on its way, settled, and failed, with and
 * without its Open link, and a form with an error on a phone's width, each in a
 * frame the size of the screen it stands for, a step of several with its
 * foot, on its first step and on one it can skip, and an MCP client's
 * consent, asking, with Allow out, and failed. Every name and address is made up.
 */

/** The Open link as a page offers it; the catalog goes nowhere. */
const OPEN_APP = { label: `Open ${PRODUCT_NAME}`, href: "#" } as const;

/** A press the catalog answers with nothing. */
const IGNORE = () => undefined;

function Mark(): React.JSX.Element {
  return (
    <span className="catalog-auth-mark">
      <ProductMark />
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

/** Setup's team fields as the step draws them, an address typed wrong among those to invite, left unsent. */
function TeamFields(): React.JSX.Element {
  const [name, setName] = useState("Acme");
  const [typed, setTyped] = useState("");
  const [chips, setChips] = useState<readonly EmailChip[]>([
    {
      id: "dana",
      words: "Dana Ruiz",
      typed: "Dana Ruiz <dana@acme.dev>",
      state: EMAIL_CHIP_STATE.DRAFT,
    },
    { id: "theo", words: "theo@acme.dev", typed: "theo@acme.dev", state: EMAIL_CHIP_STATE.DRAFT },
    {
      id: "sam",
      words: "sam@gmail",
      typed: "sam@gmail",
      state: EMAIL_CHIP_STATE.BAD,
      reason: "Not an email address",
    },
  ]);
  return (
    <>
      <FormField label="Name">
        {(control) => <TextField field={control} value={name} onChange={setName} />}
      </FormField>
      <FormField label="Add teammates by email" optional>
        {(control) => (
          <EmailChipsField
            field={control}
            chips={chips}
            typed={typed}
            onTyped={setTyped}
            placeholder="Ex. ellis@acme.dev, maria@acme.dev"
            onAdd={(words) =>
              setChips((now) => [
                ...now,
                ...inviteesOf(words)
                  .filter((one) => !now.some((chip) => chip.id === one.email))
                  .map((one) => ({
                    id: one.email,
                    words: one.name ?? one.email,
                    typed: one.typed,
                    state: one.invitable ? EMAIL_CHIP_STATE.DRAFT : EMAIL_CHIP_STATE.BAD,
                    reason: one.invitable ? undefined : "Not an email address",
                  })),
              ])
            }
            onRemove={(id) => setChips((now) => now.filter((chip) => chip.id !== id))}
          />
        )}
      </FormField>
    </>
  );
}

function EmailForm(): React.JSX.Element {
  const [email, setEmail] = useState("someone@acme-corporation.example");
  return (
    <>
      <FormField label="Work email" description={`${PRODUCT_NAME} sends a sign-in link to it.`}>
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
            mark={<Mark />}
            title={`Sign in to ${PRODUCT_NAME}`}
            footnote={`You can close this window after ${PRODUCT_NAME} confirms the sign-in.`}
          >
            <ProviderChoices />
          </AuthPage>
        </div>
      </CatalogSection>
      <CatalogSection id="auth-social-card" title="Social sign-in card, opening and failed">
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <SocialSignInCard
              mark={<Mark />}
              title={`${PRODUCT_NAME} admin`}
              pending={undefined}
              onPress={() => undefined}
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <SocialSignInCard
              mark={<Mark />}
              title="Sign in to accept your invitation"
              description="Sign in with the account that uses someone@acme-corporation.example."
              pending="github"
              failed={CATALOG_FAILURE}
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
              mark={<AuthMark provider={MARK_PROVIDER.GITHUB} tone={LANDING_TONE.COMPLETE} />}
              title="GitHub is connected to your workspace"
              description="Everyone in the workspace can use it. You can close this tab."
              action={OPEN_APP}
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark provider={MARK_PROVIDER.NOTION} tone={LANDING_TONE.DANGER} />}
              title={`${PRODUCT_NAME} could not reach Notion`}
              description="Try again in a moment."
              action={OPEN_APP}
            />
          </div>
        </div>
      </CatalogSection>
      <CatalogSection
        id="auth-open-app"
        title={`${PRODUCT_NAME}'s own mark, on its way and failed, with no Open ${PRODUCT_NAME}`}
      >
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark />}
              title={`Continuing to ${PRODUCT_NAME}…`}
              description="This window will close soon."
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark tone={LANDING_TONE.DANGER} />}
              title={`${PRODUCT_NAME} could not continue`}
              description="Start sign-in again."
            />
          </div>
        </div>
      </CatalogSection>
      <CatalogSection id="auth-consent" title="A client's consent, asking, allowing, and failed">
        <div className="catalog-screens">
          <div className="catalog-screen">
            <ConsentCard
              client="Acme Notes"
              account="someone@acme-corporation.example"
              abilities={oauthScopeLines("openid profile email offline_access acme:notes")}
              destination="notes.acme-corporation.example"
              answering={undefined}
              onAnswer={IGNORE}
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <ConsentCard
              client="Acme Desktop Assistant for Engineering Teams"
              account="someone@acme-corporation.example"
              abilities={oauthScopeLines("openid email")}
              destination={ON_THIS_COMPUTER}
              answering={CONSENT_ANSWER.ALLOW}
              onAnswer={IGNORE}
            />
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<AuthMark mcpClient tone={LANDING_TONE.DANGER} />}
              title="The agent was not connected"
              description="Start again from the agent. You can close this tab."
            />
          </div>
        </div>
      </CatalogSection>
      <CatalogSection
        id="auth-steps"
        title="A step of several, first, skippable, and with a way out at the top right"
      >
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<Mark />}
              title={`Welcome to ${PRODUCT_NAME}`}
              foot={<AuthStepFoot at={1} total={4} next={{ label: "Continue", onPress: IGNORE }} />}
            >
              <ProviderChoices />
            </AuthPage>
          </div>
          <div className="catalog-screen">
            <AuthPage
              mark={<Mark />}
              title="Connect GitHub"
              description="Agents work in your repositories and open pull requests."
              foot={<AuthStepFoot at={3} total={4} onBack={IGNORE} onSkip={IGNORE} />}
              exit={{ label: "Sign out", onPress: IGNORE }}
            >
              <ProviderChoices />
            </AuthPage>
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<Mark />}
              title="Create a team workspace"
              foot={
                <AuthStepFoot
                  at={2}
                  total={5}
                  onBack={IGNORE}
                  next={{ label: "Create", onPress: IGNORE }}
                />
              }
            >
              <TeamFields />
            </AuthPage>
          </div>
        </div>
      </CatalogSection>
      <CatalogSection id="auth-narrow" title="Phone width, a form, long words, an error">
        <div className="catalog-screens">
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage
              mark={<Mark />}
              title="Join acme-corporation-engineering-platform"
              description="Sign in with the provider your workspace administrator connected."
              error={{
                words: "The provider refused the request. Try again, or ask an administrator.",
                failure: CATALOG_FAILURE,
              }}
            >
              <ProviderChoices />
            </AuthPage>
          </div>
          <div className="catalog-screen catalog-screen-phone">
            <AuthPage mark={<Mark />} title="Sign in with email">
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

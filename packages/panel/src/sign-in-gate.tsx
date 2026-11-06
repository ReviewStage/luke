import type { AccountSnapshot } from "@repo/credentials/snapshot";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "@repo/credentials/snapshot";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { SIGN_IN_FAILURE, SIGN_IN_FAILURE_WORDS, type SignInFailure } from "@repo/features/words";
import {
  ANNOUNCE,
  AuthPage,
  PROVIDER_BUTTON_SIZE,
  ProductMark,
  ProviderButton,
  TEXT_BUTTON_TONE,
  TEXT_LINK_LOOK,
  TextButton,
  TextLink,
} from "@repo/ui";
import { failureShown } from "./failure-report.js";
import { useAnnounceShown } from "./use-announce-shown.js";

const SIGN_IN_FAILURE_ANSWERS = Object.fromEntries(
  Object.values(SIGN_IN_FAILURE).map((failure) => [failure, { failure }]),
) as Record<SignInFailure, { readonly failure: SignInFailure }>;

const FINISH_IN_BROWSER = "Finish in your browser.";

const WAYS_IN = [
  { provider: ACCOUNT_PROVIDER.GOOGLE, name: "Google" },
  { provider: ACCOUNT_PROVIDER.GITHUB, name: "GitHub" },
] as const;

export function SignInGate({
  account,
  waiting,
  failure,
  lastUsed,
  macAppLink,
  onBegin,
  onCancel,
}: {
  account: AccountSnapshot;
  waiting?: AccountProvider;
  failure?: SignInFailure;
  lastUsed?: AccountProvider;
  macAppLink?: string;
  onBegin: (provider: AccountProvider) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const busy = waiting !== undefined || account.status === ACCOUNT_STATUS.SIGNING_IN;
  const primary = lastUsed ?? ACCOUNT_PROVIDER.GOOGLE;
  useAnnounceShown(ANNOUNCE.POLITE, waiting ? FINISH_IN_BROWSER : "");
  return (
    <AuthPage
      mark={<ProductMark />}
      title={`Sign in to ${PRODUCT_NAME}`}
      error={
        failure === undefined
          ? undefined
          : {
              words: SIGN_IN_FAILURE_WORDS[failure],
              failure: failureShown({
                surface: FAILURE_SURFACE.ACCOUNT_SIGN_IN,
                cause: SIGN_IN_FAILURE_ANSWERS[failure],
                refused: true,
              }),
            }
      }
      footnote={
        waiting || macAppLink !== undefined ? (
          <>
            {waiting ? (
              <span>
                {FINISH_IN_BROWSER}{" "}
                <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={onCancel}>
                  Cancel
                </TextButton>
              </span>
            ) : null}
            {macAppLink === undefined ? null : (
              <TextLink href={macAppLink} look={TEXT_LINK_LOOK.UNDERLINED}>
                Open in the Mac app
              </TextLink>
            )}
          </>
        ) : undefined
      }
    >
      {WAYS_IN.map(({ provider, name }) => (
        <ProviderButton
          key={provider}
          provider={provider}
          name={name}
          size={PROVIDER_BUTTON_SIZE.GATE}
          primary={primary === provider}
          lastUsed={lastUsed === provider}
          busy={waiting === provider}
          busyLabel="Waiting for browser"
          disabled={busy}
          onPress={() => onBegin(provider)}
        />
      ))}
    </AuthPage>
  );
}

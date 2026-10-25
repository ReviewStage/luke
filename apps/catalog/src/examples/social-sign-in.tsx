import { SOCIAL_PROVIDER } from "@luke/features/sign-in-provider";
import { GAP, SocialProviderButton, SocialSignInChoices, Stack } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * social-sign-in.tsx -- a button for every social provider, one opening
 * while the others stand unavailable, and one provider's button on its own.
 */

function SocialSignIn(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="social-sign-in-choices" title="Every provider, then one opening">
        <Stack gap={GAP.CONTROL}>
          <SocialSignInChoices pending={undefined} onPress={() => undefined} />
        </Stack>
        <Stack gap={GAP.CONTROL}>
          <SocialSignInChoices
            pending={Object.values(SOCIAL_PROVIDER)[0]}
            onPress={() => undefined}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="social-provider-button" title="One provider's button">
        <SocialProviderButton
          provider={Object.values(SOCIAL_PROVIDER)[0] ?? SOCIAL_PROVIDER.GITHUB}
          pending={undefined}
          onPress={() => undefined}
        />
      </CatalogSection>
    </>
  );
}

export const SOCIAL_SIGN_IN_EXAMPLE: Example = {
  id: "social-sign-in",
  title: "Social sign-in",
  Render: SocialSignIn,
};

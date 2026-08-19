export const SOCIAL_PROVIDER = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export type SocialProvider = (typeof SOCIAL_PROVIDER)[keyof typeof SOCIAL_PROVIDER];

export const SOCIAL_PROVIDER_LABEL = {
  [SOCIAL_PROVIDER.GOOGLE]: "Google",
  [SOCIAL_PROVIDER.GITHUB]: "GitHub",
} as const satisfies Record<SocialProvider, string>;

export function socialProviderFromState(state: string | null): SocialProvider | undefined {
  if (state?.startsWith(`${SOCIAL_PROVIDER.GOOGLE}.`)) return SOCIAL_PROVIDER.GOOGLE;
  if (state?.startsWith(`${SOCIAL_PROVIDER.GITHUB}.`)) return SOCIAL_PROVIDER.GITHUB;
  return undefined;
}

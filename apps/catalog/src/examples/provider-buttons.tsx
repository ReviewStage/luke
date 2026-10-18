import {
  GAP,
  MARK_PROVIDER,
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  type ProviderButtonSize,
  Stack,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * provider-buttons.tsx -- a sign-in's provider choices in both sizes: at
 * rest with the way in taken last filled and wearing its pill, and pending,
 * the pressed one named for its wait while the other stands back. A press
 * begins the wait and a second press of the waited one is refused, so the
 * example is pressed through as a sign-in is.
 */

const WAYS_IN = [
  { provider: MARK_PROVIDER.GOOGLE, name: "Google" },
  { provider: MARK_PROVIDER.GITHUB, name: "GitHub" },
] as const;

type WayIn = (typeof WAYS_IN)[number]["provider"];

/** What the pending button says, per size: the web's opening, the gate's wait. */
const PENDING_LABEL = {
  [PROVIDER_BUTTON_SIZE.CONTROL]: (name: string) => `Opening ${name}`,
  [PROVIDER_BUTTON_SIZE.GATE]: () => "Waiting for browser…",
} as const;

/** Both choices in `size`, GitHub used last, pending on `initial` until another is pressed. */
function Choices({
  size,
  initial,
}: {
  size: ProviderButtonSize;
  initial?: WayIn;
}): React.JSX.Element {
  const [pending, setPending] = useState<WayIn | undefined>(initial);
  return (
    <div className="catalog-column">
      <Stack gap={GAP.CONTROL}>
        {WAYS_IN.map(({ provider, name }) => (
          <ProviderButton
            key={provider}
            provider={provider}
            name={name}
            size={size}
            primary={size === PROVIDER_BUTTON_SIZE.GATE && provider === MARK_PROVIDER.GITHUB}
            lastUsed={provider === MARK_PROVIDER.GITHUB}
            pending={pending === provider}
            pendingLabel={PENDING_LABEL[size](name)}
            disabled={pending !== undefined && pending !== provider}
            onPress={() => setPending(provider)}
          />
        ))}
      </Stack>
    </div>
  );
}

function ProviderButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="provider-button-control" title="Control, at rest">
        <Choices size={PROVIDER_BUTTON_SIZE.CONTROL} />
      </CatalogSection>
      <CatalogSection id="provider-button-control-pending" title="Control, opening GitHub">
        <Choices size={PROVIDER_BUTTON_SIZE.CONTROL} initial={MARK_PROVIDER.GITHUB} />
      </CatalogSection>
      <CatalogSection id="provider-button-gate" title="Gate, at rest">
        <Choices size={PROVIDER_BUTTON_SIZE.GATE} />
      </CatalogSection>
      <CatalogSection id="provider-button-gate-pending" title="Gate, waiting on GitHub">
        <Choices size={PROVIDER_BUTTON_SIZE.GATE} initial={MARK_PROVIDER.GITHUB} />
      </CatalogSection>
    </>
  );
}

export const PROVIDER_BUTTONS_EXAMPLE: Example = {
  id: "provider-buttons",
  title: "Provider buttons",
  Render: ProviderButtons,
};

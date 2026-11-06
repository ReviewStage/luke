import {
  GAP,
  MARK_PROVIDER,
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  type ProviderButtonSize,
  Stack,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const WAYS_IN = [
  { provider: MARK_PROVIDER.GOOGLE, name: "Google" },
  { provider: MARK_PROVIDER.GITHUB, name: "GitHub" },
] as const;

type WayIn = (typeof WAYS_IN)[number]["provider"];

const PENDING_LABEL = {
  [PROVIDER_BUTTON_SIZE.CONTROL]: (name: string) => `Opening ${name}`,
  [PROVIDER_BUTTON_SIZE.GATE]: () => "Waiting for browser…",
} as const;

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
            busy={pending === provider}
            busyLabel={PENDING_LABEL[size](name)}
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
      <CatalogSection id="provider-button-words" title="Gate, naming its own act">
        <div className="catalog-column">
          <ProviderButton
            provider={MARK_PROVIDER.GITHUB}
            name="GitHub"
            words="Install on GitHub"
            size={PROVIDER_BUTTON_SIZE.GATE}
            primary
            onPress={() => undefined}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const PROVIDER_BUTTONS_EXAMPLE: Example = {
  id: "provider-buttons",
  title: "Provider buttons",
  Render: ProviderButtons,
};

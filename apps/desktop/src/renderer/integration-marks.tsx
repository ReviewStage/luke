import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";

/**
 * integration-marks.tsx -- each integration's official mark, as its own brand publishes it.
 *
 * Brand marks, not glyphs of ours: each is the brand's own vector, verbatim
 * from the press kit cited above it, never redrawn, in the colours its usage
 * rules allow. A mark the brand shows monochrome is drawn in `currentColor`,
 * so it reads in the ink of whatever row it stands in. Settings ›
 * Integrations, the composer's list of servers, and anywhere else a provider
 * is named draw these; the web's landing page draws the same marks in its own
 * React, as the account marks are drawn once per app.
 */

interface MarkProps {
  readonly className: string;
}

/**
 * Linear's logomark, verbatim from `logo-light.svg` in Linear's brand assets
 * (https://linear.app/brand,
 * https://static.linear.app/design-assets/Linear-Brand-Assets.zip), which
 * Linear publishes as a single-colour mark in light and dark; drawn in
 * `currentColor` for either ground.
 */
function LinearMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <title>Linear</title>
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
    </svg>
  );
}

/** One provider's mark, at whatever size the caller's class gives it. */
export function IntegrationMark({
  provider,
  className = "provider-mark integration-mark",
}: {
  provider: IntegrationProvider;
  className?: string;
}): React.JSX.Element {
  switch (provider) {
    case INTEGRATION_PROVIDER.LINEAR:
      return <LinearMark className={className} />;
  }
}

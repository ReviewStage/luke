import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";

/**
 * integration-marks.tsx -- each integration's official mark, as its own brand publishes it, for the web's own pages.
 *
 * Brand marks, not glyphs of ours: each is the brand's own vector, verbatim
 * from the press kit cited above it, never redrawn, in the colours its usage
 * rules allow. A mark the brand shows monochrome is drawn in `currentColor`,
 * so it reads in the ink of whatever card it stands on. The desktop's
 * `renderer/integration-marks.tsx` draws the same marks in its own React, as
 * the account marks are drawn once per app; change both if a brand publishes
 * a new mark.
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

/**
 * Notion's block logomark, verbatim from `notion-logo-block-mono-black.svg`
 * in `notion-logos-2024.zip` from Notion's brand guidelines
 * (https://notion.notion.site/Notion-Brand-Guidelines-db8fda2d1f0048bba1f4e547dfc48830).
 * Notion publishes the mono mark in pure black and pure white and asks for
 * the white one on a dark ground, so it is drawn in `currentColor` with
 * `text-white`, the landing card being dark setting which.
 */
function NotionMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={`${className} text-white`}
      viewBox="0 0 335 350"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <title>Notion</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M214.701 0.796296L21.056 15.0565C5.44153 16.4088 0 26.5954 0 38.8077V250.61C0 260.126 3.3919 268.259 11.5487 279.13L57.0693 338.19C64.5464 347.701 71.3416 349.735 85.6192 349.054L310.498 335.475C329.518 334.124 334.958 325.292 334.958 310.358V72.0749C334.958 64.3554 331.904 62.1254 322.899 55.5518C322.404 55.1901 321.891 54.8153 321.359 54.4257L259.545 10.9802C244.599 0.122938 238.481 -1.24326 214.701 0.796296ZM90.718 68.1664C72.3581 69.4062 68.1862 69.6879 57.7599 61.2177L31.2457 40.1737C28.5415 37.4525 29.8978 34.0579 36.6871 33.3847L222.855 19.8061C238.478 18.4455 246.629 23.8852 252.747 28.635L284.678 51.7183C286.038 52.3944 289.429 56.4624 285.351 56.4624L93.0882 68.0071C92.2729 68.0614 91.4837 68.1147 90.719 68.1664L90.718 68.1664ZM69.3031 308.318V106.024C69.3031 97.2006 72.021 93.1245 80.1694 92.4398L300.977 79.5458C308.466 78.867 311.857 83.6223 311.857 92.4398V293.376C311.857 302.208 310.495 309.686 298.261 310.358L86.9643 322.584C74.7361 323.257 69.3031 319.19 69.3031 308.318ZM277.894 116.876C279.249 122.992 277.894 129.102 271.768 129.789L261.586 131.817V281.164C252.747 285.915 244.596 288.631 237.804 288.631C226.929 288.631 224.206 285.234 216.06 275.056L149.467 170.513V271.662L170.539 276.417C170.539 276.417 170.539 288.631 153.538 288.631L106.67 291.349C105.308 288.631 106.67 281.848 111.424 280.488L123.654 277.099V143.362L106.672 142.001C105.311 135.886 108.703 127.068 118.221 126.383L168.501 122.994L237.804 228.898V135.212L220.135 133.184C218.778 125.707 224.206 120.278 231.001 119.605L277.894 116.876Z"
      />
    </svg>
  );
}

/**
 * Sentry's glyph, verbatim from the logo generator on Sentry's branding page
 * (https://sentry.io/branding/, Glyph with no clear space), whose brand guide
 * (https://live.standards.site/sentry) uses the glyph alone where space is
 * short. Sentry publishes it in one colour, its dark blurple on a light
 * ground and white on a dark one, so it is drawn in `currentColor` with
 * `text-white`, the landing card being dark setting which.
 */
function SentryMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={`${className} text-white`}
      viewBox="0 0 50 44"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <title>Sentry</title>
      <path d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z" />
    </svg>
  );
}

/**
 * Slack's mark, verbatim from `SLA-Slack-icon-RGB.svg` in the Slack Media Kit
 * logos (https://slack.com/media-kit, served from Salesforce's asset library
 * at https://salesforce.widencollective.com/c/yn6bxnam), in the four colours
 * Slack's logo rules keep (https://slack.com/terms-of-service/slack-brand:
 * "Don't use different colors", "Don't use old versions").
 */
function SlackMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <title>Slack</title>
      <path
        fill="#E3066A"
        d="M84.039,252.769c0,23.127-18.893,42.02-42.02,42.02S0,275.896,0,252.769s18.893-42.02,42.02-42.02h42.02v42.02Z"
      />
      <path
        fill="#E3066A"
        d="M105.212,252.769c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02v105.212c0,23.127-18.893,42.02-42.02,42.02s-42.02-18.893-42.02-42.02c0,0,0-105.212,0-105.212Z"
      />
      <path
        fill="#00B3FF"
        d="M147.231,84.039c-23.127,0-42.02-18.893-42.02-42.02S124.104,0,147.231,0s42.02,18.893,42.02,42.02v42.02h-42.02Z"
      />
      <path
        fill="#00B3FF"
        d="M147.231,105.212c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02H42.02c-23.127,0-42.02-18.893-42.02-42.02s18.893-42.02,42.02-42.02c0,0,105.212,0,105.212,0Z"
      />
      <path
        fill="#41B658"
        d="M315.961,147.231c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02-18.893,42.02-42.02,42.02h-42.02v-42.02Z"
      />
      <path
        fill="#41B658"
        d="M294.788,147.231c0,23.127-18.893,42.02-42.02,42.02s-42.02-18.893-42.02-42.02V42.02c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02v105.212Z"
      />
      <path
        fill="#FCC003"
        d="M252.769,315.961c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02-42.02-18.893-42.02-42.02v-42.02h42.02Z"
      />
      <path
        fill="#FCC003"
        d="M252.769,294.788c-23.127,0-42.02-18.893-42.02-42.02s18.893-42.02,42.02-42.02h105.212c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02h-105.212Z"
      />
    </svg>
  );
}

/** One provider's mark, at whatever size the caller's class gives it. */
export function IntegrationMark({
  provider,
  className,
}: {
  provider: IntegrationProvider;
  className: string;
}): React.JSX.Element {
  switch (provider) {
    case INTEGRATION_PROVIDER.LINEAR:
      return <LinearMark className={className} />;
    case INTEGRATION_PROVIDER.NOTION:
      return <NotionMark className={className} />;
    case INTEGRATION_PROVIDER.SENTRY:
      return <SentryMark className={className} />;
    case INTEGRATION_PROVIDER.SLACK:
      return <SlackMark className={className} />;
  }
}

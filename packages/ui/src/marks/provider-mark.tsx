import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import React, { useId } from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * provider-mark.tsx -- the official mark of every provider an account signs in with or connects, as its own brand publishes it.
 *
 * Brand marks, not glyphs of ours: each is the brand's own vector, verbatim
 * from the press kit cited above it, never redrawn, in the colours its usage
 * rules allow. A mark the brand shows monochrome is drawn in `currentColor`,
 * so it reads in the ink of whatever row or card it stands in; a brand that
 * names one ink per ground wears an `integration-mark-*` class, and each app
 * sets those inks for the grounds it draws (the desktop's `styles/desktop.css`
 * for both of its schemes, the site's `styles.css` for its dark cards).
 * `ProviderMark` is the one door to them, so GitHub's mark is traced once
 * whether it stands for an account's sign-in, its connected GitHub, a
 * workspace's organization, or the GitHub integration, in the desktop and on
 * the site alike. The harnesses a model runs in are not providers of this kind
 * and have their own marks (the desktop's `harness-marks.tsx`).
 */

/**
 * Every provider with a mark: the integrations and the two sign-in providers,
 * GitHub being both. An app's own account-provider set names the same
 * strings, so the compiler holds it to this one at the call site.
 */
export const MARK_PROVIDER = { ...INTEGRATION_PROVIDER, GOOGLE: "google" } as const;

export type MarkProvider = (typeof MARK_PROVIDER)[keyof typeof MARK_PROVIDER];

/**
 * How big a mark stands: the glyph cell of the row, chip, or button it leads
 * (`slot`, which sizes it), or one of four sizes of its own: beside a
 * caption's words, as a control's icon, as a settings row's leading mark, and
 * as the tile a connection's card leads with.
 */
export const PROVIDER_MARK_SIZE = {
  SLOT: "slot",
  CAPTION: "caption",
  ICON: "icon",
  ROW: "row",
  TILE: "tile",
} as const;

export type ProviderMarkSize = (typeof PROVIDER_MARK_SIZE)[keyof typeof PROVIDER_MARK_SIZE];

/** The class each size wears; a slot's mark wears the base alone. */
const MARK_CLASS = {
  [PROVIDER_MARK_SIZE.SLOT]: "luke-provider-mark",
  [PROVIDER_MARK_SIZE.CAPTION]: "luke-provider-mark luke-provider-mark-caption",
  [PROVIDER_MARK_SIZE.ICON]: "luke-provider-mark luke-provider-mark-icon",
  [PROVIDER_MARK_SIZE.ROW]: "luke-provider-mark luke-provider-mark-row",
  [PROVIDER_MARK_SIZE.TILE]: "luke-provider-mark luke-provider-mark-tile",
} as const satisfies Record<ProviderMarkSize, string>;

interface MarkProps {
  readonly className: string;
}

/**
 * Google's G in its four official colours, as Google's sign-in branding
 * guidelines draw it (https://developers.google.com/identity/branding-guidelines),
 * on either ground.
 */
function GoogleMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

/**
 * Executor's mark, its serif E on its disc, traced from `assets/executor-icon.png`
 * in Executor's own repository (https://github.com/UsefulSoftwareCo/executor),
 * the same artwork executor.sh serves as its logo, since Executor publishes
 * no vector of it. The site draws it black and inverts it on a dark ground,
 * so the E is cut out of the disc and the disc drawn in `currentColor`, with
 * `.integration-mark-executor` (`styles/desktop.css`) setting which.
 */
function ExecutorMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={`${className} integration-mark-executor`}
      viewBox="0 0 191 191"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M95.5 0A95.5 95.5 0 1 1 95.5 191A95.5 95.5 0 1 1 95.5 0ZM115 43.9 C116.4 44.5 116.7 45.4 116.9 49.1 C117 52.3 117.2 55 117.3 57.1 C117.4 58.2 117.4 60.3 117.5 61.9 C117.6 63.5 117.6 65.5 117.7 66.4 C118 71.4 117.9 72 116.3 72.1 C114.8 72.2 114.3 71.5 114 68.8 C111.9 53.2 106.2 47.1 94 47.1 C87.9 47 85.7 48 84.5 51.3 C84.2 52 84.1 62.5 84.3 63.6 C84.6 65 83.5 63.6 97.6 79.9 C110.5 94.8 110 94.3 110 95.5 C109.9 96.5 110.2 96.1 97.3 111.1 C84.2 126.2 84.6 125.7 84.3 126.8 C84.1 128.2 84.2 133.2 84.5 134.3 C85.6 138 87.8 139.5 92.9 140 C97.9 140.5 102 139.9 105.7 138 C110.9 135.4 113.3 131.1 115.2 121.6 C116.8 113.9 116.7 114 117.7 113.6 C119.5 112.8 120.4 113.8 120.2 116.5 C120.1 118 120 119.7 119.8 123.4 C119.7 124.4 119.6 126.4 119.5 127.7 C119.5 129 119.3 131.6 119.2 133.4 C118.9 141.7 118.8 142.3 117.3 143.1 L116.8 143.4 L91.4 143.5 C74.3 143.5 65.8 143.5 65.6 143.4 C65 143.2 64.7 142.8 64.7 142.2 C64.7 141.1 65.3 140.7 67.8 140.2 C70.6 139.7 70.9 139.6 71.8 139.3 C73.4 138.7 74 137.8 74.2 135.9 C74.3 134.7 74.3 52.4 74.2 51.2 C73.9 48.8 72.7 47.8 69.5 47.3 C68.2 47.1 66.4 46.7 66 46.6 C64.4 46.1 64.1 44.3 65.6 43.7 C65.9 43.6 70.1 43.6 90.2 43.6 L114.5 43.6 L115 43.9 Z M87.1 81.4 C85.8 81.6 84.6 82.5 84.4 83.4 C84.2 84 84.1 106.5 84.3 107.2 C85 109.6 88.3 110.2 91.8 108.4 C95.6 106.5 100.8 101.8 104.5 96.9 C105.6 95.5 105.6 95.2 104.6 93.9 C98.4 85.9 91.2 80.7 87.1 81.4 Z"
      />
    </svg>
  );
}

/**
 * GitHub's mark, the Octicon GitHub publishes as its logo
 * (https://github.com/logos); GitHub's guidance shows it in one colour, so it
 * is drawn in `currentColor` for either ground.
 */
function GitHubMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * Granola's spiral in Granola's green, the spiral verbatim from
 * `logo-square.svg` in the Logos folder of Granola's press kit
 * (https://grano.la/press, the "Press" link on https://www.granola.ai) but
 * for its coordinates rounded to tenths of a unit, drawn alone in the
 * kit's lime (`#B2C248`, the green of its `Granola_lockup_green.svg`) on
 * no tile, in a box cropped to the spiral, on either ground.
 */
function GranolaMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="146 146 732 732"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#B2C248"
        d="M508 878C583.9 878 663.5 861.2 695.5 837.9C716 823.3 726.1 824.7 744.4 807.3C749.5 802.2 751.7 800.7 753.1 799.2C822.4 742.3 862.6 668.6 862.6 573C862.6 417.5 752.4 311.7 594.8 311.7C456.1 311.7 350.3 400 350.3 513.1C350.3 616 430.6 689.7 545.1 689.7C551.7 689.7 554.6 686 561.9 686C589.7 686 612.3 678 626.9 662.7C634.2 654.7 648.1 638.6 649.5 637.9C656.1 632 657.5 623.3 659 619.6C660.5 616 663.4 613.8 664.9 608.7C666.3 602.8 664.2 595.5 664.2 589C664.2 577.4 669.3 565.7 669.3 554.8C669.3 524.1 632.8 493.4 599.9 493.4C596.3 493.4 596.3 490.5 594.1 490.5C591.8 490.5 589.7 492.7 587.5 492.7C585.3 492.7 582.4 489.1 579.5 489.1C576.5 489.1 575.1 492 570.7 492C561.2 492 560.5 493.4 553.2 493.4C551 493.4 547.3 494.2 545.9 494.9C543 496.3 543 498.5 540 498.5C536.1 498.5 534.2 499.3 534.2 500.7C534.2 508.7 534.9 507.3 531.2 507.3C527.3 507.3 524.9 507.6 523.9 508C521 509.5 523.2 513.1 520.3 515.3C517.4 516.8 516.6 519 515.9 523.3C515.2 527.7 510.9 529.2 510.9 533.6C510.9 535.8 511.6 537.2 511.6 538.7C511.6 543 502.8 541.6 502.8 546C502.8 548.9 505.1 551 505.1 554C505.1 556.2 503.6 557.6 503.6 559.8C503.6 562.1 505.1 563.5 505.1 564.9C505.1 568.6 500 569.3 500 572.2C500 575.1 502.9 577.3 502.9 579.5C502.9 580.9 500.7 581.7 500.7 583.9C500.7 586 500 582.4 504.3 588.9C507.3 593.3 507.3 595.5 504.3 599.2C501.4 602.8 495.6 605 488.3 605C457.7 605 454.1 573.6 437.2 568.6C432.2 567.1 431.4 566.3 431.4 564.2C431.4 562.1 431.4 562.8 434.3 559.8C437.2 556.9 437.9 554.8 437.9 552.5C437.9 550.3 437.9 549.6 436.5 548.2C430.7 538.7 427.8 527 427.8 513.9C427.8 446.8 509.5 390.6 586.9 390.6C610.2 390.6 606.6 396.4 620.5 396.4C624.1 396.4 622.7 396.4 627.8 395.7C640.9 393.5 665 398.6 683.9 408.1C736.5 434.3 770.8 496.4 770.8 568.6C770.8 692 661.3 781.7 515.4 781.7C435.8 781.7 381.1 756.9 327.1 696.4C321.2 689.8 330 697.8 320.5 681C308.8 660.6 310.2 673.7 310.2 673.7C306.6 669.4 300 656.9 296.4 652.6C292 647.5 286.1 648.2 284 645.3C281 641.6 285.4 635 284 631.4C282.5 625.5 270.1 616.8 268.7 612.4C267.2 608.1 262.1 580.3 262.1 575.2C262.1 569.4 266.4 568.6 266.4 565C266.4 559.9 259.9 558.4 256.2 551.1C252.6 543.8 250.3 527 250.3 508.7C250.3 499.2 250.3 495.6 253.3 473.7C254 466.4 264.9 466.4 264.9 458.4C264.9 455.4 263.5 451.8 263.5 449.6C263.5 446.7 263.5 446 264.2 443.8C294.8 315.4 432.1 219.8 584.6 219.8C637.1 219.8 677.3 229.3 739.3 255.5C759.8 264.3 789.7 249 789.7 232.9C791.1 227.9 788.3 226.3 787.5 223.4C786.7 220.5 783.8 216.8 780.9 216.1C779.4 215.4 778.7 213.2 777.2 211C775 207.4 772.9 206 767 204.5C764.1 203.7 762.6 203 761.1 201.5C758.9 198.6 757.5 197.2 754.5 195.6C751.6 194.2 749.5 195.6 748 194.9C746.5 194.2 745.7 192.7 744.3 192C743.6 191.3 742.1 191.3 739.9 191.3C666.3 151.9 618.2 146 554 146C415.3 146 291.3 205.9 214.6 310.2C208.1 318.9 211.7 333.5 202.3 342.3C184 359.1 161.4 451.1 161.4 509.5C161.4 558.3 173.1 623.3 188.4 659.1C218.3 729.1 205.2 699.9 209.6 706.5C218.3 720.4 225.6 721.8 229.2 726.2C229.2 726.2 231.5 730.5 231.5 734.9C231.5 737.8 231.5 738.6 232.2 740C234.4 744.3 244.6 751.6 247.5 754.6C254.1 761.2 259.1 775 270.1 786C286.9 802.8 310.9 815.9 387.6 851.7C414.5 864 399.2 857.5 402.2 858.3C408.8 860.5 417.5 860.5 422.6 864.1C425.6 866.4 421.9 865.6 429.9 865.6C431.4 865.6 431.4 866.3 432.9 867C434.3 867.7 435.8 869.9 437.9 869.9C439.4 869.9 440.2 868.5 442.3 869.2C444.5 869.9 449.6 873.6 454 875.8C457.6 878 458.3 878 459.8 876.5C464.2 873.6 467.1 877.2 471.5 877.2C472.9 877.2 475.2 876.5 479.5 876.5C485.4 876.5 485.4 877.9 508 877.9"
      />
    </svg>
  );
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
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
    </svg>
  );
}

/**
 * Mercury's logomark, verbatim from mercury.com's own icon
 * (https://mercury.com/icon.svg), which inks itself by the ground, dark on
 * light and near-white on dark; drawn in `currentColor` with
 * `.integration-mark-mercury` (`styles/desktop.css`) setting the same two
 * inks. Mercury publishes no press kit.
 */
function MercuryMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={`${className} integration-mark-mercury`}
      viewBox="0 0 500 500"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M 252.783 0.024 C 251.925 0 251.066 0 250.208 0 C 249.349 0 248.492 0 247.634 0.024 C 111.485 1.381 1.357 111.402 0 247.423 C 0.555 225.867 8.45 205.146 22.378 188.686 C 44.159 107.902 107.981 44.141 188.843 22.38 C 208.158 17.176 228.06 14.464 248.064 14.309 C 248.779 14.285 249.494 14.285 250.208 14.285 C 250.921 14.285 251.639 14.285 252.353 14.309 C 285.265 15.166 313.339 35.713 325.206 64.571 C 327.551 70.27 329.231 76.222 330.21 82.307 C 330.891 86.582 331.234 90.905 331.235 95.235 C 331.259 112.946 325.437 130.17 314.674 144.235 C 318.758 146.717 322.689 149.445 326.445 152.4 C 338.863 135.932 345.565 115.861 345.535 95.235 C 345.535 93.734 345.492 92.233 345.428 90.733 C 371.707 106.547 393.695 128.578 409.461 154.886 C 407.873 154.818 406.285 154.77 404.696 154.77 C 384.058 154.738 363.969 161.433 347.476 173.841 C 343.639 176.716 340.029 179.884 336.681 183.316 C 327.41 192.712 320.209 203.946 315.542 216.294 L 315.542 216.317 C 311.441 227.075 309.349 238.494 309.371 250.006 C 309.371 282.473 283.247 308.933 250.887 309.519 L 250.231 309.517 C 217.369 309.517 190.653 282.826 190.653 249.996 C 190.674 261.507 188.582 272.927 184.482 283.684 L 184.482 283.709 C 191.568 297.432 202.755 308.609 216.486 315.683 L 216.51 315.683 C 226.943 321.038 238.504 323.821 250.231 323.802 C 270.43 323.777 289.905 331.331 304.805 344.968 C 308.413 348.266 311.722 351.875 314.696 355.753 C 325.461 369.818 331.283 387.041 331.259 404.751 C 331.257 409.008 330.926 413.258 330.269 417.465 C 330.11 417.54 329.953 417.616 329.793 417.691 C 315.932 424.301 301.301 429.155 286.237 432.137 C 307.318 404.418 290.487 364.273 255.94 359.876 C 254.047 359.635 252.141 359.514 250.232 359.514 C 231.08 359.531 212.26 354.514 195.657 344.966 C 183.15 337.727 172.173 328.119 163.341 316.682 C 159.993 320.114 156.383 323.283 152.546 326.156 C 158.775 334.165 165.981 341.364 173.995 347.585 C 177.751 350.542 181.682 353.27 185.767 355.753 C 205.192 367.57 227.495 373.813 250.232 373.8 C 274.059 373.8 288.95 399.593 277.037 420.227 C 271.508 429.803 261.291 435.703 250.232 435.703 C 251.888 435.703 253.537 435.682 255.182 435.639 C 253.392 435.691 251.595 435.715 249.791 435.715 C 225.966 435.782 211.001 410.031 222.858 389.363 C 228.39 379.718 238.672 373.781 249.791 373.812 C 239.916 373.819 230.074 372.643 220.477 370.312 C 193.955 392.876 201.805 435.691 234.607 447.377 C 239.481 449.115 244.617 450.002 249.791 450.002 C 275.497 450.035 300.966 445.086 324.789 435.43 C 330.81 433.01 336.704 430.284 342.448 427.265 C 378.645 408.293 408.212 378.754 427.219 342.576 C 421.399 343.973 415.463 344.826 409.487 345.123 C 393.721 371.432 371.73 393.463 345.452 409.279 C 345.516 407.771 345.557 406.261 345.557 404.754 C 345.588 384.128 338.885 364.057 326.468 347.588 L 326.312 347.379 C 334.209 341.211 341.315 334.091 347.468 326.183 C 363.958 338.585 384.041 345.275 404.673 345.243 C 406.27 345.243 407.866 345.194 409.462 345.124 C 415.439 344.826 421.375 343.973 427.193 342.576 C 468.956 332.395 498.757 295.546 499.975 252.578 C 500 251.723 500 250.866 500 250.01 L 500 250.003 C 500 249.148 500 248.291 499.975 247.435 C 498.623 111.865 389.221 2.123 253.696 0.052 Z M 336.681 316.695 C 330.931 324.158 324.248 330.853 316.797 336.617 C 307.426 327.441 296.25 320.311 283.978 315.682 L 283.954 315.682 L 283.727 315.596 C 297.373 308.515 308.488 297.379 315.543 283.719 L 315.543 283.695 C 320.901 273.275 323.689 261.723 323.67 250.004 C 323.647 229.818 331.209 210.359 344.855 195.483 C 348.157 191.879 351.77 188.572 355.652 185.602 C 369.737 174.845 386.975 169.03 404.698 169.055 C 409.023 169.056 413.341 169.398 417.613 170.075 L 417.615 170.078 C 424.302 184.073 429.193 198.857 432.171 214.079 C 404.471 192.927 364.26 209.692 359.791 244.257 C 359.546 246.163 359.42 248.083 359.418 250.004 C 359.433 269.143 354.412 287.946 344.857 304.528 C 342.404 308.76 339.673 312.824 336.681 316.695 Z M 404.696 219.054 C 421.277 219.046 434.922 232.1 435.65 248.665 C 435.653 249.112 435.655 249.559 435.655 250.006 C 435.634 273.856 409.802 288.739 389.158 276.796 C 379.932 271.459 374.097 261.753 373.711 251.101 C 373.713 250.738 373.716 250.371 373.716 250.006 C 373.724 232.903 387.594 219.046 404.696 219.054 Z M 355.651 314.409 C 362.3 303.539 367.212 291.697 370.207 279.312 C 392.821 305.841 435.674 297.941 447.342 265.092 C 449.062 260.248 449.945 255.146 449.953 250.006 C 449.985 224.321 445.032 198.875 435.369 175.077 C 432.944 169.062 430.216 163.174 427.194 157.436 C 408.278 121.431 378.901 91.999 342.932 73.015 L 342.866 72.735 C 338.089 53.145 327.212 35.58 311.803 22.573 C 392.347 44.507 455.876 108.137 477.598 188.698 C 482.807 207.993 485.521 227.877 485.676 247.862 C 485.701 248.577 485.701 249.292 485.701 250.006 C 485.701 250.72 485.701 251.433 485.676 252.148 C 484.818 285.028 464.251 313.074 435.369 324.933 C 429.662 327.275 423.704 328.952 417.614 329.932 C 413.333 330.611 409.007 330.953 404.673 330.956 C 386.957 330.981 369.726 325.17 355.643 314.421 Z M 315.518 216.315 L 315.518 216.291 C 308.432 202.566 297.245 191.39 283.514 184.316 L 283.49 184.316 C 273.057 178.961 261.496 176.177 249.769 176.197 C 229.57 176.222 210.095 168.669 195.194 155.031 C 191.586 151.733 188.277 148.123 185.303 144.246 C 174.539 130.181 168.717 112.958 168.741 95.246 C 168.742 90.99 169.074 86.739 169.731 82.534 L 170.206 82.308 C 184.067 75.697 198.699 70.844 213.762 67.861 C 192.681 95.581 209.514 135.727 244.062 140.124 C 245.954 140.364 247.86 140.485 249.767 140.485 C 268.919 140.468 287.739 145.484 304.342 155.032 C 316.849 162.271 327.826 171.878 336.658 183.316 C 340.006 179.884 343.615 176.716 347.453 173.841 C 341.224 165.833 334.018 158.634 326.004 152.413 C 322.247 149.456 318.317 146.729 314.232 144.246 C 294.807 132.429 272.504 126.186 249.767 126.199 C 225.94 126.266 210.977 100.515 222.832 79.847 C 228.365 70.201 238.647 64.264 249.767 64.296 C 248.101 64.296 246.441 64.318 244.784 64.361 C 246.586 64.309 248.394 64.283 250.208 64.283 C 274.034 64.217 288.997 89.969 277.142 110.636 C 271.609 120.282 261.328 126.218 250.208 126.187 C 260.084 126.181 269.924 127.356 279.522 129.687 C 306.045 107.124 298.196 64.31 265.395 52.621 C 260.52 50.885 255.383 49.997 250.208 49.998 C 224.502 49.964 199.034 54.913 175.211 64.569 C 169.19 66.99 163.295 69.716 157.551 72.735 C 121.355 91.707 91.788 121.246 72.782 157.424 C 78.601 156.027 84.537 155.174 90.513 154.877 C 106.279 128.568 128.27 106.536 154.55 90.72 C 154.483 92.229 154.441 93.738 154.441 95.246 C 154.41 115.872 161.114 135.943 173.531 152.412 L 173.688 152.62 C 165.791 158.789 158.685 165.908 152.532 173.817 C 136.041 161.415 115.959 154.726 95.327 154.758 C 93.73 154.758 92.134 154.806 90.536 154.877 C 84.56 155.174 78.624 156.027 72.806 157.424 C 31.044 167.606 1.244 204.454 0.025 247.423 C 0 248.279 0 249.137 0 249.993 C 0 250.849 0 251.707 0.025 252.565 C 1.379 388.136 110.782 497.879 246.31 499.947 L 247.217 499.975 C 248.075 500 248.934 500 249.793 500 C 250.651 500 251.508 500 252.366 499.975 C 388.515 498.618 498.642 388.598 500 252.575 C 499.445 274.132 491.55 294.853 477.621 311.313 C 455.841 392.098 392.018 455.857 311.157 477.619 C 291.842 482.823 271.94 485.535 251.936 485.691 C 251.222 485.714 250.506 485.714 249.793 485.714 C 249.078 485.714 248.361 485.714 247.647 485.691 C 214.736 484.834 186.661 464.286 174.794 435.429 C 172.448 429.729 170.769 423.777 169.789 417.692 C 169.109 413.416 168.766 409.093 168.765 404.764 C 168.74 387.054 174.563 369.83 185.326 355.765 C 181.242 353.282 177.311 350.555 173.554 347.598 C 161.137 364.066 154.434 384.138 154.465 404.764 C 154.465 406.263 154.507 407.765 154.572 409.265 C 128.294 393.45 106.305 371.421 90.539 345.114 C 92.127 345.182 93.715 345.229 95.304 345.229 C 115.944 345.262 136.031 338.567 152.524 326.158 C 156.362 323.283 159.971 320.115 163.319 316.683 C 172.59 307.286 179.791 296.053 184.458 283.705 L 184.458 283.682 C 188.559 272.924 190.651 261.505 190.63 249.993 C 190.63 217.526 216.753 191.066 249.113 190.48 L 249.769 190.481 C 282.632 190.481 309.347 217.173 309.347 250.003 C 309.326 238.492 311.418 227.073 315.518 216.315 Z M 157.067 426.985 C 121.099 408.001 91.722 378.568 72.806 342.563 C 69.784 336.825 67.056 330.937 64.632 324.921 C 54.968 301.124 50.015 275.677 50.047 249.993 C 50.074 215.144 87.817 193.392 117.984 210.841 C 122.453 213.425 126.447 216.756 129.793 220.687 C 132.788 208.302 137.699 196.46 144.349 185.59 L 144.356 185.577 C 130.273 174.829 113.043 169.018 95.327 169.044 C 90.993 169.046 86.667 169.388 82.386 170.067 C 76.296 171.047 70.338 172.724 64.631 175.066 C 35.749 186.925 15.181 214.971 14.324 247.851 C 14.299 248.565 14.299 249.279 14.299 249.993 C 14.299 250.708 14.299 251.423 14.324 252.137 C 14.479 272.123 17.193 292.007 22.402 311.303 C 44.125 391.862 107.653 455.493 188.198 477.426 C 172.789 464.419 161.911 446.854 157.135 427.264 Z M 82.387 329.923 C 86.66 330.601 90.978 330.942 95.304 330.944 C 113.026 330.967 130.263 325.153 144.349 314.396 C 148.23 311.425 151.843 308.119 155.144 304.515 C 168.792 289.639 176.353 270.18 176.331 249.993 C 176.312 238.275 179.099 226.723 184.458 216.302 L 184.458 216.278 C 191.512 202.619 202.628 191.483 216.273 184.403 L 216.047 184.317 L 216.022 184.317 C 203.751 179.686 192.576 172.557 183.204 163.381 C 171.869 172.169 162.342 183.065 155.145 195.47 C 145.59 212.051 140.568 230.856 140.585 249.993 C 140.57 284.832 102.849 306.59 72.685 289.159 C 70.999 288.184 69.377 287.102 67.829 285.918 C 70.807 301.14 75.699 315.924 82.386 329.92 Z M 64.351 251.334 C 65.409 275.16 91.863 288.907 111.968 276.077 C 120.877 270.392 126.273 260.559 126.284 249.993 C 126.284 249.628 126.285 249.262 126.289 248.899 C 125.425 225.064 99.084 211.104 78.874 223.768 C 69.843 229.428 64.355 239.334 64.346 249.993 C 64.346 250.442 64.347 250.888 64.351 251.334 Z"
      />
    </svg>
  );
}

/**
 * Neon's logomark, verbatim from `neon-logomark-dark-color.svg` and
 * `neon-logomark-light-color.svg` on Neon's brand page
 * (https://neon.com/brand), which differ only in their green, one for each
 * ground; drawn in `currentColor` with `.integration-mark-neon`
 * (`styles/desktop.css`) setting which.
 */
function NeonMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={`${className} integration-mark-neon`}
      viewBox="0 0 64 64"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M63 0.0177909V63.5526L38.4178 42.2501V63.5526H0V0L63 0.0177909ZM7.72251 55.8389H30.6953V25.3238L55.2779 47.0476V7.72922L7.72251 7.71559V55.8389Z" />
    </svg>
  );
}

/**
 * Notion's block logomark, verbatim from `notion-logo-block-mono-black.svg`
 * in `notion-logos-2024.zip` from Notion's brand guidelines
 * (https://notion.notion.site/Notion-Brand-Guidelines-db8fda2d1f0048bba1f4e547dfc48830).
 * Notion publishes the mono mark in pure black and pure white and asks for
 * the white one on a dark ground, so it is drawn in `currentColor` with
 * `.integration-mark-notion` (`styles/desktop.css`) setting which.
 */
function NotionMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={`${className} integration-mark-notion`}
      viewBox="0 0 335 350"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M214.701 0.796296L21.056 15.0565C5.44153 16.4088 0 26.5954 0 38.8077V250.61C0 260.126 3.3919 268.259 11.5487 279.13L57.0693 338.19C64.5464 347.701 71.3416 349.735 85.6192 349.054L310.498 335.475C329.518 334.124 334.958 325.292 334.958 310.358V72.0749C334.958 64.3554 331.904 62.1254 322.899 55.5518C322.404 55.1901 321.891 54.8153 321.359 54.4257L259.545 10.9802C244.599 0.122938 238.481 -1.24326 214.701 0.796296ZM90.718 68.1664C72.3581 69.4062 68.1862 69.6879 57.7599 61.2177L31.2457 40.1737C28.5415 37.4525 29.8978 34.0579 36.6871 33.3847L222.855 19.8061C238.478 18.4455 246.629 23.8852 252.747 28.635L284.678 51.7183C286.038 52.3944 289.429 56.4624 285.351 56.4624L93.0882 68.0071C92.2729 68.0614 91.4837 68.1147 90.719 68.1664L90.718 68.1664ZM69.3031 308.318V106.024C69.3031 97.2006 72.021 93.1245 80.1694 92.4398L300.977 79.5458C308.466 78.867 311.857 83.6223 311.857 92.4398V293.376C311.857 302.208 310.495 309.686 298.261 310.358L86.9643 322.584C74.7361 323.257 69.3031 319.19 69.3031 308.318ZM277.894 116.876C279.249 122.992 277.894 129.102 271.768 129.789L261.586 131.817V281.164C252.747 285.915 244.596 288.631 237.804 288.631C226.929 288.631 224.206 285.234 216.06 275.056L149.467 170.513V271.662L170.539 276.417C170.539 276.417 170.539 288.631 153.538 288.631L106.67 291.349C105.308 288.631 106.67 281.848 111.424 280.488L123.654 277.099V143.362L106.672 142.001C105.311 135.886 108.703 127.068 118.221 126.383L168.501 122.994L237.804 228.898V135.212L220.135 133.184C218.778 125.707 224.206 120.278 231.001 119.605L277.894 116.876Z"
      />
    </svg>
  );
}

/**
 * PostHog's full-colour logomark, verbatim from `posthog-logomark.svg` in
 * PostHog's brand package (https://github.com/PostHog/brand, served at
 * https://brand.posthog.com/logo/posthog-logomark.svg), in its gradients on
 * a white rounded square on either ground. PostHog's rules
 * (https://brand.posthog.com/logo) keep the gradient mark off a dark ground
 * and refuse a recoloured part, such as the hedgehog's face turned white,
 * so the square is what lets the colour mark stand on a dark row with its
 * face intact; on a light row it is the row's own white. Its gradients' ids
 * are this mark's own, so two marks on one page never paint with each
 * other's.
 */
function PostHogMark({ className }: MarkProps): React.JSX.Element {
  const id = useId();
  return (
    <svg className={className} viewBox="-3.17 -15 58 58" aria-hidden="true" focusable="false">
      <rect x="-3.17" y="-15" width="58" height="58" rx="12" fill="#fff" />
      <path
        fill={`url(#${id}-p6)`}
        d="M10.74 7.16 4.54.8A2.66 2.66 0 0 0 0 2.66V7.5l10.74 11.18z"
      />
      <path fill={`url(#${id}-p7)`} d="M9.19 28h1.55v-9.32L0 7.5v10.73z" />
      <path fill={`url(#${id}-p8)`} d="M0 25.41A2.6 2.6 0 0 0 2.58 28H9.2L0 18.23z" />
      <path
        fill={`url(#${id}-p3)`}
        d="M10.74 2.66v4.5l11.22 11.52V7.63L15.3.8a2.66 2.66 0 0 0-4.56 1.86"
      />
      <path fill={`url(#${id}-p4)`} d="M10.74 28h8.96l-8.96-9.32z" />
      <path fill={`url(#${id}-p5)`} d="M10.74 7.16v11.52L19.7 28h2.26v-9.32z" />
      <path
        fill={`url(#${id}-p0)`}
        d="M21.96 2.67v4.96l11.3 11.6h.02V7.75L26.63.85a2.8 2.8 0 0 0-2-.85 2.67 2.67 0 0 0-2.67 2.67"
      />
      <path fill={`url(#${id}-p1)`} d="M21.96 7.63v11.05L31.03 28h2.25v-8.75z" />
      <path fill={`url(#${id}-p2)`} d="M21.96 28h9.07l-9.07-9.32z" />
      <path
        fill="#111"
        d="M51.66 25.22A1.9 1.9 0 0 0 50 23.33l-.34-.04c-1-.13-1.94-.6-2.65-1.33L33.28 7.75V28H49a2.66 2.66 0 0 0 2.67-2.67zM39.2 23.54h-.09a1.78 1.78 0 1 1 .1 0"
      />
      <defs>
        <linearGradient
          id={`${id}-p0`}
          x1="21.96"
          x2="33.28"
          y1="9.62"
          y2="9.62"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ffd849" />
          <stop offset=".96" stopColor="#fbae01" />
        </linearGradient>
        <linearGradient
          id={`${id}-p1`}
          x1="21.96"
          x2="33.28"
          y1="17.81"
          y2="17.81"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ffb700" />
          <stop offset="1" stopColor="#f9aa01" />
        </linearGradient>
        <linearGradient
          id={`${id}-p2`}
          x1="21.96"
          x2="31.03"
          y1="23.34"
          y2="23.34"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff9500" />
          <stop offset="1" stopColor="#f8aa00" />
        </linearGradient>
        <linearGradient
          id={`${id}-p3`}
          x1="10.74"
          x2="21.96"
          y1="9.34"
          y2="9.34"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff651e" />
          <stop offset="1" stopColor="#e4400a" />
        </linearGradient>
        <linearGradient
          id={`${id}-p4`}
          x1="10.74"
          x2="19.7"
          y1="23.34"
          y2="23.34"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#c42c00" />
          <stop offset="1" stopColor="#d63600" />
        </linearGradient>
        <linearGradient
          id={`${id}-p5`}
          x1="10.74"
          x2="21.96"
          y1="17.58"
          y2="17.58"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ef3c00" />
          <stop offset="1" stopColor="#d63601" />
        </linearGradient>
        <linearGradient
          id={`${id}-p6`}
          x1="0"
          x2="10.74"
          y1="9.34"
          y2="9.34"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#3f80ff" />
          <stop offset="1" stopColor="#084fe0" />
        </linearGradient>
        <linearGradient
          id={`${id}-p7`}
          x1="0"
          x2="10.74"
          y1="17.75"
          y2="17.75"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0255ff" />
          <stop offset="1" stopColor="#0145d2" />
        </linearGradient>
        <linearGradient
          id={`${id}-p8`}
          x1="0"
          x2="9.19"
          y1="23.11"
          y2="23.11"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0041c6" />
          <stop offset="1" stopColor="#0045d0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Sentry's glyph, verbatim from the logo generator on Sentry's branding page
 * (https://sentry.io/branding/, Glyph with no clear space), whose brand guide
 * (https://live.standards.site/sentry) uses the glyph alone where space is
 * short. Sentry publishes it in one colour, its dark blurple on a light
 * ground and white on a dark one, so it is drawn in `currentColor` with
 * `.integration-mark-sentry` (`styles/desktop.css`) setting which.
 */
function SentryMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={`${className} integration-mark-sentry`}
      viewBox="0 0 50 44"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
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

/**
 * Supabase's logomark, verbatim from `supabase-logo-icon.svg` in Supabase's
 * brand assets (https://supabase.com/brand-assets, `brand-assets.zip`), in
 * its own greens on either ground. Its gradients' ids are this mark's own,
 * so two marks on one page never paint with each other's.
 */
function SupabaseMark({ className }: MarkProps): React.JSX.Element {
  const id = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 109 113"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
        fill={`url(#${id}-paint0)`}
      />
      <path
        d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
        fill={`url(#${id}-paint1)`}
        fillOpacity="0.2"
      />
      <path
        d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z"
        fill="#3ECF8E"
      />
      <defs>
        <linearGradient
          id={`${id}-paint0`}
          x1="53.9738"
          y1="54.974"
          x2="94.1635"
          y2="71.8295"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#249361" />
          <stop offset="1" stopColor="#3ECF8E" />
        </linearGradient>
        <linearGradient
          id={`${id}-paint1`}
          x1="36.1558"
          y1="30.578"
          x2="54.4844"
          y2="65.0806"
          gradientUnits="userSpaceOnUse"
        >
          <stop />
          <stop offset="1" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Vercel's logomark, verbatim from `vercel-icon-light.svg` in Vercel's
 * brand assets (https://vercel.com/geist/brands, `vercel-assets.zip`),
 * which Vercel publishes in black and in white; drawn in `currentColor` for either
 * ground.
 */
function VercelMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 1155 1000"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M577.344 0L1154.69 1000H0L577.344 0Z" />
    </svg>
  );
}

/**
 * Y Combinator's mark, verbatim from the logo in ycombinator.com's own
 * header (https://www.ycombinator.com), its white Y on its orange square on
 * either ground.
 */
function YCombinatorMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <path d="M47.9985 47.9994H0V8.61853e-07H47.9985V47.9994Z" fill="#FF6600" />
      <path
        d="M13.9012 11.7843H17.6595L22.4961 21.5325C23.203 22.9836 23.7984 24.3976 23.7984 24.3976C23.7984 24.3976 24.4313 23.021 25.175 21.5325L30.0868 11.7843H33.5843L25.2865 27.3746V37.309H22.1244V27.1884L13.9012 11.7843Z"
        fill="white"
      />
    </svg>
  );
}

/** One provider's mark, at `size`, or the size of the slot it stands in. */
export function ProviderMark({
  provider,
  size = PROVIDER_MARK_SIZE.SLOT,
}: {
  provider: MarkProvider;
  size?: ProviderMarkSize | undefined;
}): React.JSX.Element {
  const className = MARK_CLASS[size];
  switch (provider) {
    case MARK_PROVIDER.GOOGLE:
      return <GoogleMark className={className} />;
    case MARK_PROVIDER.EXECUTOR:
      return <ExecutorMark className={className} />;
    case MARK_PROVIDER.GITHUB:
      return <GitHubMark className={className} />;
    case MARK_PROVIDER.GRANOLA:
      return <GranolaMark className={className} />;
    case MARK_PROVIDER.LINEAR:
      return <LinearMark className={className} />;
    case MARK_PROVIDER.MERCURY:
      return <MercuryMark className={className} />;
    case MARK_PROVIDER.NEON:
      return <NeonMark className={className} />;
    case MARK_PROVIDER.NOTION:
      return <NotionMark className={className} />;
    case MARK_PROVIDER.POSTHOG:
      return <PostHogMark className={className} />;
    case MARK_PROVIDER.SENTRY:
      return <SentryMark className={className} />;
    case MARK_PROVIDER.SLACK:
      return <SlackMark className={className} />;
    case MARK_PROVIDER.SUPABASE:
      return <SupabaseMark className={className} />;
    case MARK_PROVIDER.VERCEL:
      return <VercelMark className={className} />;
    case MARK_PROVIDER.YCOMBINATOR:
      return <YCombinatorMark className={className} />;
  }
}

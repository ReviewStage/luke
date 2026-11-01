/**
 * owner-pictures.ts -- a repository owner's picture for the shots, drawn here rather than fetched: a synthetic org mark as an SVG data URL.
 *
 * Throwaway (`README.md`). A fixture run asks nothing of the network, and
 * acme is invented, so its logo is drawn here. The renderer's image policy admits `data:`.
 */

/**
 * acme's mark: two peaks on deep teal, as a full-bleed square the way
 * GitHub serves an organisation's picture (the UI rounds it).
 */
const ACME_MARK =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" fill="#0f766e"/>` +
  `<path d="M14 46 L28 20 L42 46 Z" fill="#fff"/>` +
  `<path d="M30 46 L40 28 L50 46 Z" fill="#99f6e4"/></svg>`;

/** The owner's picture as a data URL: acme's mark for every owner, since every fixture repository is acme's. */
export function shotOwnerPicture(_repository: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(ACME_MARK)}`;
}

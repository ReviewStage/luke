/**
 * styles.ts -- every stylesheet the catalog's page is drawn with, in cascade
 * order, imported once by the page (`main.tsx`) and once by the visual
 * comparison, so a golden is cut from the sheets a reader sees.
 *
 * The site's faces are bundled from the workspace, so nothing is fetched from
 * the network; the desktop's is the system's own. Then the motion tokens every
 * shared component times itself by, then the page.
 */

import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@luke/brand/motion-tokens.css";
import "./catalog.css";

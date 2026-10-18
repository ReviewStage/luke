import { surfaceAttributes } from "@luke/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Catalog, readView } from "./catalog";
// The site's faces, bundled from the workspace so the catalog loads nothing
// from the network; the desktop's is the system's own. Then the page.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "./catalog.css";

/**
 * main.tsx -- the catalog's entry: the document takes the view's profile,
 * theme, and density before the first render, as an app's root carries them
 * in its markup, then the page is drawn.
 */

const view = readView(window.location.search);
for (const [name, value] of Object.entries(
  surfaceAttributes(view.profile, view.theme, view.density),
)) {
  document.documentElement.setAttribute(name, value);
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <Catalog view={view} />
  </StrictMode>,
);

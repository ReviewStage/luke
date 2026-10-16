import { surfaceAttributes } from "@luke/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Catalog, readView } from "./catalog";
import "./styles";

/**
 * main.tsx -- the catalog's entry: the document takes the view's profile and
 * theme before the first render, as an app's root carries them in its markup,
 * then the page is drawn.
 */

const view = readView(window.location.search);
for (const [name, value] of Object.entries(surfaceAttributes(view.profile, view.theme))) {
  document.documentElement.setAttribute(name, value);
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <Catalog view={view} />
  </StrictMode>,
);

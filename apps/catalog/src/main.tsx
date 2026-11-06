import { Announcer, surfaceAttributes } from "@repo/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Catalog, readView } from "./catalog";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "./catalog.css";

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
    <Announcer />
  </StrictMode>,
);

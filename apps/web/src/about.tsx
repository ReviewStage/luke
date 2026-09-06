import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { AboutPage } from "./AboutPage";
import { startSiteAnalytics } from "./analytics";
import "./styles.css";

// Every page the site builds, not only the landing one: a funnel that saw
// the landing page alone would undercount everyone who arrived by a link.
startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

hydrateRoot(
  rootElement,
  <StrictMode>
    <AboutPage />
  </StrictMode>,
);

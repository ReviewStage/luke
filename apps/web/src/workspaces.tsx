import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startSiteAnalytics } from "./analytics";
import { WorkspacesPage } from "./WorkspacesPage";
import "./styles.css";

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <WorkspacesPage />
  </StrictMode>,
);

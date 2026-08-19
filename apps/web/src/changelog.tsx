import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChangelogPage } from "./ChangelogPage";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <ChangelogPage />
  </StrictMode>,
);

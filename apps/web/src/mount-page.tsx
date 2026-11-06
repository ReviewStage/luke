import { QueryProvider } from "@repo/panel/query-client";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

export function mountPrerenderedPage(page: React.JSX.Element): void {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element is missing");
  const tree = (
    <StrictMode>
      <QueryProvider>{page}</QueryProvider>
    </StrictMode>
  );
  if (rootElement.hasChildNodes()) {
    hydrateRoot(rootElement, tree);
  } else {
    createRoot(rootElement).render(tree);
  }
}

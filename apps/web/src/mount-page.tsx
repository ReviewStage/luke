import { QueryProvider } from "@repo/panel/query-client";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

/**
 * Mounts one of the prerendered pages. The build writes the page's markup
 * into `#root` and the entry hydrates it, but the dev server serves the
 * source HTML, whose root is empty, and hydrating nothing is a mismatch
 * React reports before rendering anyway. So a filled root is hydrated and an
 * empty one is rendered fresh, and the entry does not need to know which
 * server it came from. The page stands on the window's one Query client, as
 * the panel does, which draws nothing of its own and so hydrates the markup as
 * it stands.
 */
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

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

/**
 * Mounts one of the prerendered pages. The build writes the page's markup
 * into `#root` and the entry hydrates it, but the dev server serves the
 * source HTML, whose root is empty, and hydrating nothing is a mismatch
 * React reports before rendering anyway. So a filled root is hydrated and an
 * empty one is rendered fresh, and the entry does not need to know which
 * server it came from.
 */
export function mountPrerenderedPage(page: React.JSX.Element): void {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element is missing");
  const tree = <StrictMode>{page}</StrictMode>;
  if (rootElement.hasChildNodes()) {
    hydrateRoot(rootElement, tree);
  } else {
    createRoot(rootElement).render(tree);
  }
}

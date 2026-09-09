/**
 * What a route file default-exports: one fetch handler, which is the whole of
 * what the platform asks of a function. Named here so every wrapper that
 * builds one says the same thing.
 */
export interface Route {
  fetch: (request: Request) => Promise<Response>;
}

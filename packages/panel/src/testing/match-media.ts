function unmatched(query: string): MediaQueryList {
  const ignore = () => undefined;
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: ignore,
    removeEventListener: ignore,
    addListener: ignore,
    removeListener: ignore,
    dispatchEvent: () => false,
  };
}

globalThis.matchMedia ??= unmatched;

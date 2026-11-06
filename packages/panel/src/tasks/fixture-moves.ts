const listeners = new Set<() => void>();

export function onFixtureMoved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function fixtureMoved(): void {
  for (const listener of listeners) listener();
}

import { useState } from "react";

export interface SendQueue {
  readonly after: (key: string, send: () => Promise<void>) => void;
  readonly settled: (key: string) => Promise<void>;
}

function done(): undefined {
  return undefined;
}

function sendQueue(): SendQueue {
  const newest = new Map<string, Promise<void>>();
  return {
    after: (key, send) => {
      const before = newest.get(key) ?? Promise.resolve();
      newest.set(key, before.then(send));
    },
    settled: (key) => (newest.get(key) ?? Promise.resolve()).then(done, done),
  };
}

export function useSendQueue(): SendQueue {
  const [queue] = useState(sendQueue);
  return queue;
}

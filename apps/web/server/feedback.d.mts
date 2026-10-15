// feedback.d.mts -- the feedback endpoint's one export, typed for the tests that call it: the function stays plain JavaScript for Vercel's builder (feedback.mjs).
export function POST(request: Request): Promise<Response>;

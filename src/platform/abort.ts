/**
 * How a picker says "the user changed their mind".
 *
 * Dismissing a file picker and dismissing a directory picker are the same event,
 * reported the same way, and both seams have to translate it into a returned
 * result rather than an exception the caller recognises. One copy, because two
 * pickers declining in two slightly different ways is exactly the kind of drift
 * that turns into a bug nobody can reproduce.
 */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

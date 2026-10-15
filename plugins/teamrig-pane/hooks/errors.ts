/** What a rejection says: an Error's message, or anything else as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

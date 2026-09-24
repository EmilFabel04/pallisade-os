/** Fathom is configured when an API key is present. The single-user app uses a
 *  key rather than OAuth: OAuth exists for public integrations, and there is no
 *  second user to authorise. */
export function isConfigured(): boolean {
  return !!process.env.FATHOM_API_KEY?.trim();
}

/** The key, or a throw. Callers guard with isConfigured() first — the tool
 *  resolver turns the guard into prose the model can relay. */
export function apiKey(): string {
  const key = process.env.FATHOM_API_KEY?.trim();
  if (!key) throw new Error("FATHOM_API_KEY is not set");
  return key;
}

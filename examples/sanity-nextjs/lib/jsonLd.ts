/** Parse jsonLd field stored by backend (JSON array of script bodies). */
export function parseJsonLdScripts(serialized: string | undefined | null): string[] {
  if (!serialized?.trim()) return [];
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    }
  } catch {
    /* single block */
  }
  return [serialized];
}

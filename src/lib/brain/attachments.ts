/** Render attached session docs as an injectable context block, capped to a
 *  total character budget (truncating later docs with a marker). */
export function formatAttachmentsBlock(
  attachments: { name: string; content: string }[],
  maxChars = 120000,
): string {
  if (!attachments.length) return "";
  let used = 0;
  const parts = attachments.map((a) => {
    const remaining = maxChars - used;
    if (remaining <= 0) return `<<DOCUMENT: ${a.name}>>\n[omitted — attachment budget exceeded]`;
    const body =
      a.content.length > remaining ? `${a.content.slice(0, remaining)}\n[truncated]` : a.content;
    used += body.length;
    return `<<DOCUMENT: ${a.name}>>\n${body}\n<<END ${a.name}>>`;
  });
  return `SESSION DOCUMENTS (provided by the founder):\n\n${parts.join("\n\n")}`;
}

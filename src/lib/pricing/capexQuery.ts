export interface CapexQueryParams {
  company: string;
  industry: string;
  companyType: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Empty when there is no company to research — the route rejects rather than
    burning a web search on a blank name. The route casts an unchecked request
    body to this type, so every field (and the body itself) is read
    defensively: `null`, `undefined`, or any other non-string degrades to ""
    instead of throwing past the route's error handling. */
export function capexQuery(params: CapexQueryParams): string {
  const p = params ?? ({} as CapexQueryParams);
  const company = str(p.company);
  if (!company) return "";

  const lines = [`Company: ${company}`];
  const industry = str(p.industry);
  const companyType = str(p.companyType);
  if (industry) lines.push(`Industry: ${industry}`);
  if (companyType) lines.push(`Type: ${companyType}`);
  return lines.join("\n");
}

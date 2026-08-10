export interface CapexQueryParams {
  company: string;
  industry: string;
  companyType: string;
}

/** Empty when there is no company to research — the route rejects rather than
    burning a web search on a blank name. */
export function capexQuery(params: CapexQueryParams): string {
  const company = params.company.trim();
  if (!company) return "";

  const lines = [`Company: ${company}`];
  if (params.industry.trim()) lines.push(`Industry: ${params.industry.trim()}`);
  if (params.companyType.trim()) lines.push(`Type: ${params.companyType.trim()}`);
  return lines.join("\n");
}

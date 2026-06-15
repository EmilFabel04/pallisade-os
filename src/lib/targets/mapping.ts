import type { Target } from "@/lib/types";

export type NewTarget = Omit<Target, "id" | "createdAt" | "updatedAt">;
export type TargetField = keyof NewTarget;

export const TARGET_FIELDS: TargetField[] = [
  "company", "contactName", "contactRole", "email",
  "phone", "linkedinUrl", "industry", "location", "notes",
];

export type ColumnMapping = (TargetField | "ignore")[];

/** Header (normalised) → field. Covers common CSV export variants. */
const SYNONYMS: Record<string, TargetField> = {
  company: "company", companyname: "company", organisation: "company", organization: "company", account: "company",
  contactname: "contactName", fullname: "contactName", name: "contactName", contact: "contactName", person: "contactName",
  contactrole: "contactRole", role: "contactRole", title: "contactRole", jobtitle: "contactRole", position: "contactRole",
  email: "email", emailaddress: "email", mail: "email",
  phone: "phone", phonenumber: "phone", mobile: "phone", tel: "phone",
  linkedinurl: "linkedinUrl", linkedin: "linkedinUrl", profileurl: "linkedinUrl", profile: "linkedinUrl",
  industry: "industry", sector: "industry", vertical: "industry",
  location: "location", city: "location", country: "location", region: "location",
  notes: "notes", note: "notes", comment: "notes", comments: "notes", description: "notes",
};

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Guess a field per column from its header; first column to claim a field wins. */
export function guessMapping(headers: string[]): ColumnMapping {
  const used = new Set<TargetField>();
  return headers.map((h) => {
    const field = SYNONYMS[normalise(h)];
    if (field && !used.has(field)) { used.add(field); return field; }
    return "ignore";
  });
}

const BLANK: NewTarget = {
  company: "", contactName: "", contactRole: "", email: "",
  phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
};

/** Apply a mapping to raw rows; trim values; skip rows with no company AND no contactName. */
export function rowsToTargets(
  rows: string[][],
  mapping: ColumnMapping,
): { targets: NewTarget[]; blankSkipped: number } {
  const targets: NewTarget[] = [];
  let blankSkipped = 0;
  for (const row of rows) {
    const t: NewTarget = { ...BLANK };
    mapping.forEach((field, col) => {
      if (field !== "ignore") t[field] = (row[col] ?? "").trim();
    });
    if (!t.company && !t.contactName) { blankSkipped++; continue; }
    targets.push(t);
  }
  return { targets, blankSkipped };
}

/** Drop incoming rows whose non-empty email/linkedinUrl already exists (case-insensitive),
 *  checking both the existing store and earlier rows in the same batch. */
export function dedupeTargets(
  incoming: NewTarget[],
  existing: Target[],
): { toAdd: NewTarget[]; duplicates: number } {
  const emails = new Set<string>();
  const links = new Set<string>();
  for (const e of existing) {
    if (e.email) emails.add(e.email.toLowerCase());
    if (e.linkedinUrl) links.add(e.linkedinUrl.toLowerCase());
  }
  const toAdd: NewTarget[] = [];
  let duplicates = 0;
  for (const t of incoming) {
    const em = t.email.toLowerCase();
    const ln = t.linkedinUrl.toLowerCase();
    if ((em && emails.has(em)) || (ln && links.has(ln))) { duplicates++; continue; }
    if (em) emails.add(em);
    if (ln) links.add(ln);
    toAdd.push(t);
  }
  return { toAdd, duplicates };
}

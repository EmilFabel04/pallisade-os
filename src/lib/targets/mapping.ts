import type { Target } from "@/lib/types";

export type NewTarget = Omit<Target, "id" | "createdAt" | "updatedAt">;
export type TargetField = keyof NewTarget;

export const TARGET_FIELDS: TargetField[] = [
  "company", "contactName", "contactRole", "email",
  "phone", "linkedinUrl", "industry", "location", "notes",
];

/** A column maps to a target field, to a name part (joined into contactName), or is ignored. */
export type ColumnRole = TargetField | "firstName" | "lastName" | "ignore";
export type ColumnMapping = ColumnRole[];

/** Roles selectable in the import mapping UI, in dropdown order. */
export const COLUMN_ROLES: ColumnRole[] = ["ignore", "firstName", "lastName", ...TARGET_FIELDS];

/** Header (normalised) → role. Covers common CSV export variants (incl. Apollo). */
const SYNONYMS: Record<string, ColumnRole> = {
  company: "company", companyname: "company", organisation: "company", organization: "company", account: "company",
  firstname: "firstName", givenname: "firstName", forename: "firstName",
  lastname: "lastName", surname: "lastName", familyname: "lastName",
  contactname: "contactName", fullname: "contactName", name: "contactName", contact: "contactName", person: "contactName",
  contactrole: "contactRole", role: "contactRole", title: "contactRole", jobtitle: "contactRole", position: "contactRole",
  email: "email", emailaddress: "email", mail: "email",
  phone: "phone", phonenumber: "phone", mobile: "phone", mobilephone: "phone", tel: "phone",
  linkedinurl: "linkedinUrl", linkedin: "linkedinUrl", personlinkedinurl: "linkedinUrl", profileurl: "linkedinUrl", profile: "linkedinUrl",
  industry: "industry", sector: "industry", vertical: "industry",
  location: "location", city: "location", country: "location", region: "location",
  notes: "notes", note: "notes", comment: "notes", comments: "notes", description: "notes",
};

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Guess a role per column from its header; first column to claim a role wins. */
export function guessMapping(headers: string[]): ColumnMapping {
  const used = new Set<ColumnRole>();
  return headers.map((h) => {
    const role = SYNONYMS[normalise(h)];
    if (role && !used.has(role)) { used.add(role); return role; }
    return "ignore";
  });
}

const BLANK: NewTarget = {
  company: "", contactName: "", contactRole: "", email: "",
  phone: "", linkedinUrl: "", industry: "", location: "", notes: "",
};

/** Apply a mapping to raw rows; trim values; join firstName + lastName into contactName
 *  (a direct contactName column wins); skip rows with no company AND no contactName. */
export function rowsToTargets(
  rows: string[][],
  mapping: ColumnMapping,
): { targets: NewTarget[]; blankSkipped: number } {
  const targets: NewTarget[] = [];
  let blankSkipped = 0;
  for (const row of rows) {
    const t: NewTarget = { ...BLANK };
    let firstName = "";
    let lastName = "";
    mapping.forEach((role, col) => {
      const value = (row[col] ?? "").trim();
      if (role === "ignore") return;
      if (role === "firstName") { firstName = value; return; }
      if (role === "lastName") { lastName = value; return; }
      t[role] = value;
    });
    if (!t.contactName) {
      t.contactName = [firstName, lastName].filter(Boolean).join(" ");
    }
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

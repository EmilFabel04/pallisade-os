export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** Parse CSV text (RFC-4180-ish): quoted fields, embedded commas/newlines, escaped "". */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { records.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }       // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\r") { /* skip; the following \n ends the record */ }
    else if (c === "\n") { pushField(); pushRecord(); }
    else field += c;
  }
  // Flush a final field/record that wasn't newline-terminated.
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  // Drop fully-blank records (e.g. produced by a trailing newline).
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0];
  const width = headers.length;
  const rows = nonEmpty.slice(1).map((r) => {
    const copy = r.slice(0, width);
    while (copy.length < width) copy.push("");
    return copy;
  });
  return { headers, rows };
}

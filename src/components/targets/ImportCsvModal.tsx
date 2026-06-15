"use client";

import { useState } from "react";
import { Upload, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Field";
import type { Target } from "@/lib/types";
import { parseCsv } from "@/lib/targets/csv";
import {
  guessMapping, rowsToTargets, dedupeTargets,
  TARGET_FIELDS, type ColumnMapping, type NewTarget,
} from "@/lib/targets/mapping";

interface Summary { added: number; duplicates: number; blank: number }

export function ImportCsvModal({
  open,
  onClose,
  existing,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  existing: Target[];
  /** Page persists each accepted record into the store. */
  onImport: (records: NewTarget[]) => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const reset = () => {
    setHeaders([]); setRows([]); setMapping([]); setFileError(null); setSummary(null);
  };
  const close = () => { reset(); onClose(); };

  const onFile = async (file: File) => {
    setFileError(null);
    const { headers: h, rows: r } = parseCsv(await file.text());
    if (h.length === 0) { setFileError("Couldn't read any columns from that file."); return; }
    setHeaders(h); setRows(r); setMapping(guessMapping(h));
  };

  const setColumn = (col: number, value: string) => {
    setMapping((m) => m.map((v, i) => (i === col ? (value as ColumnMapping[number]) : v)));
  };

  const canImport = rows.length > 0 && mapping.some((m) => m !== "ignore");

  const runImport = () => {
    const { targets, blankSkipped } = rowsToTargets(rows, mapping);
    const { toAdd, duplicates } = dedupeTargets(targets, existing);
    onImport(toAdd);
    setSummary({ added: toAdd.length, duplicates, blank: blankSkipped });
  };

  const fieldOptions = ["ignore", ...TARGET_FIELDS];

  return (
    <Modal open={open} onClose={close} title="Import targets from CSV" size="lg">
      {summary ? (
        <div className="space-y-4">
          <p className="text-[0.9rem] text-[var(--color-ink)]">
            Imported <b>{summary.added}</b> · skipped <b>{summary.duplicates}</b> duplicate
            {summary.duplicates === 1 ? "" : "s"} · <b>{summary.blank}</b> blank row
            {summary.blank === 1 ? "" : "s"} ignored.
          </p>
          <div className="flex justify-end">
            <button className="btn btn-accent" onClick={close}>Done</button>
          </div>
        </div>
      ) : headers.length === 0 ? (
        <div className="space-y-3">
          <p className="text-[0.85rem] text-[var(--color-muted)] leading-relaxed">
            Choose a CSV file. We'll guess which column maps to which field, then let you
            confirm before importing.
          </p>
          <label className="btn">
            <Upload size={15} /> Choose CSV…
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            />
          </label>
          {fileError && <p className="text-[0.8rem] text-[var(--color-accent)]">{fileError}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[0.82rem] text-[var(--color-muted)]">
            {rows.length} row{rows.length === 1 ? "" : "s"} found. Confirm the column mapping:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.78rem]">
              <thead>
                <tr>
                  {headers.map((h, col) => (
                    <th key={col} className="text-left p-1 align-top">
                      <div className="text-[var(--color-dim)] truncate mb-1" title={h}>{h || "(blank)"}</div>
                      <Select
                        options={fieldOptions}
                        value={mapping[col]}
                        onChange={(e) => setColumn(col, e.target.value)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, ri) => (
                  <tr key={ri} className="border-t border-[var(--color-line)]">
                    {headers.map((_, col) => (
                      <td key={col} className="p-1 text-[var(--color-muted)] truncate max-w-[160px]">{r[col]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2">
            <button className="btn" onClick={reset}>Choose a different file</button>
            <button className="btn btn-accent" onClick={runImport} disabled={!canImport}>
              <Check size={15} /> Import {rows.length}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

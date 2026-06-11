import { cn } from "@/lib/utils";

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[0.7rem] text-[var(--color-dim)]">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input", props.className)} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      {...props}
      className={cn("input tnum", props.className)}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("textarea", props.className)} rows={props.rows ?? 3} />;
}

export function Select({
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly string[];
}) {
  return (
    <select {...props} className={cn("select", props.className)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">{children}</div>;
}

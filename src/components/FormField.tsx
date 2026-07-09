import type { ReactNode } from "react";

// Wraps a form control with a small caption above it so pre-filled values are
// self-explanatory (e.g. an edit form showing "234.35" is clearly the cost).
// Wrapping the control inside the <label> means clicking the caption focuses
// the control without needing matching id/htmlFor wiring.
export function FormField({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-body">
        {label}
        {required ? <span className="text-amber-400"> *</span> : null}
        {hint ? (
          <span className="normal-case tracking-normal text-zinc-600"> · {hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

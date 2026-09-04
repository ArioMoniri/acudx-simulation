import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Form primitives — one consistent input language (label + control + hint +
 * error) so the setup wizard, authoring, and dialogs stop hand-rolling inputs.
 * Controls share hairline geometry, an inset focus ring via the global
 * focus-visible rule, and token-driven surfaces.
 */

const controlBase =
  "w-full rounded-control border border-border-strong bg-surface text-fg " +
  "px-3 text-sm placeholder:text-subtle transition-colors duration-150 " +
  "hover:border-border-strong focus:border-brand focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-[color:var(--state-critical)]";

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextInput({ className, ...props }, ref) {
  return (
    <input ref={ref} className={cn(controlBase, "h-9", className)} {...props} />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(controlBase, "resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(controlBase, "h-9 appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </div>
  );
});

export interface FieldProps {
  label: ReactNode;
  /** Supporting hint below the label. */
  hint?: ReactNode;
  /** Error message — sets aria-invalid + describedby on the control. */
  error?: ReactNode;
  /** Marks the field visually optional/required. */
  optional?: boolean;
  /** The control. Receives id + aria wiring via render-prop. */
  children: (aria: {
    id: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
  className?: string;
}

/**
 * Field — labelled wrapper that wires id / aria-describedby / aria-invalid to
 * its control via a render prop, so hints and errors are always announced.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = error ? errId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-medium text-fg">
        {label}
        {optional ? (
          <span className="text-xs font-normal text-subtle">optional</span>
        ) : null}
      </label>
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error ? (
        <p id={errId} className="text-xs text-[color:var(--state-critical)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

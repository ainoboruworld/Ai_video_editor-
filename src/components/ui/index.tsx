'use client';

import React from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Shared primitives. Deliberately small and unstyled-by-default so the editor
 *  chrome stays quiet and the footage is the loudest thing on screen. */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-soft active:bg-accent-dim disabled:bg-accent/40',
  secondary: 'bg-bg-3 text-ink-0 hover:bg-[#232833] border border-line',
  ghost: 'text-ink-1 hover:bg-bg-3 hover:text-ink-0',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: 'default' | 'danger';
}

export function IconButton({ active, tone = 'default', className, children, ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40',
        active ? 'bg-accent-ghost text-accent' : 'text-ink-2 hover:bg-bg-3 hover:text-ink-0',
        tone === 'danger' && 'hover:bg-danger/15 hover:text-danger',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-8 w-full rounded-md border border-line bg-bg-3 px-2.5 text-sm text-ink-0 placeholder:text-ink-3',
        'transition-colors focus:border-accent/60 focus:bg-bg-2',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-md border border-line bg-bg-3 px-2.5 py-2 text-sm leading-relaxed text-ink-0 placeholder:text-ink-3',
        'transition-colors focus:border-accent/60 focus:bg-bg-2 resize-y',
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'h-8 rounded-md border border-line bg-bg-3 px-2 text-sm text-ink-0 transition-colors focus:border-accent/60',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 flex items-baseline justify-between text-2xs font-medium uppercase tracking-wide text-ink-2">
        {label}
        {hint ? <span className="normal-case tracking-normal text-ink-3">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between text-2xs uppercase tracking-wide text-ink-2">
        <span>{label}</span>
        <span className="font-mono text-ink-1">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-sm text-ink-1 hover:bg-bg-3"
    >
      <span>{label}</span>
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-bg-3 ring-1 ring-inset ring-line',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-bg-3 text-ink-2 border-line',
    accent: 'bg-accent-ghost text-accent border-accent/25',
    ok: 'bg-ok/10 text-ok border-ok/25',
    warn: 'bg-warn/10 text-warn border-warn/25',
    danger: 'bg-danger/10 text-danger border-danger/25',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-1">{title}</h2>
        {description ? <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <p className="text-sm font-medium text-ink-1">{title}</p>
      {description ? <p className="max-w-[34ch] text-xs leading-relaxed text-ink-3">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={16} className={cn('animate-spin text-ink-2', className)} />;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full overflow-hidden rounded-xl border border-line bg-bg-1 shadow-pop animate-slide-up',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-0">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-relaxed text-ink-2">{description}</p> : null}
          </div>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={15} />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-bg-3', className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-bg-3', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
    </div>
  );
}

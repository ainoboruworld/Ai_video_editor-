import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useToastStore } from '../../state/toastStore';

// ---------- Button ----------

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed select-none';
  const sizes = size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm';
  const variants: Record<ButtonVariant, string> = {
    default: 'bg-bg-4 border border-line text-ink-1 hover:bg-[#26272c] hover:border-[#3a3b40]',
    primary: 'bg-accent text-white hover:bg-accent-hover border border-transparent',
    ghost: 'text-ink-2 hover:text-ink-1 hover:bg-bg-4 border border-transparent',
    danger: 'bg-[#3a1d1f] border border-[#5c2b2e] text-[#f0a5a8] hover:bg-[#4a2225]',
  };
  return <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...props} />;
}

export function IconButton({
  active = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center h-7 w-7 rounded transition-colors focus-ring disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-accent/20 text-accent-hover' : 'text-ink-2 hover:text-ink-1 hover:bg-bg-4'
      } ${className}`}
      {...props}
    />
  );
}

// ---------- Input / Select / Slider ----------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return (
      <input
        ref={ref}
        className={`h-7 px-2 rounded bg-bg-1 border border-line text-sm text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-accent transition-colors w-full ${className}`}
        {...props}
      />
    );
  },
);

export function Select({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-7 px-1.5 rounded bg-bg-1 border border-line text-sm text-ink-1 focus:outline-none focus:border-accent transition-colors cursor-pointer ${className}`}
      {...props}
    >
      {children}
    </select>
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
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 py-0.5">
      <span className="w-[76px] shrink-0 text-xs text-ink-2">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="flex-1 min-w-0"
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-ink-2">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </label>
  );
}

// ---------- Badge / Progress / Spinner ----------

export function Badge({
  color = 'gray',
  children,
  className = '',
}: {
  color?: 'gray' | 'green' | 'amber' | 'red' | 'indigo';
  children: React.ReactNode;
  className?: string;
}) {
  const colors = {
    gray: 'bg-bg-4 text-ink-2 border-line',
    green: 'bg-[#12291c] text-[#6ee7a0] border-[#1d4230]',
    amber: 'bg-[#2b2312] text-[#f5c76e] border-[#4a3b1d]',
    red: 'bg-[#2b1517] text-[#f0a5a8] border-[#4a2225]',
    indigo: 'bg-accent/15 text-accent-hover border-accent/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 h-[18px] rounded text-xs border ${colors[color]} ${className}`}>
      {children}
    </span>
  );
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1 rounded-full bg-bg-4 overflow-hidden ${className}`}>
      <div
        className="h-full bg-accent transition-[width] duration-300"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 size={14} className={`animate-spin text-ink-2 ${className}`} />;
}

// ---------- Modal ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-bg-2 border border-line rounded-lg shadow-2xl max-h-[85vh] flex flex-col"
        style={{ width }}
      >
        <div className="flex items-center justify-between px-4 h-10 border-b border-line shrink-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton onClick={onClose} title="Close">
            <X size={14} />
          </IconButton>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ---------- Tabs ----------

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 h-8 text-sm border-b -mb-px transition-colors ${
            active === t.id
              ? 'text-ink-1 border-accent'
              : 'text-ink-3 border-transparent hover:text-ink-2'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Panel section ----------

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-b border-line">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
        {right}
      </div>
      <div className="px-3 pb-3">{children}</div>
    </div>
  );
}

// ---------- Empty state ----------

export function EmptyState({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 px-4 text-center">
      {icon && <div className="text-ink-3 mb-1">{icon}</div>}
      <div className="text-sm text-ink-2">{title}</div>
      {hint && <div className="text-xs text-ink-3 max-w-[220px]">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------- Editable label ----------

export function EditableLabel({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(value);
      requestAnimationFrame(() => ref.current?.select());
    }
  }, [editing, value]);
  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft !== value) onChange(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={`bg-bg-1 border border-accent rounded px-1 text-sm focus:outline-none ${className}`}
      />
    );
  }
  return (
    <span
      className={`cursor-text hover:bg-bg-4 rounded px-1 truncate ${className}`}
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
    >
      {value}
    </span>
  );
}

// ---------- Toasts host ----------

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-72">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 px-3 py-2 rounded bg-bg-3 border border-line shadow-lg text-sm"
        >
          {t.kind === 'success' && <CheckCircle2 size={14} className="text-[#6ee7a0] mt-0.5 shrink-0" />}
          {t.kind === 'error' && <AlertCircle size={14} className="text-[#f0a5a8] mt-0.5 shrink-0" />}
          {t.kind === 'info' && <Info size={14} className="text-accent-hover mt-0.5 shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink-1">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

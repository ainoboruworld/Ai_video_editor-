'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore, type ToastKind } from '@/state/toastStore';
import { IconButton } from '@/components/ui';

const ICONS: Record<ToastKind, React.ReactNode> = {
  info: <Info size={15} className="text-ink-1" />,
  success: <CheckCircle2 size={15} className="text-ok" />,
  warn: <AlertTriangle size={15} className="text-warn" />,
  error: <XCircle size={15} className="text-danger" />,
};

/** Errors are never swallowed: every failed action surfaces here. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-bg-2/95 px-3 py-2.5 shadow-pop backdrop-blur animate-slide-up"
        >
          <span className="mt-0.5 shrink-0">{ICONS[toast.kind]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink-0">{toast.message}</p>
            {toast.detail ? <p className="mt-0.5 text-2xs leading-relaxed text-ink-2">{toast.detail}</p> : null}
          </div>
          <IconButton onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <X size={13} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

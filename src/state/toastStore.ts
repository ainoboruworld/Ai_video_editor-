'use client';

import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'warn';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = Math.random().toString(36).slice(2, 9);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }));
    const ttl = toast.kind === 'error' ? 9000 : 4200;
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), ttl);
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'info', message, detail }),
  success: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'success', message, detail }),
  warn: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'warn', message, detail }),
  error: (message: string, detail?: string) => useToastStore.getState().push({ kind: 'error', message, detail }),
};

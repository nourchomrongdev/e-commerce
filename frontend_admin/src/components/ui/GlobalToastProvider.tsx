"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import Toast from "./Toast";
import type { ToastVariant } from "./Toast";

type ToastOptions = { title?: string; duration?: number };
type ToastEntry = { id: number; variant: ToastVariant; message: ReactNode; title?: string; duration?: number };
type ToastMethods = {
  success: (message: ReactNode, options?: ToastOptions) => void;
  error: (message: ReactNode, options?: ToastOptions) => void;
  warning: (message: ReactNode, options?: ToastOptions) => void;
  info: (message: ReactNode, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastMethods | null>(null);

export default function GlobalToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const addToast = useCallback((variant: ToastVariant, message: ReactNode, options?: ToastOptions) => {
    const id = ++nextId.current;
    setItems((current) => [...current, { id, variant, message, ...options }].slice(-4));
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo<ToastMethods>(() => ({
    success: (message, options) => addToast("success", message, options),
    error: (message, options) => addToast("error", message, options),
    warning: (message, options) => addToast("warning", message, options),
    info: (message, options) => addToast("info", message, options),
  }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex max-h-[calc(100vh-2rem)] w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 overflow-hidden" aria-label="Notifications">
        {items.map((item) => (
          <Toast
            key={item.id}
            variant={item.variant}
            title={item.title}
            message={item.message}
            duration={item.duration}
            position="inline"
            className="w-full"
            onClose={() => dismiss(item.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within GlobalToastProvider.");
  return toast;
}

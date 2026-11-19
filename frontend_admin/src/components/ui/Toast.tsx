import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import PublicIcon from "../icons/PublicIcon";

export type ToastVariant = "success" | "error" | "warning" | "info";

export type ToastProps = {
  message: ReactNode;
  title?: string;
  variant?: ToastVariant;
  icon?: ReactNode;
  onClose?: () => void;
  className?: string;
  duration?: number;
  position?: "fixed" | "inline";
};

const defaultDurations: Record<ToastVariant, number> = {
  success: 500,
  error: 500,
  warning: 3000,
  info: 3000,
};

const variants: Record<ToastVariant, { container: string; icon: string; label: string }> = {
  success: {
    container: "border-status-success/20 bg-status-success-surface text-status-success",
    icon: "bg-status-success text-white",
    label: "Success",
  },
  error: {
    container: "border-status-danger/20 bg-status-danger-surface text-status-danger",
    icon: "bg-status-danger text-white",
    label: "Error",
  },
  warning: {
    container: "border-status-warning/20 bg-status-warning-surface text-status-warning",
    icon: "bg-status-warning text-white",
    label: "Warning",
  },
  info: {
    container: "border-status-info/20 bg-status-info-surface text-status-info",
    icon: "bg-status-info text-white",
    label: "Information",
  },
};

export default function Toast({
  message,
  title,
  variant = "info",
  icon,
  onClose,
  className = "",
  duration,
  position = "fixed",
}: ToastProps) {
  const tone = variants[variant];
  const symbol = variant === "success" ? <PublicIcon name="check" /> : variant === "error" ? <PublicIcon name="x" /> : <PublicIcon name="warning" />;
  const effectiveDuration = variant === "success" || variant === "error"
    ? 500
    : duration ?? defaultDurations[variant];
  const [visible, setVisible] = useState(true);
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [progress, setProgress] = useState(100);
  const closeStarted = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const close = useCallback(() => {
    if (closeStarted.current) return;
    closeStarted.current = true;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setVisible(false);
      onCloseRef.current?.();
    }, 160);
  }, []);

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      setEntered(true);
      setProgress(0);
    });
    const timeoutId = effectiveDuration > 0 ? window.setTimeout(close, effectiveDuration) : null;
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, [close, effectiveDuration]);

  if (!visible) return null;

  return (
    <div className={position === "fixed" ? "pointer-events-none fixed right-5 top-24 z-[80]" : "w-full"}>
      <div
        className={`pointer-events-auto relative flex ${position === "fixed" ? "w-[min(24rem,calc(100vw-2rem))]" : "w-full"} items-start gap-3 rounded-lg border px-4 py-3 shadow-lg transition-all duration-150 ease-out ${entered && !closing ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0"} ${tone.container} ${className}`}
        role={variant === "error" ? "alert" : "status"}
        aria-live={variant === "error" ? "assertive" : "polite"}
      >
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${tone.icon}`} aria-hidden="true">
          {icon ?? symbol}
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-semibold">{title ?? tone.label}</p>
          <div className="mt-0.5 leading-5 opacity-90">{message}</div>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close notification"
          className="shrink-0 text-lg leading-none opacity-60 transition hover:opacity-100"
        >
          <PublicIcon name="x" className="h-4 w-4" />
        </button>
        {effectiveDuration > 0 && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-0.5 bg-current opacity-50 transition-[width] ease-linear"
            style={{ width: `${progress}%`, transitionDuration: `${effectiveDuration}ms` }}
          />
        )}
      </div>
    </div>
  );
}

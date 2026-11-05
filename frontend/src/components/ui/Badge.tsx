import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "primary";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-status-success-surface text-status-success",
  warning: "bg-status-warning-surface text-status-warning",
  danger: "bg-status-danger-surface text-status-danger",
  primary: "bg-orange-50 text-primary",
};

export default function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={`type-badge inline-flex items-center rounded-md px-2.5 py-1.5 ${tones[tone]} ${className}`}>{children}</span>;
}

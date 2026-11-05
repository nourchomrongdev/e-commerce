import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" };

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-border-control bg-white text-muted hover:bg-surface-control",
  ghost: "text-muted hover:bg-surface-control hover:text-body-strong",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

export default function Button({ className = "", variant = "primary", size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`type-button inline-flex items-center justify-center gap-2 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "px-3 py-2" : "px-4 py-2.5"} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

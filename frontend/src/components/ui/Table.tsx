import type { ReactNode, TableHTMLAttributes } from "react";

export function Table({ className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto"><table className={`type-table w-full text-left ${className}`} {...props} /></div>;
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <thead className="type-table-heading bg-surface-muted text-muted">{children}</thead>;
}

export function TableRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`border-t border-divider ${className}`}>{children}</tr>;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import AppBrand from "@/components/AppBrand";
import PublicIcon from "@/components/icons/PublicIcon";
import type { PublicIconProps } from "@/components/icons/PublicIcon";
import { routes } from "@/lib/routeController";

type BuyerNavItem = { label: string; href: string; icon: PublicIconProps["name"] };
const sections: Array<{ title: string; items: BuyerNavItem[] }> = [
  { title: "Customer workspace", items: [{ label: "Overview", href: routes.buyer.dashboard(), icon: "dashboard" }] },
  { title: "My library", items: [
    { label: "My Purchases", href: routes.buyer.products(), icon: "shopping-cart" },
    { label: "My Orders", href: routes.buyer.purchases(), icon: "receipt" },
    { label: "My Downloads", href: routes.buyer.downloads(), icon: "download" },
    { label: "My Licenses", href: routes.buyer.licenses(), icon: "key" },
    { label: "Transactions", href: routes.buyer.payments(), icon: "credit-card" },
    { label: "Wishlist", href: routes.buyer.wishlist(), icon: "heart-plus" },
  ] },
  { title: "Marketplace", items: [{ label: "Browse Products", href: routes.marketplace(), icon: "product" }] },
  { title: "Account", items: [
    { label: "Settings", href: routes.buyer.account(), icon: "settings" },
    { label: "My Reviews", href: routes.buyer.reviews(), icon: "verified" },
  ] },
];

type Props = { open: boolean; collapsed: boolean; onClose: () => void; onToggle: () => void };

export default function BuyerDashboardSidebar({ open, collapsed, onClose, onToggle }: Props) {
  const pathname = usePathname();
  const [programMenuOpen, setProgramMenuOpen] = useState(false);

  return (
    <>
      <button type="button" aria-label="Close buyer navigation" onClick={onClose} className={`fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[1px] transition-opacity duration-300 min-[901px]:hidden ${open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`} />
      <button type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={`fixed top-20 z-[60] grid h-9 w-9 place-items-center rounded-br-lg border-b border-r border-[#e1e5ee] bg-white text-xl shadow-md hover:bg-accent-light max-[900px]:hidden ${collapsed ? "left-0" : "left-[228px]"}`}>
        <PublicIcon name={collapsed ? "right" : "left"} className="h-4 w-4" />
      </button>
      <aside className={`scrollbar-hidden fixed inset-y-0 left-0 z-[80] flex w-[70%] max-w-[28rem] flex-col overflow-y-auto border-r border-[#eaebf5] bg-white px-5 py-5 shadow-xl transition-[width,transform,padding] duration-300 min-[901px]:sticky min-[901px]:top-20 min-[901px]:h-[calc(100vh-5rem)] min-[901px]:translate-x-0 min-[901px]:shadow-none ${open ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "min-[901px]:w-0 min-[901px]:overflow-hidden min-[901px]:border-r-0 min-[901px]:px-0" : "min-[901px]:w-[264px]"}`}>
        <button type="button" onClick={onClose} aria-label="Close buyer navigation" className="mb-4 self-end min-[901px]:hidden"><PublicIcon name="x" className="h-4 w-4" /></button>
        <Link href="/" onClick={onClose} className="mb-5 flex items-center no-underline min-[901px]:hidden"><AppBrand className="min-w-0" textClassName="text-lg" logoClassName="h-9 w-9" /></Link>
        {programMenuOpen ? (
          <nav aria-label="Program navigation">
            <button type="button" onClick={() => setProgramMenuOpen(false)} className="mb-5 flex items-center gap-2 px-4 text-sm font-semibold text-[#1d294b] hover:text-primary"><PublicIcon name="left" className="h-4 w-4" />Back</button>
            <h2 className="mb-2 px-4 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-soft">Programs</h2>
            <div className="space-y-1">
              <Link href={routes.programs.creatorProgram()} onClick={onClose} className="flex items-center gap-4 rounded-lg px-4 py-3 text-sm text-[#1d294b] no-underline hover:bg-slate-50"><PublicIcon name="store" />Creator Program</Link>
            </div>
          </nav>
        ) : (
          <nav className="space-y-5" aria-label="Buyer dashboard navigation">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="mb-1 px-4 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-soft">{section.title}</h2>
                <div className="space-y-1">
                  {section.items.map(({ label, href, icon }) => {
                    const active = pathname === href || (href !== routes.marketplace() && pathname.startsWith(`${href}/`));
                    return (
                      <Link key={label} href={href} onClick={onClose} aria-current={active ? "page" : undefined} className={`flex items-center gap-4 rounded-lg px-4 py-3 text-sm no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active ? "bg-accent-light font-medium text-primary" : "text-[#1d294b] hover:bg-slate-50"}`}>
                        <PublicIcon name={icon} className="h-4 w-4 shrink-0" />{label}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
            <section>
              <h2 className="mb-1 px-4 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-soft">Creator Program</h2>
              <button type="button" onClick={() => setProgramMenuOpen(true)} className="flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left text-sm text-[#1d294b] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <PublicIcon name="store" className="h-4 w-4" />Become a Creator<PublicIcon name="right" className="ml-auto h-4 w-4" />
              </button>
            </section>
          </nav>
        )}
      </aside>
    </>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppBrand, { APP_NAME } from "@/components/AppBrand";
import type { MarketplaceProduct } from "@/lib/marketplace";
import UserAvatar from "@/components/UserAvatar";
import { NotificationBell } from "@/components/notifications/NotificationHub";
import PublicIcon from "@/components/icons/PublicIcon";
import { publicNavigation, routes, type PublicRouteKey } from "@/lib/routeController";
import { CART_UPDATED_EVENT, getCartCount, readCart } from "@/lib/cart";
import { clearSessionData } from "@/lib/session";
import { PROFILE_UPDATED_EVENT, type ProfileUpdatedUser } from "@/lib/profileEvents";

type NavbarProps = { active?: PublicRouteKey | null };
const links = publicNavigation;
const baseCompanyLinks = [
  { label: "About", href: routes.about() },
  { label: "Contact Us", href: routes.contact() },
];
const moreLinks = [
  { label: "Top Deals", href: routes.digitalProducts() },
  { label: "Bestsellers", href: routes.digitalProducts() },
  { label: "New Releases", href: routes.digitalProducts() },
];
const programLinks = [
  { label: "Affiliate Program", href: routes.programs.affiliateProgram() },
  { label: "Reviewer Program", href: routes.programs.reviewerProgram() },
  { label: "Creator Program", href: routes.programs.creatorProgram() },
];
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "Unknown";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(4, name.length - 2))}@${domain}`;
}

export default function Navbar({ active = "home" }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSearchPath, setMobileSearchPath] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"company" | "more" | "programs" | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [creatorApproved, setCreatorApproved] = useState(false);
  const [username, setUsername] = useState("Unknown");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cartCount, setCartCount] = useState(0);
  const [searchSuggestions, setSearchSuggestions] = useState<{
    term: string;
    items: MarketplaceProduct[];
    error?: string;
  } | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [desktopMenu, setDesktopMenu] = useState<
    "company" | "more" | "programs" | null
  >(null);
  const [policyLinks, setPolicyLinks] = useState<Array<{ label: string; href: string }>>([]);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const companyLinks = [
    ...baseCompanyLinks,
    ...policyLinks,
  ];
  const roleLabel = userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : "User";
  const normalizedRoles = new Set([userRole.toLowerCase(), ...userRoles.map((role) => role.toLowerCase())]);
  const workspaceLinks = [
    { label: "Customer Workspace", href: routes.buyer.dashboard(), icon: "user-round" as const, active: pathname.startsWith("/buyer"), authorized: signedIn },
    { label: "Creator Studio", href: routes.creator.overview(), icon: "store" as const, active: pathname.startsWith("/creator"), authorized: normalizedRoles.has("creator") && creatorApproved },
    { label: "Affiliate Studio", href: routes.affiliate.dashboard(), icon: "dashboard" as const, active: pathname.startsWith("/affiliate"), authorized: normalizedRoles.has("affiliate") },
    { label: "Reviewer Workspace", href: routes.reviewer.dashboard(), icon: "product" as const, active: pathname.startsWith("/reviewer"), authorized: normalizedRoles.has("reviewer") || normalizedRoles.has("content reviewer") },
  ].filter((workspace) => workspace.authorized);
  const isProgramPage = pathname.startsWith("/program/");
  const isCompanyPage = companyLinks.some((link) => pathname === link.href);
  const mobileInput = useRef<HTMLInputElement>(null);
  const searchTerm = search.trim();
  const currentSuggestions =
    searchSuggestions?.term === searchTerm ? searchSuggestions : null;
  const results = currentSuggestions?.items ?? [];
  const showSuggestions = focused && Boolean(searchTerm);
  const showMobileSearch = mobileSearchOpen && mobileSearchPath === pathname;
  const toggleMobileMenu = (menu: "company" | "more" | "programs") => {
    setMobilePanel((current) => (current === menu ? null : menu));
  };
  const goToResults = (searchValue = search) => {
    setFocused(Boolean(searchValue.trim()));
    setMobileSearchOpen(false);
    const query = searchValue.trim();
    router.push(query ? `/marketplace?search=${encodeURIComponent(query)}` : routes.digitalProducts());
  };
  useEffect(() => {
    if (showMobileSearch) mobileInput.current?.focus();
  }, [showMobileSearch]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);
  useEffect(() => {
    if (searchTerm.length < 2) return;
    const controller = new AbortController();
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
    const timeout = window.setTimeout(() => {
      fetch(
        `${apiUrl.replace(/\/$/, "")}/marketplace?search=${encodeURIComponent(searchTerm)}&page=1&pageSize=5&sort=popular&suggestions=true`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              `Marketplace search request failed (${response.status}).`,
            );
          }
          return (await response.json()) as {
            products?: MarketplaceProduct[];
          };
        })
        .then((payload) => {
          setSearchSuggestions({ term: searchTerm, items: payload.products ?? [] });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error("Unable to load marketplace search suggestions:", error);
          setSearchSuggestions({
            term: searchTerm,
            items: [],
            error: "Search suggestions could not be loaded.",
          });
        });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchAttempt, searchTerm]);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
    let active = true;
    const loadPolicyLinks = async () => {
      try {
        const response = await fetch(`${base}/policies/public-list`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Public policy list request failed (${response.status}).`);
        const payload = await response.json();
        const policies = Array.isArray(payload?.policies) ? payload.policies : [];
        const links = policies.flatMap((policy: { title?: string; key?: string; slug?: string; href?: string }) => {
          const slug = policy.slug || policy.key;
          return slug ? [{ label: policy.title || slug, href: policy.href || `/legal/${encodeURIComponent(slug)}` }] : [];
        });
        const uniqueLinks: Array<{ label: string; href: string }> = Array.from(
          new Map<string, { label: string; href: string }>(
            links.map((link: { label: string; href: string }) => [
              link.label.toLowerCase(),
              link,
            ] as [string, { label: string; href: string }]),
          ).values(),
        );
        if (active) setPolicyLinks(uniqueLinks);
      } catch (error) {
        console.error("Unable to load public policy links:", error);
        if (active) setPolicyLinks([]);
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadPolicyLinks();
    };
    void loadPolicyLinks();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [pathname]);
  useEffect(() => {
    const updateCartCount = () => setCartCount(getCartCount(readCart()));
    updateCartCount();
    window.addEventListener(CART_UPDATED_EVENT, updateCartCount);
    return () => window.removeEventListener(CART_UPDATED_EVENT, updateCartCount);
  }, []);
  useEffect(() => {
    const close = () => {
      setFocused(false);
      setDesktopMenu(null);
      setAccountOpen(false);
      setMobileSearchOpen(false);
      setMobilePanel(null);
    };
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, []);
  useEffect(() => {
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) {
      const timer = window.setTimeout(() => setAuthChecked(true), 0);
      return () => window.clearTimeout(timer);
    }
    const apiUrl = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ?? "http://localhost:5000/api";

    fetch(`${apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error("Session expired");
      const data = await response.json();
      setSignedIn(true);
      setUserRole(data.user.role || "");
      setUserRoles(Array.isArray(data.user.roles) ? data.user.roles : []);
      setCreatorApproved(data.user.creatorAccountApprovalStatus === "approved");
      setUsername(data.user.username || "Unknown");
      setFullName(data.user.name || "");
      setEmail(data.user.email || "");
      setAvatarUrl(data.user.avatarUrl || "");
    }).catch(() => {
      window.localStorage.removeItem("marketplace-token");
      setSignedIn(false);
      setUserRole("");
      setUserRoles([]);
      setCreatorApproved(false);
      setUsername("Unknown");
      setFullName("");
      setEmail("");
      setAvatarUrl("");
    }).finally(() => {
      setAuthChecked(true);
    });
  }, []);
  useEffect(() => {
    const updateProfile = (event: Event) => {
      const user = (event as CustomEvent<ProfileUpdatedUser>).detail;
      if (!user) return;
      setFullName(user.fullName || user.name || "");
      if (user.username) setUsername(user.username);
      setAvatarUrl(user.avatarUrl || "");
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, updateProfile);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, updateProfile);
  }, []);
  const signOut = async () => {
    await clearSessionData();
    setSignedIn(false);
    setUserRole("");
    setUserRoles([]);
    setCreatorApproved(false);
    setUsername("Unknown");
    setFullName("");
    setEmail("");
    setAvatarUrl("");
    setAccountOpen(false);
    window.location.replace(routes.auth.login());
  };
  const searchField = (mobile = false) => (
    <div
      className={`relative ${mobile ? "flex-1" : "hidden min-[1200px]:block"}`}
    >
      <div
        className={`flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-slate-400 shadow-sm ${focused ? "border-primary" : "border-slate-200"} ${mobile ? "w-full" : "w-52 2xl:w-64"}`}
      >
        <PublicIcon name="search" className="h-4 w-4 text-slate-400" />
        <input
          ref={mobile ? mobileInput : undefined}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(event) => {
            if (event.key === "Enter") goToResults();
            if (event.key === "Escape") {
              setFocused(false);
              event.currentTarget.blur();
            }
          }}
          className="w-full bg-transparent text-xs outline-none placeholder:text-slate-400"
          placeholder={
            active === "products"
              ? "Search digital products..."
              : "Search marketplace..."
          }
        />
        {search && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setSearch("")}
            className="text-sm text-slate-400"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => goToResults()}
          className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-semibold text-white"
        >
          Search
        </button>
      </div>
      <div
        className={`absolute left-0 top-[calc(100%+8px)] z-50 w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-[0_12px_30px_rgba(15,23,42,.12)] transition ${showSuggestions ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"}`}
      >
        <div className="space-y-1">
          {results.length ? (
            results.map((item) => (
              <button
                key={item.name}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSearch(item.name);
                  setFocused(false);
                  router.push(
                    `/marketplace/${encodeURIComponent(item.storeSlug)}/${encodeURIComponent(item.slug)}`,
                  );
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-accent-light"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-amber-600 text-[9px] font-bold text-white">
                  {item.categoryName.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs text-slate-900">
                    {item.name}
                  </strong>
                  <small className="block truncate text-[10px] text-slate-500">
                    {item.categoryName} · {item.storeName}
                  </small>
                </span>
              </button>
            ))
          ) : currentSuggestions?.error ? (
            <div className="flex items-center justify-between gap-3 px-2 py-3 text-[10px] text-status-danger">
              <span>{currentSuggestions.error}</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setSearchAttempt((attempt) => attempt + 1)}
                className="font-semibold underline"
              >
                Retry
              </button>
            </div>
          ) : searchTerm.length < 2 ? (
            <p className="px-2 py-3 text-center text-[10px] text-slate-500">
              Enter at least 2 characters to search.
            </p>
          ) : !currentSuggestions ? (
            <p className="px-2 py-3 text-center text-[10px] text-slate-500">
              Searching products...
            </p>
          ) : (
            <p className="px-2 py-3 text-center text-[10px] text-slate-500">
              No results for “{search}”
            </p>
          )}
        </div>
      </div>
    </div>
  );
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="flex h-14 w-full items-center gap-3 px-4 sm:px-6 md:px-[7%] xl:gap-5">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => {
              setOpen(true);
              if (isProgramPage) setMobilePanel("programs");
            }}
            className="grid h-9 w-9 place-items-center rounded-lg text-xl text-slate-700 hover:bg-accent-light min-[1200px]:hidden"
          >
            <PublicIcon name="menu" className="h-5 w-5" />
          </button>
          <Link
            href={routes.home()}
            className="hidden items-center min-[1200px]:flex"
          >
            <AppBrand
              name={APP_NAME}
              className="text-sm"
              textClassName="text-sm"
              logoClassName="h-9 w-9 p-1"
            />
          </Link>
          <nav className="ml-auto hidden items-center gap-3 min-[1200px]:flex 2xl:gap-7">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={`relative py-1 text-[11px] font-medium no-underline after:absolute after:bottom-0 after:left-0 after:h-0.5 after:bg-primary after:transition-all ${link.page === active ? "text-primary after:w-full" : "text-slate-700 after:w-0 hover:text-primary hover:after:w-full"}`}
              >
                {link.label}
              </Link>
            ))}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setDesktopMenu(desktopMenu === "company" ? null : "company")
                }
                className={`flex items-center py-1 text-[11px] font-medium hover:text-primary ${isCompanyPage || desktopMenu === "company" ? "text-primary" : "text-slate-700"}`}
              >
                Company <PublicIcon name="down" className={`ml-1 text-slate-400 transition-transform ${desktopMenu === "company" ? "rotate-180" : ""}`} />
              </button>
              {desktopMenu === "company" && (
                <div className="menu-popover-enter absolute left-0 top-8 w-40 rounded-xl border border-slate-100 bg-white p-2 shadow-xl">
                  {companyLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setDesktopMenu(null)}
                      className={`block rounded-lg px-3 py-2 text-[11px] no-underline hover:bg-accent-light hover:text-primary ${pathname === link.href ? "bg-accent-light font-semibold text-primary" : "text-slate-600"}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setDesktopMenu(desktopMenu === "more" ? null : "more")
                }
                className="flex items-center py-1 text-[11px] font-medium text-slate-700 hover:text-primary"
              >
                More <PublicIcon name="down" className={`ml-1 text-slate-400 transition-transform ${desktopMenu === "more" ? "rotate-180" : ""}`} />
              </button>
              {desktopMenu === "more" && (
                <div className="menu-popover-enter absolute left-0 top-8 w-40 rounded-xl border border-slate-100 bg-white p-2 shadow-xl">
                  {moreLinks.map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      onClick={() => setDesktopMenu(null)}
                      className="block rounded-lg px-3 py-2 text-[11px] text-slate-600 no-underline hover:bg-accent-light hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setDesktopMenu(
                    desktopMenu === "programs" ? null : "programs",
                  )
                }
                className={`flex items-center py-1 text-[11px] font-medium hover:text-primary ${isProgramPage || desktopMenu === "programs" ? "text-primary" : "text-slate-700"}`}
              >
                Programs <PublicIcon name="down" className={`ml-1 text-slate-400 transition-transform ${desktopMenu === "programs" ? "rotate-180" : ""}`} />
              </button>
              {desktopMenu === "programs" && (
                <div className="menu-popover-enter absolute left-0 top-8 w-44 rounded-xl border border-slate-100 bg-white p-2 shadow-xl">
                  {programLinks.map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      onClick={() => setDesktopMenu(null)}
                      className={`block rounded-lg px-3 py-2 text-[11px] no-underline hover:bg-accent-light hover:text-primary ${pathname === link.href || pathname.startsWith(`${link.href}/`) ? "font-semibold text-primary" : "text-slate-600"}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>
          {searchField()}
          <div className="ml-auto flex items-center gap-1 min-[1200px]:ml-3">
            {active === "products" && (
              <div id="marketplace-search-toggle-slot" className="min-[1200px]:hidden" />
            )}
            {pathname !== routes.digitalProducts() && (
              <button
                type="button"
                aria-label="Open search"
                onClick={() => {
                  setMobileSearchPath(pathname);
                  setMobileSearchOpen(true);
                }}
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-700 hover:bg-accent-light min-[1200px]:hidden"
              >
                <PublicIcon name="search" className="h-4 w-4 text-slate-400" />
              </button>
            )}
            <Link
              href="/cart"
              aria-label="Cart"
              className="relative grid h-8 w-8 place-items-center text-base text-slate-700"
            >
              <PublicIcon
                name="shopping-cart"
                className="h-4 w-4 text-slate-700"
              />
              <span className="absolute right-0 top-0 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-[7px] text-white">
                {cartCount}
              </span>
            </Link>
            {authChecked && signedIn && <NotificationBell className="shrink-0" />}
            {!authChecked ? (
              <span className="h-10 w-20 shrink-0" aria-hidden="true" />
            ) : signedIn ? (
              <div ref={accountRef} className="relative">
                <button
                  ref={accountButtonRef}
                  type="button"
                  onClick={() => setAccountOpen((isOpen) => !isOpen)}
                  aria-expanded={accountOpen}
                  aria-controls="global-account-menu"
                  aria-label="Open account menu"
                  className="flex items-center gap-2 rounded-lg p-1 text-left hover:bg-accent-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <UserAvatar url={avatarUrl} name={fullName || username} className="h-8 w-8 text-xs" />
                  <span className="hidden min-[1200px]:block">
                    <span className="block max-w-28 truncate whitespace-nowrap text-[11px] font-semibold text-heading">
                      {username.replace(/_\d{6}$/, "").replace(/_/g, " ")}
                    </span>
                    <span className="block text-[9px] text-muted">{roleLabel}</span>
                  </span>
                  <PublicIcon name="down" className={`h-3.5 w-3.5 text-muted transition-transform ${accountOpen ? "rotate-180" : ""}`} />
                </button>
                {accountOpen && (
                  <div id="global-account-menu" className="menu-popover-enter absolute right-0 top-full z-50 mt-2 max-h-[min(80vh,36rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-slate-100 bg-white py-2 shadow-xl">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar url={avatarUrl} name={fullName || username} className="h-10 w-10 text-sm" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-heading">{fullName || username}</p>
                          <p className="mt-1 truncate text-[10px] text-muted">{email ? maskEmail(email) : "Unknown"}</p>
                          <p className="mt-1 text-[10px] text-muted">Active role: {roleLabel}</p>
                        </div>
                      </div>
                    </div>
                    <p className="px-4 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-soft">
                      Workspaces
                    </p>
                    <Link
                      href="/profile"
                      onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs text-body no-underline hover:bg-accent-light hover:text-primary"
                    >
                      <PublicIcon name="user-round" className="h-4 w-4 text-primary" />
                      My Profile
                    </Link>
                    {workspaceLinks.map((workspace) => (
                      <Link
                        key={workspace.label}
                        href={workspace.href}
                        onClick={() => setAccountOpen(false)}
                        aria-current={workspace.active ? "page" : undefined}
                        className={`flex items-center gap-3 px-4 py-2.5 text-xs no-underline transition hover:bg-accent-light hover:text-primary focus-visible:outline-2 focus-visible:outline-primary ${workspace.active ? "bg-orange-50 font-semibold text-primary" : "text-body"}`}
                      >
                        <PublicIcon name={workspace.icon} className="h-4 w-4 text-primary" />
                        {workspace.label}
                        {workspace.active && <span className="ml-auto text-[9px]">Current</span>}
                      </Link>
                    ))}
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={signOut}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs text-status-danger hover:bg-status-danger-surface"
                    >
                      <PublicIcon name="arrow-left" className="h-4 w-4" />
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href={routes.auth.login()}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-orange-300/60 bg-gradient-to-r from-primary to-[#ff9848] px-2.5 py-1.5 text-[10px] font-semibold text-white no-underline shadow-[0_3px_8px_rgba(255,103,0,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_5px_12px_rgba(255,103,0,0.34)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <PublicIcon name="user-round" className="h-2.5 w-2.5" />
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="h-14" />
      {showMobileSearch && (
        <div className="fixed inset-x-0 top-0 z-[60] flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 min-[1200px]:hidden">
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              setMobileSearchOpen(false);
              setFocused(false);
            }}
            className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate-700"
          >
            ‹
          </button>
          {searchField(true)}
        </div>
      )}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[120] bg-slate-950/45"
        />
      )}
      <aside
        className={`fixed bottom-0 left-0 top-0 z-[130] flex h-dvh max-h-dvh w-[min(88vw,24rem)] flex-col overflow-hidden overscroll-contain bg-[#fafaff] p-5 pb-10 shadow-2xl transition-transform duration-300 sm:w-[22rem] md:w-[24rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-y] ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <Link
            href={routes.home()}
            onClick={() => setOpen(false)}
            className="flex items-center no-underline"
          >
            <AppBrand
              name={APP_NAME}
              className="text-base"
              textClassName="text-base"
              logoClassName="h-9 w-9 p-1"
            />
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-xl text-slate-600"
          >
            ×
          </button>
        </div>
        <p className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Navigation
        </p>
        <div className="flex flex-col gap-1">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`rounded-xl px-3 py-3 text-[16px] font-medium no-underline transition ${link.page === active ? "bg-[#f5e5d8] text-[#1e2a4a] shadow-sm" : "text-[#2f3b59] hover:bg-[#f4f6fb] hover:text-primary"}`}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => toggleMobileMenu("company")}
            className="flex items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] font-medium text-[#2f3b59] hover:bg-accent-light hover:text-primary"
          >
            Company <PublicIcon name="right" className="h-4 w-4 text-slate-400" />
          </button>
          <button
            type="button"
            onClick={() => toggleMobileMenu("more")}
            className="flex items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] font-medium text-[#2f3b59] hover:bg-accent-light hover:text-primary"
          >
            More <PublicIcon name="right" className="h-4 w-4 text-slate-400" />
          </button>
          <button
            type="button"
            onClick={() => toggleMobileMenu("programs")}
            className={`flex items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] font-medium hover:bg-[#f4f6fb] hover:text-primary ${active === "programs" || isProgramPage || mobilePanel === "programs" ? "text-primary" : "text-[#2f3b59]"}`}
          >
            Programs <PublicIcon name="right" className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      <aside
        className={`absolute bottom-0 left-0 right-0 top-[5.75rem] z-10 flex flex-col overflow-y-auto bg-[#fafaff] px-5 pb-10 pt-0 transition-transform duration-300 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-y] ${mobilePanel ? "translate-x-0" : "-translate-x-full"}`}
        aria-hidden={!mobilePanel}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 py-2">
          <button
            type="button"
            aria-label="Back to navigation"
            onClick={() => setMobilePanel(null)}
            className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-xl text-slate-600"
          >
            ‹
          </button>
          <p className="text-base font-semibold text-[#1e2a4a]">
            {mobilePanel === "company" ? "Company" : mobilePanel === "more" ? "More" : "Programs"}
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-1">
          {mobilePanel === "company" && companyLinks.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={`rounded-xl px-3 py-3 text-[16px] no-underline hover:bg-[#f4f6fb] hover:text-primary ${pathname === link.href ? "bg-accent-light font-semibold text-primary" : "text-[#2f3b59]"}`}>{link.label}</Link>)}
          {mobilePanel === "more" && moreLinks.map((link) => <Link key={link.label} href={link.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-[16px] text-[#2f3b59] no-underline hover:bg-[#f4f6fb] hover:text-primary">{link.label}</Link>)}
          {mobilePanel === "programs" && programLinks.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return <Link key={link.label} href={link.href} onClick={() => setOpen(false)} className={`rounded-xl px-3 py-3 text-[16px] no-underline hover:bg-[#f4f6fb] hover:text-primary ${isActive ? "font-semibold text-primary" : "text-[#2f3b59]"}`}>{link.label}</Link>;
          })}
        </div>
      </aside>
      </aside>
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, Button } from "@/components/ui";
import { routes } from "@/lib/routeController";

const benefits = [
  { title: "Launch your storefront", description: "Open a branded storefront and sell digital products fast.", icon: "store", tone: "bg-orange-50 text-primary" },
  { title: "Earn more", description: "Receive payouts and track sales across your product catalog.", icon: "dollar", tone: "bg-orange-50 text-primary" },
  { title: "Build trust", description: "Use verification badges and creator tools to increase conversion.", icon: "verified", tone: "bg-orange-50 text-primary" },
  { title: "Manage everything", description: "Track licenses, orders, reviews, marketing and product files together.", icon: "settings", tone: "bg-orange-50 text-primary" },
];

const steps = [
  ["Apply", "Tell us a bit about your store and products."],
  ["Review", "Our team checks your creator profile and business details."],
  ["Approval", "Get approved and unlock the creator dashboard."],
  ["Launch", "Start selling and manage your digital products."],
];

export default function BecomeCreatorPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [status, setStatus] = useState("not_applied");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const token = window.localStorage.getItem("marketplace-token");
    const redirectToLogin = () => {
      const next = encodeURIComponent(routes.buyer.creatorProgram());
      router.replace(`${routes.auth.login()}?next=${next}`);
    };

    if (!token) {
      redirectToLogin();
      return () => { active = false; };
    }

    const apiUrl = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ?? "http://localhost:5000/api";
    const loadStatus = async () => {
      try {
        const accountResponse = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (accountResponse.status === 401 || accountResponse.status === 403) {
          window.localStorage.removeItem("marketplace-token");
          redirectToLogin();
          return;
        }
        const accountData = await accountResponse.json();
        if (!accountResponse.ok) throw new Error(accountData.error || "Unable to load account details.");
        const applicationResponse = await fetch(`${apiUrl}/creator-program/application`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const applicationData = await applicationResponse.json();
        if (!applicationResponse.ok) throw new Error(applicationData.error || "Unable to load creator application status.");
        if (!active) return;
        const approvalStatus = String(accountData.user?.creatorAccountApprovalStatus || "");
        setStatus(["approved", "suspended"].includes(approvalStatus) ? approvalStatus : String(applicationData.application?.status || "not_applied"));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load creator application status.");
      } finally {
        if (active) setCheckingAuth(false);
      }
    };
    void loadStatus();
    return () => { active = false; };
  }, [router]);

  const needsReview = ["pending", "approved", "suspended"].includes(status);
  const approved = status === "approved";
  const rejected = status === "rejected";
  const statusLabel = checkingAuth ? "Loading" : needsReview ? status === "pending" ? "Under review" : status === "approved" ? "Approved" : "Suspended" : rejected ? "Changes requested" : "Open application";
  const statusTone = status === "approved" ? "success" : status === "pending" ? "warning" : status === "rejected" || status === "suspended" ? "danger" : "neutral";

  if (checkingAuth) {
    return (
      <div className="mx-auto w-full max-w-[1120px] py-10 text-center text-sm text-muted">
        Checking your account access...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-light text-primary">
            <PublicIcon name="store" className="h-7 w-7" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Creator Program</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Become a Creator</h1>
            <p className="mt-1 text-sm text-muted">Turn your buyer account into a selling storefront and grow your digital business.</p>
          </div>
        </div>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </header>

      {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border-control bg-accent-light text-primary shadow-sm">
              <PublicIcon name="store" className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-base font-bold text-ink">Start selling your digital products</h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
                Build your storefront, upload products, manage licenses, and keep your customers happy with a polished creator experience.
              </p>
              <Link href={needsReview ? routes.programs.creatorProgramReview() : routes.programs.creatorProgramApply()} className="mt-4 inline-block no-underline">
                <Button size="sm" disabled={checkingAuth || Boolean(error)}>{needsReview ? "View application status" : rejected ? "Submit a new application" : "Apply for Creator Access"}</Button>
              </Link>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-soft">Application status</p>
          <div className="mt-4 flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-full ${status === "approved" ? "bg-emerald-50 text-emerald-600" : status === "pending" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
          <PublicIcon name={status === "approved" ? "verified" : status === "pending" ? "clock-9" : "store"} className="h-5 w-5" />
            </span>
            <div>
          <p className="text-sm font-semibold text-ink">{statusLabel}</p>
          <p className="mt-0.5 text-[10px] text-muted-soft">{status === "pending" ? "We will review your request shortly." : status === "approved" ? "Creator tools are enabled." : status === "suspended" ? "Contact support if you need more information." : rejected ? "Review feedback before submitting again." : "Create your creator account in minutes."}</p>
            </div>
          </div>
          {approved && <Link href={routes.creator.overview()} className="mt-5 inline-flex items-center text-[10px] font-semibold text-primary no-underline">Go to creator dashboard →</Link>}
        </article>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-bold text-ink">Creator benefits</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="rounded-xl border border-divider bg-surface-control p-4">
              <span className={`grid h-8 w-8 place-items-center rounded-lg ${benefit.tone}`}>
                <PublicIcon name={benefit.icon as any} className="h-4 w-4" />
              </span>
              <h3 className="mt-3 text-xs font-semibold text-body">{benefit.title}</h3>
              <p className="mt-1 text-[10px] text-muted-soft">{benefit.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-bold text-ink">How it works</h2>
        <div className="mt-5 space-y-4">
          {steps.map(([title, description], index) => (
            <div key={title} className="flex items-start gap-3">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${index === 0 ? "bg-primary text-white" : "bg-divider text-muted"}`}>
                {index + 1}
              </span>
              <div>
                <h3 className="text-xs font-semibold text-body">{title}</h3>
                <p className="mt-0.5 text-[10px] text-muted-soft">{description}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-accent-light px-3 py-2.5 text-[10px] text-primary">
          <PublicIcon name="notification" className="h-3.5 w-3.5 shrink-0" />
          Most creator applications are reviewed within 1-3 business days.
        </div>
      </section>

    </div>
  );
}

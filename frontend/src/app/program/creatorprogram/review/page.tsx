"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import PublicIcon from "@/components/icons/PublicIcon";
import { routes } from "@/lib/routeController";

type CreatorApplication = {
  id: number;
  storeName: string;
  status: "pending" | "approved" | "rejected" | "suspended" | "withdrawn";
  reviewReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
} | null;
type ApplicationStatus = NonNullable<CreatorApplication>["status"];

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function applicationLabel(status: ApplicationStatus) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "suspended") return "Suspended";
  if (status === "withdrawn") return "Withdrawn";
  return "Pending review";
}

export default function CreatorProgramReviewPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [application, setApplication] = useState<CreatorApplication>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) {
      router.replace(`${routes.auth.login()}?next=${encodeURIComponent(routes.programs.creatorProgramReview())}`);
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const [userResponse, applicationResponse] = await Promise.all([
          fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }),
          fetch(`${apiUrl}/creator-program/application`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }),
        ]);
        const [userData, applicationData] = await Promise.all([userResponse.json(), applicationResponse.json()]);
        if (!userResponse.ok) throw new Error(userData.error || "Unable to load account details.");
        if (!applicationResponse.ok) throw new Error(applicationData.error || "Unable to load application status.");
        setEmail(String(userData.user?.email || ""));
        setApplication(applicationData.application || null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load application status.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [router]);

  const status = application?.status || "not_applied";
  const approved = status === "approved";
  const rejected = status === "rejected";
  const suspended = status === "suspended";
  const accent = approved ? "green" : rejected || suspended ? "red" : "amber";
  const tones = {
    green: "border-[#cfe9dc] bg-[#dff7eb] text-[#1a7d5d]",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-[#f3e2c9] bg-[#fff4e6] text-[#b46e1d]",
  };
  const maskedEmail = email ? email.replace(/(^.).*(@.*$)/, "$1******$2") : "Email unavailable";

  return (
    <main className="flex min-h-screen flex-col bg-[var(--creator-page-bg)] text-slate-800">
      <Navbar active="programs" />
      <div className="mx-auto w-full max-w-[1100px] flex-1 px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1100px] pt-2">
          <div className="mb-6 max-w-[620px]">
            <Link href={routes.programs.creatorProgram()} className="inline-flex items-center gap-2 text-sm font-semibold text-primary no-underline hover:underline">
              <span aria-hidden="true" className="text-base text-primary">←</span>
              <span>Creator Program</span>
            </Link>
            <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Application status</p>
            <h1 className="mt-3 text-[42px] font-extrabold leading-[1.02] tracking-[-2px] text-[var(--creator-page-heading)] sm:text-[54px]">Check your application</h1>
            <p className="mt-4 text-[18px] leading-8 text-[var(--creator-page-text-soft)]">
              Creator account approval is separate from identity verification.
            </p>
          </div>

          {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {loading ? (
            <div className="rounded-lg border border-[#dfe7ea] bg-white p-8 text-sm text-slate-500">Loading application status...</div>
          ) : (
            <section className="overflow-hidden rounded-[8px] border border-[#dfe7ea] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.035)]">
              <div className={`border-b p-6 sm:p-7 ${tones[accent]}`}>
                <div className="flex items-start gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/70 shadow-inner ring-1 ring-current/15">
                    <PublicIcon name={approved ? "verification" : "clock-9"} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[28px] font-extrabold tracking-[-1px] text-[#0f172a]">
                      {application ? applicationLabel(application.status) : "No application submitted"}
                    </h2>
                    <p className="mt-2 text-[15px] leading-6 text-slate-600">
                      {approved ? "Your creator account is approved and creator tools are enabled." :
                        rejected ? "Your application was rejected. Review the feedback before applying again." :
                          suspended ? "Creator access is currently suspended. Contact support if you need more information." :
                            application ? "Your application is being reviewed by the marketplace team." :
                              "Submit an application to request creator account access."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 bg-white/50 p-5 sm:p-6 md:grid-cols-3">
                <div className="flex min-h-[120px] items-center gap-3 rounded-[6px] border border-[#dfe7ea] bg-slate-50 p-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-primary shadow-sm ring-1 ring-[#e2e8f0]">
                    <PublicIcon name="clock-9" className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Status</p>
                    <p className="mt-2 text-[15px] font-semibold text-slate-900">{application ? applicationLabel(application.status) : "Not submitted"}</p>
                    <p className="text-[11px] text-slate-600">{application?.submittedAt ? new Date(application.submittedAt).toLocaleDateString() : "Apply when ready"}</p>
                  </div>
                </div>
                <div className="flex min-h-[120px] items-center gap-3 rounded-[6px] border border-[#dfe7ea] bg-slate-50 p-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-primary shadow-sm ring-1 ring-[#e2e8f0]">
                    <PublicIcon name="store" className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Store</p>
                    <p className="mt-2 text-[15px] font-semibold text-slate-900">{application?.storeName || "—"}</p>
                    <p className="text-[11px] text-slate-600">{approved ? "Creator access enabled" : "Access after approval"}</p>
                  </div>
                </div>
                <div className="flex min-h-[120px] items-center gap-3 rounded-[6px] border border-[#dfe7ea] bg-slate-50 p-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[#2f82d0] shadow-sm ring-1 ring-[#d4e8fb]">
                    <PublicIcon name="mail" className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2f82d0]">Account email</p>
                    <p className="mt-2 text-[15px] font-semibold text-slate-900">{maskedEmail}</p>
                    <p className="text-[11px] text-slate-600">Application updates</p>
                  </div>
                </div>
              </div>

              {application?.reviewReason && (
                <div className="border-t border-divider px-5 py-4 sm:px-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Reviewer feedback</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{application.reviewReason}</p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 border-t border-[#dfe7ea] px-5 py-4 sm:px-6">
                {(!application || rejected) && <Link href={routes.programs.creatorProgramApply()} className="rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-white no-underline hover:bg-primary-hover">{rejected ? "Submit a new application" : "Apply to become a creator"}</Link>}
                {approved && <Link href={routes.creator.overview()} className="rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-white no-underline hover:bg-primary-hover">Go to Creator Studio</Link>}
              </div>
            </section>
          )}
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}

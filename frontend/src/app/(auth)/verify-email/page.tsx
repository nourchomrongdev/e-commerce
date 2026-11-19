"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppBrand from "@/components/AppBrand";
import { routes } from "@/lib/routeController";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [hasSentCode, setHasSentCode] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const loadAccount = async () => {
      try {
        const token = window.localStorage.getItem("marketplace-token") || "";
        if (!token) throw new Error("Sign in to verify your email address.");
        const response = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load your account.");
        setEmail(data.user?.email || "");
        setVerified(Boolean(data.user?.emailVerified));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load your account.");
      } finally {
        setLoading(false);
      }
    };
    void loadAccount();
  }, []);

  const sendCode = async () => {
    setSending(true);
    setError("");
    setMessage("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/auth/email-verification/request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send a verification code.");
      setEmail(data.maskedEmail || email);
      setHasSentCode(true);
      setMessage(data.message || "A verification code has been sent to your email address.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send a verification code.");
    } finally {
      setSending(false);
    }
  };

  const updateCode = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setCode((current) => current.map((item, itemIndex) => itemIndex === index ? digit : item));
    if (digit && index < 5) document.getElementById(`verification-digit-${index + 1}`)?.focus();
  };

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVerifying(true);
    setError("");
    setMessage("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/auth/email-verification/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: code.join("") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to verify your email address.");
      setVerified(true);
      setMessage(data.message || "Your email address has been verified.");
      window.setTimeout(() => router.push("/profile"), 900);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Unable to verify your email address.");
    } finally {
      setVerifying(false);
    }
  };

  return <main className="grid min-h-screen place-items-center bg-[#f8f8ff] px-4 py-8"><section className="w-full max-w-[430px] rounded-xl border border-border bg-white p-7 shadow-[0_14px_40px_rgba(17,27,64,0.07)] sm:p-10"><AppBrand logoClassName="h-8 w-8" textClassName="text-xs" /><div className="mt-12 text-center"><h1 className="text-xl font-bold text-heading">{verified ? "Email verified" : "Verify your email"}</h1><p className="mt-2 text-xs leading-5 text-muted">{verified ? "Your email address is verified." : loading ? "Loading your account…" : <>We&apos;ll send a 6-digit code to<br /><strong className="text-body">{email || "your account email"}</strong></>}</p>
    {!loading && !verified && <button type="button" disabled={sending || !email} onClick={() => void sendCode()} className="mt-6 h-10 w-full rounded-lg border border-primary text-xs font-semibold text-primary hover:bg-orange-50 disabled:opacity-50">{sending ? "Sending…" : hasSentCode ? "Resend verification code" : "Send verification code"}</button>}
    {hasSentCode && !verified && <form onSubmit={verifyCode}><div className="mt-5 grid grid-cols-6 gap-2">{code.map((value, index) => <input id={`verification-digit-${index}`} key={index} value={value} onChange={(event) => updateCode(index, event.target.value)} inputMode="numeric" pattern="[0-9]" maxLength={1} aria-label={`Verification digit ${index + 1}`} className="h-11 min-w-0 rounded-lg border border-border-control text-center text-sm font-semibold text-heading outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />)}</div><button type="submit" disabled={verifying || code.some((digit) => !digit)} className="mt-6 h-10 w-full rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50">{verifying ? "Verifying…" : "Verify code"}</button></form>}
    {error && <p role="alert" className="mt-4 text-left text-xs text-status-danger">{error}</p>}{message && <p role="status" className="mt-4 text-left text-xs text-status-success">{message}</p>}
    <Link href={verified ? "/profile" : routes.auth.login()} className="mt-6 inline-block text-[10px] font-semibold text-primary no-underline">{verified ? "Return to profile" : "Back to sign in"}</Link></div></section></main>;
}

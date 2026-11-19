"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import { displayName, ProfileAvatar, type ProfileUser } from "@/components/ProfilePage";
import { notifyProfileUpdated } from "@/lib/profileEvents";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function cropAvatarImage(imageSrc: string, area: Area) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Your browser could not prepare the cropped photo."));
        return;
      }
      context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 512, 512);
      resolve(canvas.toDataURL("image/webp", 0.9));
    };
    image.onerror = () => reject(new Error("Unable to load the selected photo."));
    image.src = imageSrc;
  });
}

export default function ProfileEditPage() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [cropSrc, setCropSrc] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [applyingCrop, setApplyingCrop] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryCodeSent, setRecoveryCodeSent] = useState(false);
  const [recoveryEmailBusy, setRecoveryEmailBusy] = useState(false);
  const [recoveryEmailError, setRecoveryEmailError] = useState("");
  const [recoveryEmailMessage, setRecoveryEmailMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadProfile = async () => {
      const token = window.localStorage.getItem("marketplace-token");
      if (!token) {
        setError("Sign in to edit your profile.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`${apiUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "We could not load your profile.");
        const profile: ProfileUser = data.user ?? data;
        if (controller.signal.aborted) return;
        setUser(profile);
        setName(profile.fullName || profile.name || "");
        setUsername(profile.username || "");
        setPhone(profile.phone || "");
        setAvatarUrl(profile.avatarUrl || "");
        setBio(profile.bio || "");
        setLocation(profile.location || "");
        setRecoveryEmail(profile.recoveryEmailPending || profile.recoveryEmail || "");
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "We could not load your profile.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadProfile();
    return () => controller.abort();
  }, []);

  const changePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setSaveError("Choose a PNG, JPG, or WEBP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSaveError("Profile photo must be no larger than 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCropSrc(reader.result);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedArea(null);
        setSaveError("");
      } else {
        setSaveError("Unable to read the selected photo.");
      }
    };
    reader.onerror = () => setSaveError("Unable to read the selected photo.");
    reader.readAsDataURL(file);
  };

  const applyCrop = async () => {
    if (!cropSrc || !croppedArea) {
      setSaveError("Choose and position a photo before applying the crop.");
      return;
    }
    setApplyingCrop(true);
    setSaveError("");
    try {
      setAvatarUrl(await cropAvatarImage(cropSrc, croppedArea));
      setCropSrc("");
    } catch (cropError) {
      setSaveError(cropError instanceof Error ? cropError.message : "Unable to crop the selected photo.");
    } finally {
      setApplyingCrop(false);
    }
  };

  const sendRecoveryCode = async () => {
    const email = recoveryEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      setRecoveryEmailError("Enter a valid recovery email address.");
      setRecoveryEmailMessage("");
      return;
    }
    setRecoveryEmailBusy(true);
    setRecoveryEmailError("");
    setRecoveryEmailMessage("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/auth/recovery-email/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send a recovery email verification code.");
      setUser((current) => current ? { ...current, recoveryEmailPending: email } : current);
      setRecoveryEmail(email);
      setRecoveryCode("");
      setRecoveryCodeSent(true);
      setRecoveryEmailMessage(`${data.message} Sent to ${data.maskedEmail || "your recovery email"}.`);
    } catch (requestError) {
      setRecoveryEmailError(requestError instanceof Error ? requestError.message : "Unable to send a recovery email verification code.");
    } finally {
      setRecoveryEmailBusy(false);
    }
  };

  const verifyRecoveryCode = async () => {
    if (!/^\d{6}$/.test(recoveryCode)) {
      setRecoveryEmailError("Enter the 6-digit verification code.");
      setRecoveryEmailMessage("");
      return;
    }
    setRecoveryEmailBusy(true);
    setRecoveryEmailError("");
    setRecoveryEmailMessage("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/auth/recovery-email/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: recoveryCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to verify your recovery email.");
      const updatedProfile: ProfileUser = data.user;
      setUser(updatedProfile);
      setRecoveryEmail(updatedProfile.recoveryEmail || "");
      setRecoveryCode("");
      setRecoveryCodeSent(false);
      setSaveError("");
      setRecoveryEmailMessage(data.message || "Your recovery email address has been verified.");
    } catch (verifyError) {
      setRecoveryEmailError(verifyError instanceof Error ? verifyError.message : "Unable to verify your recovery email.");
    } finally {
      setRecoveryEmailBusy(false);
    }
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/auth/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, username, phone, avatarUrl, bio, location }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update your profile.");
      const updatedProfile: ProfileUser = data.user ?? data;
      setUser(updatedProfile);
      notifyProfileUpdated(updatedProfile);
      setName(updatedProfile.fullName || updatedProfile.name || "");
      setUsername(updatedProfile.username || "");
      setPhone(updatedProfile.phone || "");
      setAvatarUrl(updatedProfile.avatarUrl || "");
      setBio(updatedProfile.bio || "");
      setLocation(updatedProfile.location || "");
      setSaved(true);
    } catch (saveError) {
      setSaveError(saveError instanceof Error ? saveError.message : "Unable to update your profile.");
    } finally {
      setSaving(false);
    }
  };

  const title = user ? displayName(user) : "your profile";

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f9fd] text-[#142b4d]">
      <Navbar active={null} />
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Account</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-heading">Edit profile</h1>
          <p className="mt-2 text-sm text-muted">Update your marketplace account information.</p>
        </div>

        {loading ? (
          <div className="border border-border bg-white p-8 text-sm text-muted">Loading your profile...</div>
        ) : error ? (
          <div className="border border-orange-200 bg-white p-8">
            <h2 className="text-lg font-bold text-heading">Profile unavailable</h2>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <Link href="/login" className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-xs font-bold text-white no-underline hover:bg-primary-hover">Sign in</Link>
          </div>
        ) : (
          <form onSubmit={saveProfile} className="max-w-3xl border border-border bg-white p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-4 border-b border-divider pb-6">
              <ProfileAvatar url={avatarUrl || undefined} name={title} large />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-body">Profile photo</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="cursor-pointer rounded-md border border-primary px-3 py-1.5 text-[10px] font-bold text-primary hover:bg-orange-50">
                    Change photo
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={changePhoto} className="sr-only" />
                  </label>
                  {avatarUrl && <button type="button" onClick={() => setAvatarUrl("")} className="text-[10px] font-semibold text-muted hover:text-status-danger">Remove photo</button>}
                </div>
                <p className="mt-1 text-[10px] text-muted">PNG, JPG, or WEBP. Maximum 2 MB.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-body">Full name
                <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border-control px-3 text-sm font-normal" />
              </label>
              <label className="block text-xs font-semibold text-body">Username
                <input required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border-control px-3 text-sm font-normal" />
                <span className="mt-1 block text-[10px] font-normal text-muted">3-30 letters, numbers, or underscores.</span>
              </label>
              <label className="block text-xs font-semibold text-body">Email address
                <input readOnly value={user?.email || ""} className="mt-1 h-10 w-full rounded-md border border-border-control bg-slate-50 px-3 text-sm font-normal text-muted" />
                <span className="mt-1 block text-[10px] font-normal text-muted">
                  Primary email: <strong className={user?.emailVerified ? "text-status-success" : "text-status-danger"}>{user?.emailVerified ? "Verified" : "Not verified"}</strong>
                  {!user?.emailVerified && <> · <Link href="/verify-email" className="font-semibold text-primary no-underline hover:underline">Verify primary email</Link></>}
                </span>
              </label>
              <label className="block text-xs font-semibold text-body">Phone number
                <input type="tel" maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border-control px-3 text-sm font-normal" />
              </label>
              <label className="block text-xs font-semibold text-body sm:col-span-2">Location
                <input maxLength={100} value={location} onChange={(event) => setLocation(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border-control px-3 text-sm font-normal" />
              </label>
              <label className="block text-xs font-semibold text-body sm:col-span-2">About
                <textarea maxLength={500} rows={4} value={bio} onChange={(event) => setBio(event.target.value)} className="mt-1 w-full resize-y rounded-md border border-border-control px-3 py-2 text-sm font-normal" />
                <span className="mt-1 block text-right text-[10px] font-normal text-muted">{bio.length}/500</span>
              </label>
            </div>

            <section aria-labelledby="recovery-email-heading" className="mt-6 border-t border-divider pt-5">
              <h2 id="recovery-email-heading" className="text-sm font-bold text-heading">Recovery email</h2>
              <p className="mt-1 text-[10px] text-muted">Add a second email address for account recovery. It must be verified before it can be used.</p>
              {user?.recoveryEmailVerified && user.recoveryEmail && (
                <p className="mt-3 text-[10px] text-muted">
                  Current recovery email: <strong className="text-status-success">{user.recoveryEmail}</strong> · Verified
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block min-w-[220px] flex-1 text-xs font-semibold text-body">Recovery email address
                  <input type="email" autoComplete="email" maxLength={255} value={recoveryEmail} onChange={(event) => {
                    setRecoveryEmail(event.target.value);
                    setRecoveryEmailError("");
                    setRecoveryEmailMessage("");
                    setRecoveryCodeSent(false);
                  }} className="mt-1 h-10 w-full rounded-md border border-border-control px-3 text-sm font-normal" />
                </label>
                <button type="button" disabled={recoveryEmailBusy} onClick={() => void sendRecoveryCode()} className="h-10 rounded-md border border-primary px-4 text-xs font-semibold text-primary hover:bg-orange-50 disabled:opacity-50">
                  {recoveryEmailBusy ? "Please wait…" : recoveryCodeSent ? "Resend code" : "Send verification code"}
                </button>
              </div>
              {user?.recoveryEmailPending && (
                <p className="mt-2 text-[10px] text-muted">Waiting for verification of {user.recoveryEmailPending}.</p>
              )}
              {recoveryCodeSent && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="block w-full max-w-[220px] text-xs font-semibold text-body">6-digit verification code
                    <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 h-10 w-full rounded-md border border-border-control px-3 text-sm font-normal tracking-[0.3em]" />
                  </label>
                  <button type="button" disabled={recoveryEmailBusy || recoveryCode.length !== 6} onClick={() => void verifyRecoveryCode()} className="h-10 rounded-md bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
                    {recoveryEmailBusy ? "Verifying…" : "Verify recovery email"}
                  </button>
                </div>
              )}
              {recoveryEmailError && <p role="alert" className="mt-3 text-xs text-status-danger">{recoveryEmailError}</p>}
              {recoveryEmailMessage && <p role="status" className="mt-3 text-xs text-status-success">{recoveryEmailMessage}</p>}
            </section>

            {saveError && <p role="alert" className="mt-5 text-xs text-status-danger">{saveError}</p>}
            {saved && <p role="status" className="mt-5 text-xs text-status-success">Your profile has been updated.</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-divider pt-5">
              <Link href="/profile" className="rounded-md border border-border-control px-4 py-2 text-xs font-semibold text-body no-underline hover:bg-slate-50">Back to profile</Link>
              <button type="submit" disabled={saving} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        )}
      </div>
      <PublicFooter />
      {cropSrc && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="crop-photo-heading" className="w-full max-w-lg border border-border bg-white p-5 shadow-xl sm:p-6">
            <h2 id="crop-photo-heading" className="text-lg font-bold text-heading">Crop profile photo</h2>
            <p className="mt-1 text-xs text-muted">Drag the image to position it, then adjust the zoom.</p>
            <div className="relative mt-4 h-[300px] w-full overflow-hidden rounded-md bg-slate-900">
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                minZoom={1}
                maxZoom={3}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setCroppedArea(pixels)}
              />
            </div>
            <label className="mt-4 block text-xs font-semibold text-body">Zoom
              <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="mt-2 w-full accent-orange-500" />
            </label>
            <div className="mt-5 flex justify-end gap-2 border-t border-divider pt-4">
              <button type="button" disabled={applyingCrop} onClick={() => setCropSrc("")} className="rounded-md border border-border-control px-4 py-2 text-xs font-semibold text-body hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={applyingCrop || !croppedArea} onClick={() => void applyCrop()} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50">{applyingCrop ? "Applying…" : "Use photo"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

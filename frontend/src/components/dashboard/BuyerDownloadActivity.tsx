"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { subscribeToBuyerDownloads, type BuyerDownloadEntry } from "@/lib/buyerDownloads";
import { routes } from "@/lib/routeController";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / 1024 ** (unitIndex + 1)).toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export default function BuyerDownloadActivity() {
  const [downloads, setDownloads] = useState<BuyerDownloadEntry[]>([]);

  useEffect(() => subscribeToBuyerDownloads(setDownloads), []);

  const activeCount = downloads.filter((item) => item.status === "downloading").length;
  const completeCount = downloads.filter((item) => item.status === "complete").length;
  const failedCount = downloads.filter((item) => item.status === "failed").length;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Download activity</h1>
          <p className="mt-1 text-sm text-muted">All downloads from this browsing session.</p>
        </div>
        <Link href={routes.buyer.downloads()} className="inline-flex items-center gap-2 self-start rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body no-underline hover:border-primary hover:text-primary">
          <PublicIcon name="download" className="h-3.5 w-3.5" />My downloads
        </Link>
      </header>

      <section aria-label="Download totals" className="mt-6 grid grid-cols-3 divide-x divide-divider rounded-xl border border-divider bg-white">
        <div className="px-4 py-4 sm:px-5"><p className="text-[10px] font-semibold uppercase text-muted">Active</p><p className="mt-1 text-xl font-bold text-heading">{activeCount}</p></div>
        <div className="px-4 py-4 sm:px-5"><p className="text-[10px] font-semibold uppercase text-muted">Completed</p><p className="mt-1 text-xl font-bold text-emerald-700">{completeCount}</p></div>
        <div className="px-4 py-4 sm:px-5"><p className="text-[10px] font-semibold uppercase text-muted">Failed</p><p className="mt-1 text-xl font-bold text-status-danger">{failedCount}</p></div>
      </section>

      <section aria-label="All download activity" className="mt-5 overflow-hidden rounded-xl border border-divider bg-white">
        {downloads.length === 0 ? <div className="px-5 py-14 text-center">
          <PublicIcon name="download" className="mx-auto h-7 w-7 text-muted-soft" />
          <h2 className="mt-3 text-sm font-semibold text-heading">No downloads yet</h2>
          <p className="mt-1 text-xs text-muted">Downloads started in this session will appear here.</p>
        </div> : <ol className="divide-y divide-divider">
          {downloads.map((item) => {
            const percent = item.status === "complete"
              ? 100
              : item.totalBytes && item.totalBytes > 0
                ? Math.min(100, Math.floor(item.loadedBytes / item.totalBytes * 100))
                : null;
            const remainingSeconds = item.totalBytes && item.speedBytesPerSecond > 0
              ? Math.max(0, Math.ceil((item.totalBytes - item.loadedBytes) / item.speedBytesPerSecond))
              : null;
            return <li key={item.id} className="flex gap-3 px-4 py-4 sm:gap-4 sm:px-5">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${item.status === "failed" ? "bg-red-50 text-status-danger" : item.status === "complete" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-primary"}`}>
                <PublicIcon name={item.status === "complete" ? "check" : item.status === "failed" ? "x" : "download"} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-heading" title={item.fileName}>{item.fileName}</p><p className="mt-1 text-[10px] text-muted">{new Date(item.updatedAt).toLocaleString()}</p></div>
                  <span className={`w-fit rounded-full px-2 py-1 text-[9px] font-semibold ${item.status === "failed" ? "bg-red-50 text-status-danger" : item.status === "complete" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-primary"}`}>{item.status === "downloading" ? "Downloading" : item.status === "complete" ? "Completed" : "Failed"}</span>
                </div>
                <p className="mt-2 text-[10px] text-muted">
                  {item.status === "failed" ? item.error || "Download failed" : item.status === "complete" ? `File size ${formatBytes(item.loadedBytes)}` : `${percent === null ? "Preparing transfer" : `${percent}%`} · ${formatBytes(item.loadedBytes)}${item.totalBytes ? ` of ${formatBytes(item.totalBytes)}` : ""}`}
                </p>
                {item.status === "downloading" && item.speedBytesPerSecond > 0 && <p className="mt-1 text-[10px] text-muted">{formatBytes(item.speedBytesPerSecond)}/s{remainingSeconds !== null ? ` · about ${formatDuration(remainingSeconds)} remaining` : ""}</p>}
                {item.status === "downloading" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`Downloading ${item.fileName}`} aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                  {percent === null ? <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" /> : <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />}
                </div>}
              </div>
            </li>;
          })}
        </ol>}
      </section>
    </div>
  );
}
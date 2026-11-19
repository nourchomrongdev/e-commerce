export type BuyerDownloadStatus = "downloading" | "complete" | "failed";

export type BuyerDownloadUpdate = {
  id: string;
  fileName: string;
  status: BuyerDownloadStatus;
  loadedBytes: number;
  totalBytes: number | null;
  error?: string;
  updatedAt: number;
};

export type BuyerDownloadEntry = BuyerDownloadUpdate & { speedBytesPerSecond: number };

let downloads: BuyerDownloadEntry[] = [];
const listeners = new Set<(items: BuyerDownloadEntry[]) => void>();

function publishDownload(update: BuyerDownloadUpdate) {
  const previous = downloads.find((item) => item.id === update.id);
  const elapsedSeconds = previous ? (update.updatedAt - previous.updatedAt) / 1000 : 0;
  const speedBytesPerSecond = update.status === "downloading" && previous && elapsedSeconds > 0
    ? Math.max(0, (update.loadedBytes - previous.loadedBytes) / elapsedSeconds)
    : previous?.speedBytesPerSecond ?? 0;
  downloads = [{ ...update, speedBytesPerSecond }, ...downloads.filter((item) => item.id !== update.id)];
  listeners.forEach((listener) => listener(downloads));
}

export function beginBuyerDownload(fileName: string) {
  const id = window.crypto.randomUUID();
  publishDownload({ id, fileName, status: "downloading", loadedBytes: 0, totalBytes: null, updatedAt: Date.now() });
  return id;
}

export function updateBuyerDownload(id: string, fileName: string, loadedBytes: number, totalBytes: number | null) {
  publishDownload({ id, fileName, status: "downloading", loadedBytes, totalBytes, updatedAt: Date.now() });
}

export function finishBuyerDownload(id: string, fileName: string, loadedBytes: number) {
  publishDownload({ id, fileName, status: "complete", loadedBytes, totalBytes: loadedBytes, updatedAt: Date.now() });
}

export function failBuyerDownload(id: string, fileName: string, loadedBytes: number, error: string) {
  publishDownload({ id, fileName, status: "failed", loadedBytes, totalBytes: null, error, updatedAt: Date.now() });
}

export function subscribeToBuyerDownloads(listener: (items: BuyerDownloadEntry[]) => void) {
  listeners.add(listener);
  listener(downloads);
  return () => listeners.delete(listener);
}
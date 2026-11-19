"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { CART_STORAGE_KEY, CART_UPDATED_EVENT } from "@/lib/cart";
import { beginBuyerDownload, failBuyerDownload, finishBuyerDownload, updateBuyerDownload } from "@/lib/buyerDownloads";
import { Modal } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type CommerceView = "purchases" | "downloads" | "payments";
type OrderRow = {
  id: number;
  orderNumber: string;
  status: string;
  currency: string;
  totalAmount: number | string;
  createdAt: string;
  paymentDueAt: string;
  itemCount: number;
  items: { productId: number; productName: string; quantity: number; unitPrice: number | string; licenseTypeId: number | null; allowRepurchase: boolean; amount: number | string }[];
  payments: { provider: string; status: string; transactionId: string | null }[];
};
type DownloadRow = {
  licenseId: number;
  fileId: number;
  orderNumber: string;
  purchasedAt: string;
  lastDownloadedAt: string | null;
  productName: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | string;
  downloadCount: number;
  downloadLimit: number | null;
  licenseExpiresAt: string | null;
};
type PaymentRow = {
  id: number;
  orderNumber: string;
  provider: string;
  transactionId: string | null;
  amount: number | string;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
};
type PageResponse = {
  orders?: OrderRow[];
  downloads?: DownloadRow[];
  payments?: PaymentRow[];
  pagination?: { page: number; total: number; totalPages: number };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const PAGE_SIZE = 10;

function isPendingPayWayPayment(payment: OrderRow["payments"][number]) {
  return payment.status.toLowerCase() === "pending" &&
    ["abayapayway", "abapayway", "payway", "aba"].includes(payment.provider.toLowerCase());
}

function hasBlockingActivePayment(order: OrderRow) {
  return order.payments.some((payment) =>
    ["pending", "authorized"].includes(payment.status.toLowerCase()) && !isPendingPayWayPayment(payment),
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatBytes(value: number | string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Size unavailable";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function BuyerCommerceSection({ view }: { view: CommerceView }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatus = useDebouncedValue(status);
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<PageResponse>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingFile, setDownloadingFile] = useState<number | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const updateTime = () => setNow(Date.now());
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (search.trim() !== debouncedSearch || status !== debouncedStatus) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in to view your purchase history.");
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (debouncedStatus) params.set("status", debouncedStatus);
        const endpoint = view === "purchases" ? "buyer/orders" : view === "downloads" ? "buyer/downloads" : "buyer/payments";
        const result = await fetch(`${apiUrl}/${endpoint}?${params}`, {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || "Unable to load marketplace records.");
        setResponse(data);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load marketplace records.");
          setResponse({});
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [debouncedSearch, debouncedStatus, page, search, status, view]);

  const orders = useMemo(() => response.orders || [], [response.orders]);
  const downloads = useMemo(() => response.downloads || [], [response.downloads]);
  const payments = useMemo(() => response.payments || [], [response.payments]);
  const pagination = response.pagination || { page: 1, total: 0, totalPages: 1 };
  function retryOrderPayment(order: OrderRow) {
    const cart = order.items.map((item) => ({
      id: String(item.productId),
      quantity: item.quantity,
      licensePrice: Number(item.unitPrice),
      ...(item.licenseTypeId ? { licenseTypeId: item.licenseTypeId } : {}),
      ...(item.allowRepurchase ? { allowRepurchase: true } : {}),
    }));
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
    setSelectedOrder(null);
    router.push("/cart/payment");
  }
  async function cancelOrder(order: OrderRow) {
    setCancellingOrderId(order.id);
    setError("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const result = await fetch(`${apiUrl}/buyer/orders/${encodeURIComponent(String(order.id))}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Unable to cancel this order.");
      setResponse((current) => ({
        ...current,
        orders: current.orders?.map((row) => row.id === order.id ? { ...row, status: "cancelled" } : row),
      }));
      setSelectedOrder(null);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Unable to cancel this order.");
    } finally {
      setCancellingOrderId(null);
    }
  }
  const heading = view === "purchases" ? "My Orders" : view === "downloads" ? "My Downloads" : "Transactions";
  const description = view === "purchases"
    ? "Review orders, payment status, and receipts for your purchases."
    : view === "downloads"
      ? "Review files included with your purchases. Download complete products as ZIP archives."
      : "Track payment methods, amounts, statuses, and verified transaction receipts.";
  const selectedOrderHasPendingPayWayPayment = selectedOrder?.payments.some(isPendingPayWayPayment) ?? false;
  const selectedOrderHasBlockingActivePayment = selectedOrder ? hasBlockingActivePayment(selectedOrder) : false;

  const exportRows = useMemo(() => {
    if (view === "purchases") return [
      ["Order Number", "Status", "Items", "Total", "Currency", "Date"],
      ...orders.map((order) => [order.orderNumber, order.status, String(order.itemCount), String(order.totalAmount), order.currency, order.createdAt]),
    ];
    if (view === "downloads") return [
      ["Order Number", "Product", "File", "Downloads", "Limit", "Purchased", "Last Downloaded"],
      ...downloads.map((item) => [item.orderNumber, item.productName, item.fileName, String(item.downloadCount), item.downloadLimit === null ? "Unlimited" : String(item.downloadLimit), item.purchasedAt, item.lastDownloadedAt || ""]),
    ];
    return [
      ["Order Number", "Provider", "Transaction ID", "Status", "Amount", "Currency", "Date"],
      ...payments.map((payment) => [payment.orderNumber, payment.provider, payment.transactionId || "", payment.status, String(payment.amount), payment.currency, payment.createdAt]),
    ];
  }, [downloads, orders, payments, view]);

  async function downloadFile(item: DownloadRow) {
    setDownloadingFile(item.fileId);
    setError("");
    const fileName = `${item.productName}.zip`;
    const downloadId = beginBuyerDownload(fileName);
    let received = 0;
    try {
      const token = window.localStorage.getItem("marketplace-token");
      if (!token) throw new Error("Please sign in to download this file.");
      const result = await fetch(`${apiUrl}/buyer/licenses/${item.licenseId}/downloads.zip`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!result.ok) {
        const data = await result.json();
        throw new Error(data.error || "Unable to download this product ZIP.");
      }

      const totalBytes = Number(result.headers.get("Content-Length") || 0);
      const reader = result.body?.getReader();
      if (!reader) throw new Error("This browser cannot stream ZIP downloads.");

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        updateBuyerDownload(downloadId, fileName, received, totalBytes > 0 ? totalBytes : null);
      }

      const blob = new Blob(chunks, { type: result.headers.get("Content-Type") || "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${item.productName.replace(/[\\/:*?"<>|]/g, "-")}.zip`;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      finishBuyerDownload(downloadId, fileName, received);
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : "Unable to download this product ZIP.";
      failBuyerDownload(downloadId, fileName, received, message);
      setError(message);
    } finally {
      setDownloadingFile(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{heading}</h1>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(`${view}.csv`, exportRows)}
          disabled={loading || exportRows.length < 2}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PublicIcon name="download" className="h-3.5 w-3.5" />Export current page
        </button>
      </header>

      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-divider px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">Search {heading.toLowerCase()}</span>
            <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder={`Search ${heading.toLowerCase()}...`}
              className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs text-body outline-none focus:border-primary"
            />
          </label>
          {view !== "downloads" && (
            <select
              aria-label="Status filter"
              value={status}
              onChange={(event) => { setStatus(event.target.value); setPage(1); }}
              className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body"
            >
              <option value="">All statuses</option>
              {["pending", "processing", "paid", "completed", "failed", "expired", "cancelled", "refunded", "partially_refunded"].map((item) => (
                <option key={item} value={item}>{formatStatus(item)}</option>
              ))}
            </select>
          )}
        </div>

        {error && <p role="alert" className="border-b border-divider px-5 py-3 text-xs text-status-danger">{error}</p>}
        {loading ? <p className="px-5 py-10 text-center text-sm text-muted">Loading {heading.toLowerCase()}...</p> : (
          <div className="divide-y divide-divider">
            {view === "purchases" && orders.map((order) => (
              <article key={order.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-heading">{order.orderNumber}</p>
                  <p className="mt-1 text-xs text-muted">{order.itemCount} item{order.itemCount === 1 ? "" : "s"} · {formatDate(order.createdAt)}</p>
                  <p className="mt-1 text-[10px] text-muted">{order.items?.map((item) => `${item.productName} × ${item.quantity}`).join(" · ")}</p>
                  {["pending", "failed"].includes(order.status) && (
                    <p className={`mt-1 text-[10px] font-medium ${now === null || Date.parse(order.paymentDueAt) > now ? "text-amber-700" : "text-status-danger"}`}>
                      {now === null || Date.parse(order.paymentDueAt) > now
                        ? `Pay this order within 24 hours, by ${formatDate(order.paymentDueAt)}.`
                        : "The 24-hour payment window has expired."}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${["paid", "completed"].includes(order.status) ? "bg-emerald-50 text-emerald-700" : ["failed", "cancelled", "refunded"].includes(order.status) ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{formatStatus(order.status)}</span>
                  <span className="text-sm font-bold text-heading">{formatMoney(order.totalAmount, order.currency)}</span>
                  <button type="button" onClick={() => setSelectedOrder(order)} aria-label={`Actions for order ${order.orderNumber}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border-control text-muted transition hover:border-primary hover:bg-surface-hover hover:text-primary"><PublicIcon name="ellipsis-vertical" className="h-4 w-4" /></button>
                </div>
              </article>
            ))}
            {view === "downloads" && downloads.map((item) => (
              <article key={`${item.licenseId}-${item.fileId}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-50 text-primary"><PublicIcon name="download" className="h-4 w-4" /></span>
                  <div><p className="text-xs font-semibold text-body">{item.fileName}</p><p className="mt-1 text-[10px] text-muted">{item.productName} · {formatBytes(item.fileSize)} · {item.mimeType || "File format unavailable"}</p><p className="mt-1 text-[10px] text-muted">Order {item.orderNumber} · Purchased {formatDate(item.purchasedAt)} · Last downloaded {formatDate(item.lastDownloadedAt)}</p><p className="mt-1 text-[10px] text-muted">{item.downloadCount}{item.downloadLimit === null ? "" : ` / ${item.downloadLimit}`} downloads used{item.licenseExpiresAt ? ` · Access expires ${formatDate(item.licenseExpiresAt)}` : ""}</p></div>
                </div>
                <button
                  type="button"
                  disabled={downloadingFile === item.fileId || (item.downloadLimit !== null && item.downloadCount >= item.downloadLimit)}
                  onClick={() => void downloadFile(item)}
                  className="inline-flex w-fit items-center gap-2 rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PublicIcon name="download" className="h-3.5 w-3.5" />
                  {downloadingFile === item.fileId ? "Preparing ZIP..." : "Download ZIP"}
                </button>
              </article>
            ))}
            {view === "payments" && payments.map((payment) => (
              <article key={payment.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div><Link href={`/buyer/purchases/${encodeURIComponent(payment.orderNumber)}`} className="text-xs font-semibold text-heading hover:text-primary">Order {payment.orderNumber}</Link><p className="mt-1 text-[10px] text-muted">{payment.provider} · {payment.transactionId || "Awaiting provider reference"} · {formatDate(payment.paidAt || payment.createdAt)}</p></div>
                <div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${payment.status === "paid" ? "bg-emerald-50 text-emerald-700" : ["failed", "cancelled", "refunded"].includes(payment.status) ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{formatStatus(payment.status)}</span><span className="text-sm font-bold text-heading">{formatMoney(payment.amount, payment.currency)}</span></div>
              </article>
            ))}
            {!error && ((view === "purchases" && orders.length === 0) || (view === "downloads" && downloads.length === 0) || (view === "payments" && payments.length === 0)) && (
              <p className="px-5 py-10 text-center text-sm text-muted">No matching records found.</p>
            )}
          </div>
        )}
        <ProductPagination
          count={view === "purchases" ? orders.length : view === "downloads" ? downloads.length : payments.length}
          total={pagination.total}
          page={pagination.page}
          pages={pagination.totalPages}
          itemLabel="records"
          onPageChange={setPage}
        />
      </section>

      <Modal open={Boolean(selectedOrder)} title={`Order actions: ${selectedOrder?.orderNumber ?? ""}`} onClose={() => setSelectedOrder(null)} size="md">
        {selectedOrder && <div className="space-y-4">
          <div className="rounded-lg bg-surface-muted p-4">
            <p className="text-xs font-semibold text-heading">{formatStatus(selectedOrder.status)} · {formatMoney(selectedOrder.totalAmount, selectedOrder.currency)}</p>
            <p className="mt-1 text-[10px] text-muted">{selectedOrder.itemCount} item{selectedOrder.itemCount === 1 ? "" : "s"} · Ordered {formatDate(selectedOrder.createdAt)}</p>
            <div className="mt-3 space-y-1">
              {selectedOrder.items.map((item) => <p key={`${item.productId}-${item.licenseTypeId ?? "default"}`} className="text-[10px] text-body">{item.productName} × {item.quantity}</p>)}
            </div>
          </div>
          <div className="grid gap-2">
            {["pending", "failed"].includes(selectedOrder.status) && (now === null || Date.parse(selectedOrder.paymentDueAt) > now) && <button type="button" onClick={() => retryOrderPayment(selectedOrder)} className="inline-flex items-center gap-3 rounded-lg border border-border-control px-4 py-3 text-left text-xs font-semibold text-body hover:border-primary hover:bg-surface-hover"><PublicIcon name="credit-card" className="h-4 w-4 text-primary" />Pay for this order</button>}
            {selectedOrderHasPendingPayWayPayment && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
                ABA PayWay may still confirm an in-flight payment after cancellation. If it completes, contact support for help with a refund.
              </p>
            )}
            {["pending", "failed"].includes(selectedOrder.status) && !selectedOrderHasBlockingActivePayment && <button type="button" onClick={() => void cancelOrder(selectedOrder)} disabled={cancellingOrderId === selectedOrder.id} className="inline-flex items-center gap-3 rounded-lg border border-status-danger/20 px-4 py-3 text-left text-xs font-semibold text-status-danger hover:bg-status-danger-surface disabled:opacity-50"><PublicIcon name="delete" className="h-4 w-4" />{cancellingOrderId === selectedOrder.id ? "Canceling..." : "Cancel order"}</button>}
            <Link href={`/buyer/purchases/${selectedOrder.id}`} onClick={() => setSelectedOrder(null)} className="inline-flex items-center gap-3 rounded-lg border border-border-control px-4 py-3 text-xs font-semibold text-body no-underline hover:border-primary hover:bg-surface-hover"><PublicIcon name="view" className="h-4 w-4 text-primary" />View order details</Link>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

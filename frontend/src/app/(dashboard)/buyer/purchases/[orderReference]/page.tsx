"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { CART_STORAGE_KEY, CART_UPDATED_EVENT } from "@/lib/cart";
import { beginBuyerDownload, failBuyerDownload, finishBuyerDownload, updateBuyerDownload } from "@/lib/buyerDownloads";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type OrderDetails = {
  id: number;
  orderNumber: string;
  status: string;
  subtotal: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  currency: string;
  createdAt: string;
  paymentDueAt: string;
};
type OrderItem = {
  id: number;
  productId: number;
  productName: string;
  storeName: string;
  storeSlug: string | null;
  productSlug: string | null;
  productUrl: string | null;
  thumbnailUrl: string | null;
  licenseName: string | null;
  quantity: number;
  unitPrice: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  licenseTerms: string;
  licenseTypeId: number | null;
  allowRepurchase: boolean;
  licenseCount: number;
  downloads: {
    licenseId: number;
    fileId: number;
    fileName: string;
    fileSize: number | string;
    mimeType: string | null;
    downloadCount: number;
    downloadLimit: number | null;
  }[];
};
type Payment = {
  id: number;
  provider: string;
  transactionId: string | null;
  amount: number | string;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

function money(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function BuyerOrderDetailsPage({ params }: { params: Promise<{ orderReference: string }> }) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [actionError, setActionError] = useState("");
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const updateTime = () => setNow(Date.now());
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then(async ({ orderReference }) => {
      if (!active) return;
      setReference(orderReference);
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in to view this order.");
        const response = await fetch(`${apiUrl}/buyer/orders/${encodeURIComponent(orderReference)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load this order.");
        if (!active) return;
        setOrder(data.order);
        setItems(data.items || []);
        setPayments(data.payments || []);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load this order.");
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [params]);

  if (loading) return <p className="px-5 py-8 text-sm text-muted">Loading order details...</p>;
  if (error || !order) return <div className="mx-auto max-w-[1000px] px-5 py-8"><p role="alert" className="text-sm text-status-danger">{error || "Order not found."}</p><Link href="/buyer/purchases" className="mt-4 inline-block text-sm font-semibold text-primary">Back to orders</Link></div>;

  const paymentWindowOpen = now === null || Date.parse(order.paymentDueAt) > now;
  const canRetryPayment = ["pending", "failed"].includes(order.status) && paymentWindowOpen;
  const pendingPayWay = payments.find((payment) =>
    ["pending", "authorized"].includes(payment.status.toLowerCase()) &&
    ["abayapayway", "abapayway", "payway", "aba"].includes(payment.provider.toLowerCase()) &&
    payment.transactionId,
  );
  const pendingPayWayPayment = payments.some((payment) =>
    payment.status.toLowerCase() === "pending" &&
    ["abayapayway", "abapayway", "payway", "aba"].includes(payment.provider.toLowerCase()),
  );
  const hasActivePayment = payments.some((payment) =>
    ["pending", "authorized"].includes(payment.status.toLowerCase()),
  );
  const hasBlockingActivePayment = payments.some((payment) =>
    ["pending", "authorized"].includes(payment.status.toLowerCase()) &&
    !(payment.status.toLowerCase() === "pending" &&
      ["abayapayway", "abapayway", "payway", "aba"].includes(payment.provider.toLowerCase())),
  );
  const canCancelOrder = ["pending", "failed"].includes(order.status) && !hasBlockingActivePayment;
  const retryPayment = () => {
    const cart = items.map((item) => ({
      id: String(item.productId),
      quantity: item.quantity,
      licensePrice: Number(item.unitPrice),
      ...(item.licenseTypeId ? { licenseTypeId: item.licenseTypeId } : {}),
      ...(item.allowRepurchase ? { allowRepurchase: true } : {}),
    }));
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
    router.push("/cart/payment");
  };

  async function checkPaymentStatus() {
    if (!pendingPayWay?.transactionId) return;
    setCheckingPayment(true);
    setActionError("");
    setNotice("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(
        `${apiUrl}/payments/payway/status/${encodeURIComponent(pendingPayWay.transactionId)}`,
        { headers: { Authorization: "Bearer " + token }, cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to verify this payment.");
      const orderResponse = await fetch(`${apiUrl}/buyer/orders/${encodeURIComponent(reference)}`, {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
      });
      const orderData = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(orderData.error || "Payment checked, but order details could not be refreshed.");
      setOrder(orderData.order);
      setItems(orderData.items || []);
      setPayments(orderData.payments || []);
      const status = String(data.status || "pending").toLowerCase();
      const orderStatus = String(orderData.order?.status || "").toLowerCase();
      const paymentConfirmed = ["paid", "completed", "success", "succeeded"].includes(status);
      setNoticeTone(paymentConfirmed && orderStatus !== "cancelled" ? "success" : "warning");
      setNotice(paymentConfirmed
        ? orderStatus === "cancelled"
          ? "PayWay confirmed payment after this order was canceled. No licenses were issued; contact support for help with a refund."
          : "Payment confirmed. Your licenses and downloads are ready."
        : `ABA PayWay still reports this payment as ${status}. If you completed payment, wait a moment and check again.`);
    } catch (statusError) {
      setActionError(statusError instanceof Error ? statusError.message : "Unable to verify this payment.");
    } finally {
      setCheckingPayment(false);
    }
  }

  async function cancelPendingOrder() {
    setCancellingOrder(true);
    setActionError("");
    setNotice("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/buyer/orders/${encodeURIComponent(reference)}/cancel`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to cancel this order.");
      setOrder((current) => current ? { ...current, status: "cancelled" } : current);
      setNoticeTone(pendingPayWayPayment ? "warning" : "success");
      setNotice(pendingPayWayPayment
        ? "Order canceled. ABA PayWay may still confirm this in-flight payment; if it completes, contact support for help with a refund."
        : "Pending order canceled. You were not charged.");
    } catch (cancelError) {
      setActionError(cancelError instanceof Error ? cancelError.message : "Unable to cancel this order.");
    } finally {
      setCancellingOrder(false);
    }
  }

  async function downloadProductZip(licenseId: number, productName: string) {
    setDownloadingZip(licenseId);
    setActionError("");
    const fileName = `${productName}.zip`;
    const downloadId = beginBuyerDownload(fileName);
    let received = 0;
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/buyer/licenses/${licenseId}/downloads.zip`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to download this product ZIP.");
      }
      const totalBytes = Number(response.headers.get("Content-Length") || 0);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("This browser cannot stream ZIP downloads.");

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        updateBuyerDownload(downloadId, fileName, received, totalBytes > 0 ? totalBytes : null);
      }

      const blob = new Blob(chunks, { type: response.headers.get("Content-Type") || "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${productName.replace(/[\\/:*?"<>|]/g, "-")}.zip`;
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
      setActionError(message);
    } finally {
      setDownloadingZip(null);
    }
  }

  return (
    <div className="buyer-order-print mx-auto w-full max-w-[1000px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/buyer/purchases" className="print-hidden text-xs font-semibold text-primary">← My Orders</Link>
          <p className="print-only text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Invoice / Receipt</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-heading">Order {order.orderNumber}</h1>
          <p className="mt-1 text-xs text-muted">Placed {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <div className="print-hidden flex flex-wrap gap-2">
          {canRetryPayment && <button type="button" onClick={retryPayment} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover">Pay this order</button>}
          {pendingPayWay && <button type="button" onClick={() => void checkPaymentStatus()} disabled={checkingPayment} className="rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body hover:border-primary disabled:opacity-60">{checkingPayment ? "Checking..." : "Check payment status"}</button>}
          {canCancelOrder && <button type="button" onClick={() => void cancelPendingOrder()} disabled={cancellingOrder} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">{cancellingOrder ? "Canceling..." : "Cancel pending order"}</button>}
          <button type="button" onClick={() => window.print()} className="rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body hover:border-primary">Print invoice / receipt</button>
        </div>
      </div>

      {notice && <p role="status" className={`print-hidden mt-4 rounded-lg border px-4 py-3 text-xs ${noticeTone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice}</p>}
      {actionError && <p role="alert" className="print-hidden mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{actionError}</p>}

      {["pending", "failed"].includes(order.status) && (
        <p className={`print-hidden mt-4 rounded-lg border px-4 py-3 text-xs ${paymentWindowOpen ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-status-danger"}`}>
          {paymentWindowOpen
            ? `Payment failed or is still pending. Pay this same order by ${new Date(order.paymentDueAt).toLocaleString()} (within 24 hours); retrying will not create another order.`
            : "The 24-hour payment window for this order has expired. Start checkout again if you still want to purchase this product."}
        </p>
      )}
      {["pending", "failed"].includes(order.status) && hasActivePayment && (
        <p className={`print-hidden mt-2 text-xs ${pendingPayWayPayment ? "text-amber-800" : "text-muted"}`}>
          {pendingPayWayPayment
            ? "You may cancel now, but ABA PayWay can still confirm an in-flight payment. If it completes after cancellation, contact support for help with a refund."
            : "This order cannot be canceled while a payment is awaiting provider confirmation. Use “Check payment status” or wait for the payment session to expire."}
        </p>
      )}
      {order.status === "cancelled" && pendingPayWayPayment && (
        <p className="print-hidden mt-2 text-xs text-amber-800">This canceled order still has an ABA PayWay payment awaiting confirmation. Check its status; if it completes, contact support for help with a refund.</p>
      )}
      {order.status === "cancelled" && payments.some((payment) =>
        ["paid", "completed", "success", "succeeded"].includes(payment.status.toLowerCase()) &&
        ["abayapayway", "abapayway", "payway", "aba"].includes(payment.provider.toLowerCase()),
      ) && (
        <p className="print-hidden mt-2 text-xs text-status-danger">A PayWay payment completed after this order was canceled. No licenses were issued; contact support for help with a refund.</p>
      )}

      <section className="print-card mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-4">
          <h2 className="text-sm font-bold text-heading">Order details</h2>
          <span className="rounded-full bg-surface-muted px-3 py-1 text-[10px] font-semibold text-body">{statusLabel(order.status)}</span>
        </div>
        <div className="divide-y divide-divider">
          {items.map((item) => (
            <article key={item.id} className="print-item flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {item.thumbnailUrl
                  ? <Image src={item.thumbnailUrl} alt={`${item.productName} preview`} width={96} height={72} unoptimized className="h-16 w-20 shrink-0 rounded-lg bg-slate-100 object-cover" />
                  : <div className="grid h-16 w-20 shrink-0 place-items-center rounded-lg bg-slate-100 text-[9px] text-muted">No preview</div>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-heading">{item.productName}</p>
                  <p className="mt-1 text-[10px] text-muted">{item.storeName} · Quantity {item.quantity} · {money(item.unitPrice, order.currency)} each</p>
                  {item.licenseName && <p className="mt-1 text-[10px] font-semibold text-body">{item.licenseName}</p>}
                  {item.licenseTerms && <p className="print-hidden mt-2 whitespace-pre-wrap text-[10px] text-muted">{item.licenseTerms}</p>}
                  <p className="mt-2 text-[10px] text-muted">{item.licenseCount} license{item.licenseCount === 1 ? "" : "s"} issued</p>
                  <div className="print-hidden mt-3 flex flex-wrap gap-3">
                    {item.productUrl && <Link href={item.productUrl} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-primary hover:underline">View product</Link>}
                    {item.licenseCount > 0 && <Link href="/buyer/licenses" className="text-[10px] font-semibold text-primary hover:underline">Manage licenses</Link>}
                  </div>
                  {item.downloads.length > 0 && (
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-divider bg-surface-muted px-3 py-2">
                      <span className="text-[10px] text-muted">{item.downloads.length} downloadable file{item.downloads.length === 1 ? "" : "s"} included</span>
                      <button
                        type="button"
                        onClick={() => void downloadProductZip(item.downloads[0].licenseId, item.productName)}
                        disabled={downloadingZip === item.downloads[0].licenseId}
                        aria-label={downloadingZip === item.downloads[0].licenseId ? "Preparing product ZIP" : `Download ${item.productName} files as ZIP`}
                        title={downloadingZip === item.downloads[0].licenseId ? "Preparing ZIP" : "Download ZIP"}
                        className="print-hidden grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <PublicIcon name="download" className={`h-4 w-4 ${downloadingZip === item.downloads[0].licenseId ? "animate-pulse" : ""}`} />
                      </button>
                    </div>
                  )}
                  {["paid", "completed"].includes(order.status) && item.downloads.length === 0 && (
                    <p className="mt-3 text-[10px] text-muted">No downloadable files are currently attached to this product. Visit My Downloads or contact the store for help.</p>
                  )}
                </div>
              </div>
              <p className="text-sm font-bold text-heading">{money(item.totalAmount, order.currency)}</p>
            </article>
          ))}
        </div>
        <div className="ml-auto max-w-sm space-y-2 border-t border-divider px-5 py-4 text-xs">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(order.subtotal, order.currency)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Discount</span><span>−{money(order.discountAmount, order.currency)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Tax</span><span>{money(order.taxAmount, order.currency)}</span></div>
          <div className="flex justify-between border-t border-divider pt-2 text-sm font-bold"><span>Total</span><span>{money(order.totalAmount, order.currency)}</span></div>
        </div>
      </section>

      <section className="print-card mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <h2 className="border-b border-divider px-5 py-4 text-sm font-bold text-heading">Payment history</h2>
        {payments.length ? payments.map((payment) => (
          <div key={payment.id} className="print-item flex flex-col gap-2 border-b border-divider px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs font-semibold text-body">{payment.provider} · {statusLabel(payment.status)}</p><p className="mt-1 break-all text-[10px] text-muted">{payment.transactionId || "No provider transaction ID"} · {new Date(payment.paidAt || payment.createdAt).toLocaleString()}</p></div>
            <p className="text-xs font-bold text-heading">{money(payment.amount, payment.currency)}</p>
          </div>
        )) : <p className="px-5 py-5 text-xs text-muted">No payment attempts have been recorded.</p>}
      </section>
      <p className="print-only mt-5 text-[10px] text-muted">Thank you for your purchase.</p>
      <p className="sr-only">Reference {reference}</p>
    </div>
  );
}

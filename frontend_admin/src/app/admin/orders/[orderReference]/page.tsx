"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

type Order = {
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  createdAt: string;
  updatedAt: string;
  buyerName: string;
  buyerEmail: string;
};
type OrderItem = {
  productName: string;
  quantity: number;
  unitPrice: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  storefrontName: string;
  creatorName: string;
  creatorEmail: string;
};
type Payment = {
  provider: string;
  transactionId: string | null;
  amount: number | string;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const money = (value: number | string, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));
const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusTone = (value: string): "success" | "warning" | "danger" | "neutral" => {
  if (["paid", "completed"].includes(value)) return "success";
  if (["pending", "processing"].includes(value)) return "warning";
  if (["failed", "cancelled", "expired", "refunded", "partially_refunded"].includes(value)) return "danger";
  return "neutral";
};

export default function AdminOrderDetailPage() {
  const { orderReference } = useParams<{ orderReference: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadOrder = async () => {
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("An administrator session is required to view order details.");
        const response = await fetch(`${apiUrl}/admin/orders/${encodeURIComponent(orderReference)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load order details.");
        setOrder(data.order);
        setItems(data.items ?? []);
        setPayments(data.payments ?? []);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load order details.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadOrder();
    return () => controller.abort();
  }, [orderReference]);

  return <div className="mx-auto w-full max-w-[1400px]">
    <Link href="/admin/orders" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted hover:text-primary"><PublicIcon name="left" className="h-3.5 w-3.5" /> Back to orders</Link>
    {loading && <p className="py-12 text-center text-sm text-muted">Loading order details…</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-status-danger">{error}</p>}
    {order && <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Order details</p><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{order.orderNumber}</h1><p className="mt-1 text-sm text-muted">Created {new Date(order.createdAt).toLocaleString()}</p></div>
        <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
      </header>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Buyer</CardTitle></CardHeader><CardContent><p className="font-semibold text-heading">{order.buyerName}</p><p className="mt-1 text-sm text-muted">{order.buyerEmail}</p></CardContent></Card>
        <Card><CardHeader><CardTitle>Order total</CardTitle></CardHeader><CardContent><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(order.subtotal, order.currency)}</dd></div><div className="flex justify-between"><dt className="text-muted">Discount</dt><dd>-{money(order.discountAmount, order.currency)}</dd></div><div className="flex justify-between"><dt className="text-muted">Tax</dt><dd>{money(order.taxAmount, order.currency)}</dd></div><div className="flex justify-between border-t border-divider pt-2 font-semibold"><dt>Total</dt><dd>{money(order.totalAmount, order.currency)}</dd></div></dl></CardContent></Card>
        <Card><CardHeader><CardTitle>Payment attempts</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-heading">{payments.length}</p><p className="mt-1 text-xs text-muted">Provider transactions on this order</p></CardContent></Card>
      </div>
      <Card className="mt-5"><CardHeader><CardTitle>Purchased items</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wide text-muted"><tr>{["Product", "Creator", "Storefront", "Qty", "Unit price", "Discount", "Total"].map((item) => <th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={`${item.productName}-${index}`} className="border-t border-divider"><td className="px-3 py-3 font-medium">{item.productName}</td><td className="px-3 py-3">{item.creatorName}<span className="block text-[10px] text-muted">{item.creatorEmail}</span></td><td className="px-3 py-3">{item.storefrontName}</td><td className="px-3 py-3">{item.quantity}</td><td className="px-3 py-3">{money(item.unitPrice, order.currency)}</td><td className="px-3 py-3">{money(item.discountAmount, order.currency)}</td><td className="px-3 py-3">{money(item.totalAmount, order.currency)}</td></tr>)}</tbody></table>{items.length === 0 && <p className="py-8 text-center text-sm text-muted">No items were returned for this order.</p>}</div></CardContent></Card>
      <Card className="mt-5"><CardHeader><CardTitle>Transactions</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wide text-muted"><tr>{["Provider", "Transaction ID", "Amount", "Status", "Created", "Paid"].map((item) => <th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody>{payments.map((payment, index) => <tr key={`${payment.transactionId}-${index}`} className="border-t border-divider"><td className="px-3 py-3">{payment.provider}</td><td className="px-3 py-3">{payment.transactionId || "—"}</td><td className="px-3 py-3">{money(payment.amount, payment.currency)}</td><td className="px-3 py-3"><Badge tone={statusTone(payment.status)}>{statusLabel(payment.status)}</Badge></td><td className="px-3 py-3">{new Date(payment.createdAt).toLocaleString()}</td><td className="px-3 py-3">{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "—"}</td></tr>)}</tbody></table>{payments.length === 0 && <p className="py-8 text-center text-sm text-muted">No payment transactions were returned for this order.</p>}</div></CardContent></Card>
    </>}
  </div>;
}

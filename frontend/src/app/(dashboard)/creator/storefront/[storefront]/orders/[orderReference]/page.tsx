"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type CreatorOrderDetails = {
  id: number;
  orderNumber: string;
  status: string;
  currency: string;
  createdAt: string;
  buyerName: string;
  buyerEmail: string;
  salesAmount: number | string;
};
type Item = { id: number; productName: string; quantity: number; unitPrice: number | string; totalAmount: number | string };
type Payment = { provider: string; transactionId: string | null; amount: number | string; currency: string; status: string; paidAt: string | null };

function money(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
}

function title(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CreatorOrderDetailsPage() {
  const params = useParams<{ storefront: string; orderReference: string }>();
  const storefrontName = String(params.storefront || "");
  const orderReference = String(params.orderReference || "");
  const [order, setOrder] = useState<CreatorOrderDetails | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");
        const response = await fetch(
          `${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}/orders/${encodeURIComponent(orderReference)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load this order.");
        setOrder(data.order);
        setItems(data.items || []);
        setPayments(data.payments || []);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Unable to load this order.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [orderReference, storefrontName]);

  if (loading) return <p className="px-5 py-8 text-sm text-muted">Loading order details...</p>;
  if (error || !order) return <div className="px-5 py-8"><p role="alert" className="text-sm text-status-danger">{error || "Order not found."}</p><Link href={`/creator/storefront/${encodeURIComponent(storefrontName)}/orders`} className="mt-4 inline-block text-sm font-semibold text-primary">Back to orders</Link></div>;

  return (
    <div className="mx-auto w-full max-w-[1000px]">
      <Link href={`/creator/storefront/${encodeURIComponent(storefrontName)}/orders`} className="text-xs font-semibold text-primary">← Sales orders</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight text-heading">Order {order.orderNumber}</h1><p className="mt-1 text-xs text-muted">Placed {new Date(order.createdAt).toLocaleString()}</p></div><Badge tone={order.status === "completed" || order.status === "paid" ? "success" : order.status === "pending" || order.status === "partially_refunded" ? "warning" : "danger"}>{title(order.status)}</Badge></div>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <h2 className="border-b border-divider px-5 py-4 text-sm font-bold text-heading">Customer and storefront items</h2>
        <div className="grid gap-3 border-b border-divider px-5 py-4 text-xs sm:grid-cols-2"><p><span className="font-semibold">Buyer:</span> {order.buyerName}</p><p><span className="font-semibold">Email:</span> {order.buyerEmail}</p><p><span className="font-semibold">Storefront sales:</span> {money(order.salesAmount, order.currency)}</p></div>
        {items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-divider px-5 py-4 last:border-b-0"><div><p className="text-xs font-semibold text-body">{item.productName}</p><p className="mt-1 text-[10px] text-muted">Quantity {item.quantity} · {money(item.unitPrice, order.currency)} each</p></div><p className="text-xs font-bold text-heading">{money(item.totalAmount, order.currency)}</p></div>)}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <h2 className="border-b border-divider px-5 py-4 text-sm font-bold text-heading">Payment and refund history</h2>
        {payments.map((payment, index) => <div key={`${payment.transactionId || payment.provider}-${index}`} className="flex flex-col gap-2 border-b border-divider px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold text-body">{payment.provider} · {title(payment.status)}</p><p className="mt-1 break-all text-[10px] text-muted">{payment.transactionId || "No provider reference"} · {payment.paidAt ? new Date(payment.paidAt).toLocaleString() : "Not paid"}</p></div><p className="text-xs font-bold text-heading">{money(payment.amount, payment.currency)} storefront sales</p></div>)}
        {payments.length === 0 && <p className="px-5 py-5 text-xs text-muted">No payment attempts recorded.</p>}
      </section>
    </div>
  );
}

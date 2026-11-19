const apiUrl = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ?? "http://localhost:5000/api";

export type PayWayPaymentOption = "abapay_khqr" | "abapay_khqr_deeplink" | "cards";

export type PayWayOrderResponse = {
  paymentProvider: string;
  paymentOption?: PayWayPaymentOption;
  tran_id?: string;
  paymentReference: string;
  statusCode?: string;
  statusMessage?: string;
  lifetimeMinutes?: number;
  expiresAt?: string;
  qrString?: string | null;
  qrImage?: string | null;
  deeplink?: string | null;
  checkoutQrUrl?: string | null;
  formUrl?: string | null;
  fields?: Record<string, string> | null;
};

export type PayWayPaymentStatus = {
  tran_id: string;
  paymentReference: string;
  orderId: number;
  status: string;
  paymentOption?: PayWayPaymentOption;
  expiresAt?: string;
  amount?: number;
  currency?: string;
};

export async function createPayWayOrder(
  orderId: number,
  token: string,
  paymentOption: PayWayPaymentOption = "abapay_khqr_deeplink",
): Promise<PayWayOrderResponse> {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Authorization", ["Bearer", token].join(" "));
  const response = await fetch(`${apiUrl}/payments/payway/order`, {
    method: "POST",
    headers,
    body: JSON.stringify({ orderId, paymentOption }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to start ABA PayWay checkout.");
  return data;
}

export async function getPayWayPaymentStatus(paymentReference: string, token: string): Promise<PayWayPaymentStatus> {
  const headers = new Headers();
  headers.set("Authorization", ["Bearer", token].join(" "));
  const response = await fetch(`${apiUrl}/payments/payway/status/${encodeURIComponent(paymentReference)}`, {
    headers,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to check ABA PayWay payment.");
  return data;
}

export async function capturePayWayOrder(paymentReference: string, token: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Authorization", ["Bearer", token].join(" "));
  const response = await fetch(`${apiUrl}/payments/payway/capture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reference: paymentReference }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to verify ABA PayWay payment.");
  return data;
}

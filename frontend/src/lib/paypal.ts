const apiUrl = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ?? "http://localhost:5000/api";

type PayPalOrderResponse = {
  paypalOrderId: string;
  approvalUrl: string | null;
};

export type SavedPayPalCard = {
  id: number;
  brand: string | null;
  lastDigits: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
};

async function readResponse(response: Response, fallbackMessage: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

export async function getSavedPayPalCards(token: string): Promise<SavedPayPalCard[]> {
  const response = await fetch(`${apiUrl}/payments/paypal/saved-cards`, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  const data = await readResponse(response, "Saved cards could not be loaded.");
  return Array.isArray(data.cards) ? data.cards : [];
}

export async function setDefaultPayPalCard(cardId: number, token: string): Promise<void> {
  const response = await fetch(`${apiUrl}/payments/paypal/saved-cards/${cardId}/default`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token },
  });
  await readResponse(response, "Default card could not be updated.");
}

export async function deleteSavedPayPalCard(
  cardId: number,
  token: string,
): Promise<{ defaultCardId: number | null }> {
  const response = await fetch(`${apiUrl}/payments/paypal/saved-cards/${cardId}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  const data = await readResponse(response, "Saved card could not be removed.");
  return { defaultCardId: data.defaultCardId ? Number(data.defaultCardId) : null };
}

export async function createPayPalOrder(
  orderId: number,
  token: string,
  options: { saveCard: boolean; cardFields: boolean; savedCardId?: number },
): Promise<PayPalOrderResponse> {
  const response = await fetch(`${apiUrl}/payments/paypal/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ orderId, ...options }),
  });
  return readResponse(response, "Unable to start PayPal sandbox checkout.");
}

export async function startPayPalCheckout(orderId: number) {
  if (typeof window === "undefined") throw new Error("PayPal checkout must start in the browser.");
  const token = window.localStorage.getItem("marketplace-token");
  if (!token) throw new Error("Please sign in before checkout.");

  const order = await createPayPalOrder(orderId, token, { saveCard: false, cardFields: false });
  if (!order.approvalUrl) throw new Error("PayPal did not provide a sandbox checkout link.");
  window.location.assign(order.approvalUrl);
}

export async function capturePayPalOrder(paypalOrderId: string, token: string) {
  const response = await fetch(`${apiUrl}/payments/paypal/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ paypalOrderId }),
  });
  return readResponse(response, "Unable to verify PayPal sandbox payment.");
}

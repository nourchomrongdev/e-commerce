const PAYPAL_DEFAULT_BASE_URL = "https://api-m.sandbox.paypal.com";
const PAYOUTS_SCOPE = "https://uri.paypal.com/services/payments/payouts";

type PayPalPayoutError = Error & { statusCode?: number; details?: Record<string, unknown> };

function getPayPalPayoutConfiguration() {
  const baseUrl = String(process.env.PAYPAL_API_BASE_URL || PAYPAL_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const environment = String(process.env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase();
  let validBaseUrl = false;

  try {
    const url = new URL(baseUrl);
    validBaseUrl = url.protocol === "https:" && (
      (environment === "sandbox" && url.hostname === "api-m.sandbox.paypal.com")
      || (environment === "live" && url.hostname === "api-m.paypal.com")
    );
  } catch {
    validBaseUrl = false;
  }

  const enabled = String(process.env.PAYPAL_PAYOUTS_ENABLED || "").toLowerCase() === "true";
  const configured = enabled
    && Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
    && validBaseUrl;

  return {
    configured,
    enabled,
    environment,
    baseUrl,
    webhookId: String(process.env.PAYPAL_PAYOUTS_WEBHOOK_ID || "").trim(),
  };
}

function createPayPalError(message: string, statusCode: number, details?: Record<string, unknown>) {
  const error = new Error(message) as PayPalPayoutError;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

async function readPayPalJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw createPayPalError("PayPal returned an invalid response.", response.status || 502);
  }
}

async function getAccessToken() {
  const config = getPayPalPayoutConfiguration();
  if (!config.configured) {
    throw createPayPalError(
      "PayPal Payouts is disabled or not configured. Set PAYPAL_PAYOUTS_ENABLED=true and valid PayPal API credentials locally.",
      503,
    );
  }

  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await readPayPalJson(response);
  if (!response.ok || !data.access_token) {
    throw createPayPalError("PayPal Payouts authentication failed.", response.status || 502, data);
  }
  const scopes = String(data.scope || "").split(/\s+/);
  if (scopes.length && !scopes.includes(PAYOUTS_SCOPE)) {
    throw createPayPalError("The PayPal app is missing the Payouts API permission.", 403);
  }
  return data.access_token as string;
}

async function paypalPayoutRequest(path: string, options: { method?: string; body?: unknown; requestId?: string } = {}) {
  const config = getPayPalPayoutConfiguration();
  const accessToken = await getAccessToken();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.requestId ? { "PayPal-Request-Id": options.requestId } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await readPayPalJson(response);
  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : "PayPal Payouts request failed.";
    throw createPayPalError(message, response.status, data);
  }
  return data;
}

function makeSenderBatchId(payoutId: number | string, retryCount = 0) {
  return `KD${String(payoutId)}${retryCount ? `R${retryCount}` : ""}`.slice(0, 30);
}

function makeRequestId(payoutId: number | string, retryCount = 0) {
  return `kd-payout-${String(payoutId)}-${retryCount}`;
}

async function createPayoutBatch({
  payoutId,
  retryCount,
  recipientEmail,
  amount,
  currency,
}: {
  payoutId: number | string;
  retryCount?: number;
  recipientEmail: string;
  amount: string;
  currency: string;
}) {
  const normalizedAmount = String(amount || "").trim();
  if (!/^(0|[1-9]\d*)\.\d{2}$/.test(normalizedAmount) || /^0\.00$/.test(normalizedAmount)) {
    throw createPayPalError("The payout amount must be a positive two-decimal amount.", 400);
  }
  if (String(currency).toUpperCase() !== "USD") {
    throw createPayPalError("PayPal creator payouts are currently restricted to USD.", 400);
  }
  const email = String(recipientEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createPayPalError("A valid PayPal recipient email is required.", 400);
  }

  const id = String(payoutId || "");
  if (!/^[1-9]\d*$/.test(id)) {
    throw createPayPalError("A valid payout ID is required.", 400);
  }

  const retry = Math.max(0, Number(retryCount) || 0);
  const requestId = makeRequestId(id, retry);
  const result = await paypalPayoutRequest("/v1/payments/payouts", {
    method: "POST",
    requestId,
    body: {
      sender_batch_header: {
        sender_batch_id: makeSenderBatchId(id, retry),
        email_subject: "Your KhmerDigital creator payout",
        email_message: "Your eligible creator earnings are being sent.",
      },
      items: [{
        recipient_type: "EMAIL",
        receiver: email,
        amount: { value: normalizedAmount, currency: "USD" },
        note: `Creator earnings payout ${id}`,
        sender_item_id: `P${id}`.slice(0, 30),
      }],
    },
  });

  return {
    requestId,
    batchId: result.batch_header?.payout_batch_id || null,
    batchStatus: result.batch_header?.batch_status || null,
    itemId: result.items?.[0]?.payout_item_id || null,
    itemStatus: result.items?.[0]?.transaction_status || null,
    response: result,
  };
}

async function getPayoutBatch(batchId: string) {
  if (!String(batchId || "").trim()) throw createPayPalError("A PayPal payout batch ID is required.", 400);
  return paypalPayoutRequest(`/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=100`);
}

async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown) {
  const config = getPayPalPayoutConfiguration();
  if (!config.configured || !config.webhookId) {
    throw createPayPalError("PayPal payout webhook verification is not configured.", 503);
  }

  const value = (name: string) => {
    const header = headers[name];
    return Array.isArray(header) ? header[0] : header;
  };
  const transmissionId = value("paypal-transmission-id");
  const transmissionTime = value("paypal-transmission-time");
  const transmissionSig = value("paypal-transmission-sig");
  const certUrl = value("paypal-cert-url");
  const authAlgo = value("paypal-auth-algo");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) return false;

  const result = await paypalPayoutRequest("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: config.webhookId,
      webhook_event: event,
    },
  });
  return result.verification_status === "SUCCESS";
}

function getPayoutsConfigurationStatus() {
  const config = getPayPalPayoutConfiguration();
  return {
    enabled: config.enabled,
    configured: config.configured,
    webhookConfigured: config.configured && Boolean(config.webhookId),
    environment: config.environment,
  };
}

module.exports = {
  createPayoutBatch,
  getPayoutBatch,
  verifyWebhook,
  getPayoutsConfigurationStatus,
};

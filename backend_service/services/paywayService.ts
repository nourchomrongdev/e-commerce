const crypto = require("crypto");

type PayWayError = Error & { statusCode?: number; providerCode?: string; debugId?: string };
type PayWayResponseStatus = {
  code?: string | number;
  message?: string;
  tran_id?: string;
  trace_id?: string;
};
type PayWayResponse = {
  status?: PayWayResponseStatus;
  data?: PayWayResponse;
  code?: string | number;
  message?: string;
  description?: string;
  trace_id?: string;
  tran_id?: string;
  qrString?: string;
  qr_string?: string;
  qrImage?: string;
  qr_image?: string;
  abapay_deeplink?: string;
  abapayDeeplink?: string;
  checkout_qr_url?: string;
  checkoutQrUrl?: string;
  payment_status_code?: string | number;
  payment_status?: string;
  total_amount?: string | number;
  payment_amount?: string | number;
  payment_currency?: string;
};
type PayWayItem = { name?: string; quantity?: number; price?: number };
type PayWayPaymentOption = "abapay_khqr" | "abapay_khqr_deeplink" | "cards";
type PayWayPurchaseInput = {
  amount: number | string;
  currency?: string;
  referenceId: string;
  paymentOption?: PayWayPaymentOption;
  description?: string;
  returnUrl?: string;
  cancelUrl?: string;
  continueSuccessUrl?: string;
  buyerEmail?: string | null;
  buyerFirstName?: string;
  buyerLastName?: string;
  buyerPhone?: string;
  items?: PayWayItem[];
};
type PayWayPurchaseRequest = {
  formUrl: string;
  fields: Record<string, string>;
  referenceId: string;
  paymentOption: PayWayPaymentOption;
  lifetimeMinutes: number;
  expiresAt: string;
};

const DEFAULT_PURCHASE_ENDPOINT =
  "https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase";
const STATUS_PATH = "/payments/check-transaction-2";
const PURCHASE_PATH_PATTERN = /\/payments\/purchase\/?$/;
const STATUS_REQUEST_TIMEOUT_MS = 15_000;
const PURCHASE_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PAYWAY_LIFETIME_MINUTES = 5;
const MAX_PAYWAY_LIFETIME_MINUTES = 30 * 24 * 60;
const SUPPORTED_CURRENCIES = new Set(["USD", "KHR"]);
const SIGNED_PURCHASE_FIELDS = [
  "req_time",
  "merchant_id",
  "tran_id",
  "amount",
  "items",
  "shipping",
  "firstname",
  "lastname",
  "email",
  "phone",
  "type",
  "payment_option",
  "return_url",
  "cancel_url",
  "continue_success_url",
  "return_deeplink",
  "currency",
  "custom_fields",
  "return_params",
  "payout",
  "lifetime",
  "additional_params",
  "google_pay_token",
  "skip_success_page",
];

function createPayWayError(
  message: string,
  statusCode: number,
  providerCode?: string,
  debugId?: string,
): PayWayError {
  const error = new Error(message) as PayWayError;
  error.statusCode = statusCode;
  if (providerCode) error.providerCode = providerCode;
  if (debugId) error.debugId = debugId;
  return error;
}

async function postForJson(
  url: URL | string,
  body: FormData | string,
  timeoutMs: number,
  connectionErrorMessage: string,
  responseErrorMessage: string,
): Promise<{ response: Response; data: PayWayResponse }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: typeof body === "string" ? { "Content-Type": "application/json" } : undefined,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw createPayWayError(connectionErrorMessage, 502);
  }

  try {
    return { response, data: await response.json() as PayWayResponse };
  } catch {
    throw createPayWayError(responseErrorMessage, 502);
  }
}

function getPayWayConfig() {
  const endpoint = String(
    process.env.ABAPAYWAY_API_URL ||
      process.env.PAYWAY_API_URL ||
      DEFAULT_PURCHASE_ENDPOINT,
  ).trim();
  const environment = String(process.env.PAYWAY_ENVIRONMENT || process.env.ABAPAYWAY_ENVIRONMENT || "sandbox").toLowerCase();

  return {
    merchantId: String(process.env.ABAPAYWAY_MERCHANT_ID || process.env.PAYWAY_MERCHANT_ID || "").trim(),
    apiKey: String(process.env.ABAPAYWAY_API_KEY || process.env.PAYWAY_API_KEY || "").trim(),
    secretKey: String(process.env.ABAPAYWAY_SECRET_KEY || process.env.PAYWAY_SECRET_KEY || "").trim(),
    endpoint,
    environment,
  };
}

function getPayWayConfigurationStatus() {
  const config = getPayWayConfig();
  let endpointIsValid = false;
  try {
    const endpoint = new URL(config.endpoint);
    endpointIsValid =
      endpoint.protocol === "https:" &&
      endpoint.pathname.endsWith("/api/payment-gateway/v1/payments/purchase") &&
      (config.environment !== "sandbox" || endpoint.hostname.includes("sandbox"));
  } catch {
    endpointIsValid = false;
  }

  const configured = Boolean(config.merchantId && config.apiKey && endpointIsValid && config.environment === "sandbox");
  return {
    configured,
    environment: config.environment,
    message: configured
      ? "ABA PayWay sandbox settings are present; PayWay will validate the merchant credentials during checkout."
      : "ABA PayWay sandbox is unavailable. Check ABAPAYWAY_MERCHANT_ID, ABAPAYWAY_API_KEY, PAYWAY_ENVIRONMENT=sandbox, and the sandbox purchase URL in backend_service/.env, then restart the backend.",
  };
}

function requirePayWayConfig() {
  const status = getPayWayConfigurationStatus();
  if (!status.configured) {
    throw createPayWayError(status.message, 503);
  }
  return getPayWayConfig();
}

function getPayWayLifetimeMinutes() {
  const lifetimeMinutes = Number(process.env.PAYWAY_LIFETIME_MINUTES || DEFAULT_PAYWAY_LIFETIME_MINUTES);
  if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes < 3 || lifetimeMinutes > MAX_PAYWAY_LIFETIME_MINUTES) {
    throw createPayWayError("PAYWAY_LIFETIME_MINUTES must be a whole number between 3 and 43200.", 400);
  }
  return lifetimeMinutes;
}

function encodeBase64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function formatPayWayRequestTime(date: Date) {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function signPayload(fields: Record<string, string>, apiKey: string) {
  const message = SIGNED_PURCHASE_FIELDS.map((name) => fields[name] || "").join("");
  return crypto.createHmac("sha512", apiKey).update(message).digest("base64");
}

function getTransactionStatusEndpoint(purchaseEndpoint: string) {
  const endpoint = new URL(purchaseEndpoint);
  endpoint.pathname = endpoint.pathname.replace(PURCHASE_PATH_PATTERN, STATUS_PATH);
  return endpoint;
}

async function checkABAPayWayTransaction(referenceId: string) {
  const config = requirePayWayConfig();
  const endpoint = getTransactionStatusEndpoint(config.endpoint);
  const reqTime = formatPayWayRequestTime(new Date());
  const payload = {
    req_time: reqTime,
    merchant_id: config.merchantId,
    tran_id: referenceId,
    hash: crypto
      .createHmac("sha512", config.apiKey)
      .update(`${reqTime}${config.merchantId}${referenceId}`)
      .digest("base64"),
  };

  const { response, data: result } = await postForJson(
    endpoint,
    JSON.stringify(payload),
    STATUS_REQUEST_TIMEOUT_MS,
    "Could not check the ABA PayWay Sandbox transaction.",
    "ABA PayWay returned an invalid transaction status response.",
  );

  const resultData = result?.data || result;
  const statusCode = String(resultData?.status?.code ?? result?.status?.code ?? "");
  if (!response.ok || statusCode !== "00") {
    const providerCode = statusCode || String(response.status);
    throw createPayWayError(
      String(resultData?.status?.message || result?.status?.message || "ABA PayWay could not verify the transaction."),
      providerCode === "6" ? 404 : 502,
      providerCode,
      String(resultData?.status?.trace_id || result?.status?.trace_id || ""),
    );
  }

  return {
    paymentStatusCode: String(resultData.payment_status_code ?? ""),
    paymentStatus: String(resultData.payment_status || "").toUpperCase(),
    totalAmount: Number(resultData.total_amount),
    paymentAmount: Number(resultData.payment_amount),
    paymentCurrency: String(resultData.payment_currency || "").toUpperCase(),
  };
}

function createABAPayWayPayment({
  amount,
  currency,
  referenceId,
  paymentOption = "abapay_khqr_deeplink",
  description,
  returnUrl,
  cancelUrl,
  continueSuccessUrl,
  buyerEmail,
  buyerFirstName,
  buyerLastName,
  buyerPhone,
  items,
}: PayWayPurchaseInput): PayWayPurchaseRequest {
  const config = requirePayWayConfig();
  const lifetimeMinutes = getPayWayLifetimeMinutes();
  const requestTime = new Date();
  const amountValue = Number(amount);
  const normalizedCurrency = String(currency || "USD").toUpperCase();
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    throw createPayWayError("ABA PayWay requires a positive order total.", 400);
  }
  if (!SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
    throw createPayWayError("ABA PayWay supports USD and KHR orders only.", 400);
  }
  if (
    paymentOption !== "abapay_khqr" &&
    paymentOption !== "abapay_khqr_deeplink" &&
    paymentOption !== "cards"
  ) {
    throw createPayWayError("ABA PayWay payment option is not supported.", 400);
  }

  const returnTarget =
    returnUrl ||
    process.env.PAYWAY_NOTIFY_URL ||
    process.env.PAYWAY_RETURN_URL ||
    process.env.ABAPAYWAY_RETURN_URL ||
    "http://localhost:5000/api/payments/payway/capture";
  const successTarget =
    continueSuccessUrl ||
    process.env.PAYWAY_SUCCESS_URL ||
    process.env.FRONTEND_URL && `${process.env.FRONTEND_URL}/cart/payment` ||
    "http://localhost:3000/cart/payment";
  const fields: Record<string, string> = {
    req_time: formatPayWayRequestTime(requestTime),
    merchant_id: config.merchantId,
    tran_id: String(referenceId),
    firstname: String(buyerFirstName || "Marketplace").slice(0, 100),
    lastname: String(buyerLastName || "Buyer").slice(0, 100),
    email: String(buyerEmail || "").slice(0, 50),
    phone: String(buyerPhone || "").slice(0, 20),
    type: "purchase",
    payment_option: paymentOption,
    items: encodeBase64(JSON.stringify(
      Array.isArray(items) && items.length
        ? items.map((item) => ({
            name: String(item.name || description || "Digital product").slice(0, 100),
            quantity: Number(item.quantity || 1),
            price: Number(item.price || 0),
          }))
        : [{ name: String(description || "Digital product").slice(0, 100), quantity: 1, price: amountValue }],
    )),
    shipping: "0",
    amount: amountValue.toFixed(2),
    currency: normalizedCurrency,
    return_url: encodeBase64(returnTarget),
    cancel_url: cancelUrl || process.env.PAYWAY_CANCEL_URL || process.env.ABAPAYWAY_CANCEL_URL || "http://localhost:3000/cart/payment",
    continue_success_url: successTarget,
    lifetime: String(lifetimeMinutes),
    skip_success_page: paymentOption === "cards" ? "1" : "0",
  };
  fields.hash = signPayload(fields, config.apiKey);

  return {
    formUrl: config.endpoint,
    fields,
    referenceId: fields.tran_id,
    paymentOption,
    lifetimeMinutes,
    expiresAt: new Date(Math.floor(requestTime.getTime() / 1000) * 1000 + lifetimeMinutes * 60_000).toISOString(),
  };
}

async function submitABAPayWayPayment(paymentRequest: PayWayPurchaseRequest) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(paymentRequest.fields)) {
    formData.append(name, value);
  }

  const { response, data } = await postForJson(
    paymentRequest.formUrl,
    formData,
    PURCHASE_REQUEST_TIMEOUT_MS,
    "Could not connect to ABA PayWay Sandbox.",
    "ABA PayWay did not return a valid QR checkout response.",
  );

  const status = data?.status || {};
  const statusCode = String(status.code ?? data?.code ?? "");
  const qrString = String(data?.qrString || data?.qr_string || "");
  const qrImage = String(data?.qrImage || data?.qr_image || "");
  const imageIsSafe = /^data:image\/(?:png|jpeg|webp);base64,/i.test(qrImage);
  if (!response.ok || statusCode !== "00" || (!qrString && !imageIsSafe)) {
    throw createPayWayError(
      String(status.message || data?.message || "ABA PayWay could not create the QR checkout."),
      502,
      statusCode || String(response.status),
      String(status.trace_id || data?.trace_id || ""),
    );
  }

  const providerTransactionId = String(status.tran_id || data?.tran_id || paymentRequest.referenceId).trim();
  if (providerTransactionId !== paymentRequest.referenceId) {
    throw createPayWayError(
      "ABA PayWay returned a transaction ID that does not match the purchase request.",
      502,
      statusCode,
      String(status.trace_id || data?.trace_id || ""),
    );
  }

  return {
    statusCode,
    statusMessage: String(status.message || data?.description || "Success"),
    tran_id: providerTransactionId,
    paymentReference: providerTransactionId,
    paymentOption: paymentRequest.paymentOption,
    lifetimeMinutes: paymentRequest.lifetimeMinutes,
    expiresAt: paymentRequest.expiresAt,
    qrString,
    qrImage: imageIsSafe ? qrImage : null,
    deeplink: String(data?.abapay_deeplink || data?.abapayDeeplink || ""),
    checkoutQrUrl: String(data?.checkout_qr_url || data?.checkoutQrUrl || ""),
  };
}

function verifyABAPayWayCallback(payload: Record<string, unknown>, signature?: string) {
  const config = getPayWayConfig();
  const providedSignature = String(signature || payload.hash || "").trim();
  if (!config.secretKey || !providedSignature) {
    return { valid: false };
  }

  const callbackFields = Object.entries(payload)
    .filter(([name]) => !["hash", "signature"].includes(name.toLowerCase()))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const message = callbackFields
    .map(([, value]) => (value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)))
    .join("");
  const expectedSignature = crypto.createHmac("sha512", config.secretKey).update(message).digest("base64");
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);
  return {
    valid: expected.length === provided.length && crypto.timingSafeEqual(expected, provided),
  };
}

module.exports = {
  createABAPayWayPayment,
  submitABAPayWayPayment,
  checkABAPayWayTransaction,
  verifyABAPayWayCallback,
  getPayWayConfigurationStatus,
};

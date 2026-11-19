const { createHash, randomUUID } = require("crypto");
const paypalBaseUrl = process.env.PAYPAL_API_BASE_URL || "https://api-m.sandbox.paypal.com";
type PayPalRequestOptions = { method?: string; headers?: Record<string, string>; body?: string };
type PayPalError = Error & {
  statusCode?: number;
  details?: Record<string, unknown>;
  paypalRequest?: { method: string; endpoint: string; payload: unknown };
};

function getPayPalConfigurationStatus() {
  const environment = String(process.env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase();
  const hasCredentials = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  let isSandboxUrl = false;
  try {
    const apiUrl = new URL(paypalBaseUrl);
    isSandboxUrl = apiUrl.protocol === "https:" && apiUrl.hostname.endsWith(".sandbox.paypal.com");
  } catch {
    isSandboxUrl = false;
  }
  const configured = hasCredentials && environment === "sandbox" && isSandboxUrl;

  return {
    configured,
    environment,
    clientId: process.env.PAYPAL_CLIENT_ID || null,
    advancedCardPaymentsEnabled:
      configured && String(process.env.PAYPAL_ADVANCED_CARD_PAYMENTS_ENABLED || "").toLowerCase() === "true",
    message: configured
      ? String(process.env.PAYPAL_ADVANCED_CARD_PAYMENTS_ENABLED || "").toLowerCase() === "true"
        ? "PayPal Sandbox is configured. Advanced Card Payments and saved-card options are enabled."
        : "PayPal Sandbox is configured for card checkout. Saving and reusing cards requires Advanced Card Payments to be enabled in PayPal and PAYPAL_ADVANCED_CARD_PAYMENTS_ENABLED=true."
      : "PayPal sandbox is unavailable. Check PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENVIRONMENT=sandbox, and PAYPAL_API_BASE_URL in backend_service/.env, then restart the backend.",
  };
}

function requirePayPalConfig() {
  const status = getPayPalConfigurationStatus();
  if (!status.configured) {
    const error = new Error(status.message) as PayPalError;
    error.statusCode = 503;
    throw error;
  }
}

async function getAccessToken() {
  requirePayPalConfig();
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${paypalBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error_description || data?.message || `PayPal token request failed with status ${response.status}.`) as PayPalError;
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data.access_token;
}

function sanitizePayPalLogValue(value, key = "") {
  if (/^(authorization|access_token|client_secret|cvv|cvc|number|reference_id|security_code|vault_id|id)$/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePayPalLogValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizePayPalLogValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

function getPayPalRequestContext(path, options) {
  let payload = null;
  if (options.body) {
    try {
      payload = sanitizePayPalLogValue(JSON.parse(options.body));
    } catch {
      payload = "[UNPARSEABLE_BODY]";
    }
  }
  const safePath = path.replace(
    /^(\/v3\/vault\/payment-tokens)\/[^/?]+/,
    "$1/[REDACTED]",
  );
  return {
    method: String(options.method || "GET").toUpperCase(),
    endpoint: `${new URL(paypalBaseUrl).origin}${safePath}`,
    payload,
  };
}

async function paypalRequest(path: string, options: PayPalRequestOptions = {}) {
  const accessToken = await getAccessToken();
  const requestContext = getPayPalRequestContext(path, options);
  const response = await fetch(`${paypalBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || `PayPal request failed with status ${response.status}.`) as PayPalError;
    error.statusCode = response.status;
    error.details = data;
    error.paypalRequest = requestContext;
    throw error;
  }

  return data;
}

function createPayPalOrder({
  amount,
  currency,
  referenceId,
  attemptNumber = 1,
  saveCard = false,
  customerId = null,
  vaultId = null,
}) {
  const advancedCardPaymentsEnabled = getPayPalConfigurationStatus().advancedCardPaymentsEnabled;
  if ((vaultId || saveCard) && !advancedCardPaymentsEnabled) {
    const error = new Error("PayPal saved-card payments require Advanced Card Payments to be enabled and configured.") as PayPalError;
    error.statusCode = 503;
    throw error;
  }

  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (normalizedCurrency !== "USD") {
    const error = new Error("PayPal Checkout currently supports USD orders only.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }
  const amountString = String(amount ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amountString)) {
    const error = new Error("PayPal requires a positive order total with no more than two decimal places.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }
  const amountValue = Number(amountString);
  if (!Number.isFinite(amountValue) || amountValue <= 0 || !Number.isSafeInteger(Math.round(amountValue * 100))) {
    const error = new Error("PayPal requires a valid positive order total.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }
  const formattedAmount = (Math.round(amountValue * 100) / 100).toFixed(2);
  const normalizedReference = String(referenceId || "").trim();
  if (!normalizedReference || normalizedReference.length > 256) {
    const error = new Error("PayPal requires a valid order reference.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    const error = new Error("PayPal requires a valid payment attempt number.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }

  const paymentSource = advancedCardPaymentsEnabled && vaultId
    ? {
        card: {
          vault_id: vaultId,
          stored_credential: {
            payment_initiator: "CUSTOMER",
            payment_type: "ONE_TIME",
            usage: "SUBSEQUENT",
          },
        },
      }
    : advancedCardPaymentsEnabled && saveCard
    ? {
        card: {
          attributes: {
            vault: { store_in_vault: "ON_SUCCESS" },
            ...(customerId ? { customer: { id: customerId } } : {}),
          },
        },
      }
    : undefined;
  const requestId = `marketplace-${createHash("sha256")
    .update(`${normalizedReference}:${attemptNumber}`)
    .digest("hex")
    .slice(0, 24)}`;

  function getCheckoutUrl(envName, state) {
    const configuredUrl = process.env[envName];
    const frontendBaseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    let url;
    try {
      url = new URL(configuredUrl || "/cart/payment", frontendBaseUrl);
    } catch {
      const error = new Error(`${envName} must be a valid PayPal return URL.`) as PayPalError;
      error.statusCode = 503;
      throw error;
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      const error = new Error(`${envName} must be a valid HTTP(S) PayPal return URL.`) as PayPalError;
      error.statusCode = 503;
      throw error;
    }
    url.pathname = "/cart/payment";
    url.search = "";
    url.hash = "";
    url.searchParams.set("paypal", state);
    return url.toString();
  }

  return paypalRequest("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": requestId },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: normalizedReference,
        amount: { currency_code: normalizedCurrency, value: formattedAmount },
      }],
      ...(paymentSource ? { payment_source: paymentSource } : {}),
      application_context: {
        brand_name: "Digital Products Marketplace",
        user_action: "PAY_NOW",
        return_url: getCheckoutUrl("PAYPAL_RETURN_URL", "return"),
        cancel_url: getCheckoutUrl("PAYPAL_CANCEL_URL", "cancelled"),
      },
    }),
  });
}

function capturePayPalOrder(paypalOrderId) {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `marketplace-capture-${paypalOrderId}` },
    body: "{}",
  });
}

function getPayPalOrder(paypalOrderId) {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

function deletePayPalVaultToken(vaultId) {
  return paypalRequest(`/v3/vault/payment-tokens/${encodeURIComponent(vaultId)}`, {
    method: "DELETE",
  });
}

function getPayPalVaultToken(vaultId) {
  return paypalRequest(`/v3/vault/payment-tokens/${encodeURIComponent(vaultId)}`);
}

function requirePayPalVaultConfiguration() {
  if (!getPayPalConfigurationStatus().advancedCardPaymentsEnabled) {
    const error = new Error("PayPal Advanced Card Payments must be enabled to add a saved card.") as PayPalError;
    error.statusCode = 503;
    throw error;
  }
}

function createPayPalVaultSetupToken() {
  requirePayPalVaultConfiguration();
  return paypalRequest("/v3/vault/setup-tokens", {
    method: "POST",
    headers: { "PayPal-Request-Id": randomUUID() },
    body: JSON.stringify({ payment_source: { card: {} } }),
  });
}

function createPayPalVaultPaymentToken(setupTokenId) {
  requirePayPalVaultConfiguration();
  return paypalRequest("/v3/vault/payment-tokens", {
    method: "POST",
    headers: {
      "PayPal-Request-Id": createHash("sha256").update(String(setupTokenId)).digest("hex").slice(0, 32),
    },
    body: JSON.stringify({
      payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } },
    }),
  });
}

function normalizeCardNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidCardNumber(cardNumber) {
  const digits = normalizeCardNumber(cardNumber);
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function parseCardExpiry(cardExpiry) {
  const [expiryMonthRaw, expiryYearRaw] = String(cardExpiry || "").split("/");
  const expiryMonth = String(expiryMonthRaw || "").trim();
  const expiryYear = String(expiryYearRaw || "").trim();

  if (!/^\d{1,2}$/.test(expiryMonth) || Number(expiryMonth) < 1 || Number(expiryMonth) > 12) {
    return null;
  }

  const normalizedYear = expiryYear.length === 2 ? `20${expiryYear}` : expiryYear;
  if (!/^\d{4}$/.test(normalizedYear)) return null;

  const month = Number(expiryMonth);
  const year = Number(normalizedYear);
  const expiry = new Date(year, month, 0, 23, 59, 59, 999);
  const now = new Date();
  if (expiry.getTime() <= now.getTime()) return null;

  return { month, year, normalized: `${normalizedYear}-${String(month).padStart(2, "0")}` };
}

async function setupPaymentToken({ cardNumber, cardExpiry, cardCvc }) {
  if (!cardNumber || !cardExpiry || !cardCvc) {
    const error = new Error("Card number, expiry date, and CVV are required.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }

  const normalizedCardNumber = normalizeCardNumber(cardNumber);
  if (!isValidCardNumber(normalizedCardNumber)) {
    const error = new Error("Card number is invalid.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }

  const expiry = parseCardExpiry(cardExpiry);
  if (!expiry) {
    const error = new Error("Card expiry date is invalid or expired.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }

  if (!/^\d{3,4}$/.test(String(cardCvc).trim())) {
    const error = new Error("CVV is invalid.") as PayPalError;
    error.statusCode = 400;
    throw error;
  }

  return paypalRequest("/v3/vault/setup-tokens", {
    method: "POST",
    body: JSON.stringify({
      payment_source: {
        card: {
          number: normalizedCardNumber,
          expiry: expiry.normalized,
          security_code: String(cardCvc).trim(),
        },
      },
    }),
  });
}

module.exports = {
  createPayPalOrder,
  capturePayPalOrder,
  getPayPalOrder,
  deletePayPalVaultToken,
  getPayPalVaultToken,
  createPayPalVaultSetupToken,
  createPayPalVaultPaymentToken,
  setupPaymentToken,
  isValidCardNumber,
  parseCardExpiry,
  getPayPalConfigurationStatus,
};

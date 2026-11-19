export type CartItem = {
  id: string;
  quantity: number;
  licenseTypeId?: number;
  licenseName?: string;
  licensePrice?: number;
  allowRepurchase?: boolean;
};

export const CART_STORAGE_KEY = "marketplace-cart";
export const CART_UPDATED_EVENT = "marketplace-cart-updated";

export function readCart(): CartItem[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    const seenIds = new Set<string>();
    return parsed.reduce<CartItem[]>((items, item) => {
      if (
        typeof item?.id !== "string" ||
        !/^\d+$/.test(item.id) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        seenIds.has(item.id)
      ) {
        return items;
      }

      seenIds.add(item.id);
      items.push({
        id: item.id,
        quantity: 1,
        ...(Number.isSafeInteger(item.licenseTypeId) && item.licenseTypeId > 0
          ? { licenseTypeId: item.licenseTypeId }
          : {}),
        ...(typeof item.licenseName === "string" ? { licenseName: item.licenseName } : {}),
        ...(Number.isFinite(item.licensePrice) && item.licensePrice >= 0
          ? { licensePrice: item.licensePrice }
          : {}),
        ...(item.allowRepurchase === true ? { allowRepurchase: true } : {}),
      });
      return items;
    }, []);
  } catch {
    return [];
  }
}

export function addToCart(
  productId: string,
  license?: { id: number; name: string; price: number } | null,
  allowRepurchase = false,
) {
  const cart = readCart();
  const existing = cart.find((cartItem) => cartItem.id === productId);
  const nextCart = existing
    ? cart.map((cartItem) =>
        cartItem.id === productId
          ? {
              ...cartItem,
              quantity: 1,
              ...(allowRepurchase ? { allowRepurchase: true } : {}),
              ...(license
                ? {
                    licenseTypeId: license.id,
                    licenseName: license.name,
                    licensePrice: license.price,
                  }
                : {}),
            }
          : cartItem,
      )
    : [
        ...cart,
        {
          id: productId,
          quantity: 1,
          ...(allowRepurchase ? { allowRepurchase: true } : {}),
          ...(license
            ? {
                licenseTypeId: license.id,
                licenseName: license.name,
                licensePrice: license.price,
              }
            : {}),
        },
      ];

  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  return nextCart;
}

export function setCartItem(
  productId: string,
  license?: { id: number; name: string; price: number } | null,
  allowRepurchase = false,
) {
  const cart = readCart();
  const existing = cart.find((cartItem) => cartItem.id === productId);
  const licenseDetails = license
    ? {
        licenseTypeId: license.id,
        licenseName: license.name,
        licensePrice: license.price,
      }
    : {};
  const nextCart = existing
    ? cart.map((cartItem) =>
        cartItem.id === productId
          ? {
              ...cartItem,
              ...licenseDetails,
              ...(allowRepurchase ? { allowRepurchase: true } : {}),
            }
          : cartItem,
      )
    : [
        ...cart,
        {
          id: productId,
          quantity: 1,
          ...licenseDetails,
          ...(allowRepurchase ? { allowRepurchase: true } : {}),
        },
      ];

  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  return nextCart;
}

export function getCartCount(cart: CartItem[]) {
  return cart.reduce((total, item) => total + item.quantity, 0);
}

export function removeFromCart(id: string) {
  const nextCart = readCart().filter((item) => item.id !== id);
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  return nextCart;
}

export function clearCart() {
  window.localStorage.removeItem(CART_STORAGE_KEY);
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
}

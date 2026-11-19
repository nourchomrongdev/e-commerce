"use client";

import { useEffect, useState } from "react";
import { CART_UPDATED_EVENT, readCart } from "@/lib/cart";

export function useCartMembership(productId: string) {
  const [inCart, setInCart] = useState(false);

  useEffect(() => {
    const updateMembership = () => {
      setInCart(readCart().some((item) => item.id === productId));
    };

    updateMembership();
    window.addEventListener(CART_UPDATED_EVENT, updateMembership);
    window.addEventListener("storage", updateMembership);

    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, updateMembership);
      window.removeEventListener("storage", updateMembership);
    };
  }, [productId]);

  return inCart;
}

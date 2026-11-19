"use client";

import PublicIcon from "@/components/icons/PublicIcon";
import { addToCart, removeFromCart } from "@/lib/cart";
import { useCartMembership } from "@/hooks/useCartMembership";

type AddToCartButtonProps = {
  id: string;
  name: string;
  type: string;
  price: string;
  href: string;
};

export default function AddToCartButton({ id }: AddToCartButtonProps) {
  const inCart = useCartMembership(id);

  function handleAdd() {
    if (inCart) {
      removeFromCart(id);
      return;
    }
    addToCart(id);
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white ${inCart ? "bg-emerald-600 hover:bg-red-600" : "bg-primary hover:bg-primary-hover"}`}
    >
      <PublicIcon name={inCart ? "x" : "shopping-cart"} className="h-4 w-4" />
      {inCart ? "Remove from cart" : "Add to cart"}
    </button>
  );
}

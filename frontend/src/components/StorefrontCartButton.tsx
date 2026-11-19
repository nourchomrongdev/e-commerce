"use client";

import { useRouter } from "next/navigation";
import PublicIcon, { type PublicIconName } from "@/components/icons/PublicIcon";
import { addToCart, removeFromCart, setCartItem } from "@/lib/cart";
import { useCartMembership } from "@/hooks/useCartMembership";

type Props = {
  id: string;
  name: string;
  type: string;
  price: string;
  href: string;
  compact?: boolean;
  className?: string;
  label?: string;
  redirectTo?: string;
  iconName?: PublicIconName;
  license?: { id: number; name: string; price: number } | null;
};

export default function StorefrontCartButton({ id, name, compact = false, className = "", label, redirectTo, iconName = "shopping-cart", license }: Props) {
  const inCart = useCartMembership(id);
  const router = useRouter();

  function handleAdd() {
    if (inCart && !redirectTo) {
      removeFromCart(id);
      return;
    }
    if (inCart && redirectTo) {
      setCartItem(id, license);
      router.push(redirectTo);
      return;
    }
    addToCart(id, license);
    if (redirectTo) {
      router.push(redirectTo);
    }
  }
  const showInCart = inCart && !redirectTo;
  return <button type="button" onClick={handleAdd} aria-label={showInCart ? `Remove ${name} from cart` : `${label ?? "Add"} ${name}`} className={`${compact ? `absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-md ${showInCart ? "bg-emerald-600 text-white hover:bg-red-600" : "bg-white text-primary"} shadow-sm` : `flex w-full items-center justify-center gap-2 rounded-md ${showInCart ? "bg-emerald-600 hover:bg-red-600" : "bg-primary hover:bg-primary-hover"} px-4 py-3 text-xs font-bold text-white`} ${className}`}>
    <PublicIcon name={showInCart ? "x" : iconName} className="h-3.5 w-3.5" />
    {!compact && (showInCart ? "Remove from Cart" : label ?? "Add to Cart")}
  </button>;
}

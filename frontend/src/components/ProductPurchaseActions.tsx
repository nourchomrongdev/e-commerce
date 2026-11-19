"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ProductOwnerNotice from "@/components/ProductOwnerNotice";
import ProductLicenseDialog from "@/components/ProductLicenseDialog";
import PublicIcon from "@/components/icons/PublicIcon";
import { useCartMembership } from "@/hooks/useCartMembership";
import { usePurchaseEligibility } from "@/hooks/usePurchaseEligibility";
import { addToCart, removeFromCart, setCartItem } from "@/lib/cart";
import type { ProductLicense } from "@/lib/marketplace";

type Props = {
  id: string;
  name: string;
  type: string;
  isFree: boolean;
  currency: string;
  thumbnailUrl?: string | null;
  description?: string;
  version?: string | null;
  licenses?: ProductLicense[];
};

export default function ProductPurchaseActions({
  id,
  name,
  type,
  isFree,
  currency,
  thumbnailUrl,
  description = "",
  version,
  licenses = [],
}: Props) {
  const eligibility = usePurchaseEligibility(id);
  const inCart = useCartMembership(id);
  const router = useRouter();
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [freeAccessing, setFreeAccessing] = useState(false);

  const handleFreeAccess = async () => {
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) {
      router.push("/login");
      return;
    }

    try {
      setFreeAccessing(true);
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api"}/orders/free`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ productId: Number(id) }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Unable to grant free access.");
      }

      router.push("/buyer/downloads");
    } catch (error) {
      console.error("Free access failed", error);
      window.alert(error instanceof Error ? error.message : "Unable to grant free access");
    } finally {
      setFreeAccessing(false);
    }
  };

  if (eligibility === "checking") {
    return (
      <p className="w-full max-w-[280px] text-xs text-muted" role="status">
        Checking purchase availability...
      </p>
    );
  }

  if (eligibility === "blocked") {
    return <ProductOwnerNotice />;
  }

  if (eligibility === "error") {
    return (
      <p className="w-full max-w-[280px] text-xs text-red-600" role="alert">
        Could not verify purchase availability. Refresh the page and try again.
      </p>
    );
  }

  if (isFree) {
    return (
      <div className="w-[220px] max-w-full shrink-0">
        <div className="flex flex-col gap-2 [&>button]:mt-0">
          <button
            type="button"
            onClick={() => void handleFreeAccess()}
            disabled={freeAccessing || eligibility === "purchased"}
            aria-describedby={eligibility === "purchased" ? "owned-product-message" : undefined}
            className="flex h-11 w-full flex-none items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 text-xs font-bold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PublicIcon name={eligibility === "purchased" ? "check" : "shopping-cart-plus"} className="h-4 w-4" />
            {freeAccessing
              ? "Getting access..."
              : eligibility === "purchased"
                ? "Already owned"
                : "Get free access"}
          </button>
          {eligibility === "purchased" && (
            <p id="owned-product-message" className="text-center text-[10px] leading-4 text-muted">
              You already have this product.{" "}
              <Link href="/buyer/downloads" className="font-semibold text-primary no-underline hover:underline">
                Go to My Downloads
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  const addSelectedLicense = (license: ProductLicense | null) => {
    if (inCart) {
      setCartItem(id, license, eligibility === "purchased");
    } else {
      addToCart(id, license, eligibility === "purchased");
    }
    setLicenseDialogOpen(false);
  };

  const buySelectedLicense = (license: ProductLicense | null) => {
    setCartItem(id, license, eligibility === "purchased");
    setLicenseDialogOpen(false);
    router.push("/cart/payment");
  };

  const buyNow = () => {
    if (licenses.length) {
      setLicenseDialogOpen(true);
      return;
    }
    if (inCart) {
      setCartItem(id, null, eligibility === "purchased");
    } else {
      addToCart(id, null, eligibility === "purchased");
    }
    router.push("/cart/payment");
  };

  return (
    <>
      <div className="w-[220px] max-w-full shrink-0">
        <div className="flex flex-col gap-2 [&>button]:mt-0">
          <button
            type="button"
            onClick={() => {
              if (inCart) {
                removeFromCart(id);
                return;
              }
              setLicenseDialogOpen(true);
            }}
            aria-label={
              inCart
                ? `Remove ${name} from cart`
                : `${eligibility === "purchased" ? "Buy" : "Add"} ${name} to cart`
            }
            className={`flex h-11 w-full flex-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-xs font-bold text-white transition ${
              inCart
                ? "bg-emerald-600 hover:bg-red-600"
                : "bg-primary hover:bg-primary-hover"
            }`}
          >
            <PublicIcon
              name={inCart ? "x" : "shopping-cart"}
              className="h-4 w-4"
            />
            {inCart
              ? "Remove from Cart"
              : eligibility === "purchased"
                ? "Buy Again"
                : "Add to Cart"}
          </button>
          <button
            type="button"
            onClick={buyNow}
            className="flex h-11 w-full flex-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-primary bg-white px-4 text-xs font-bold text-primary transition hover:bg-accent-light"
          >
            <PublicIcon name="shopping-cart-plus" className="h-4 w-4" />
            Buy Now
          </button>
        </div>
        {eligibility === "purchased" && (
          <p className="mt-2 text-center text-[10px] leading-4 text-muted">
            You already own this product. Choose a license to buy another copy
            or upgrade.
          </p>
        )}
      </div>

      {licenseDialogOpen && (
        <ProductLicenseDialog
          id={id}
          name={name}
          type={type}
          currency={currency}
          thumbnailUrl={thumbnailUrl}
          description={description}
          version={version}
          isPurchased={eligibility === "purchased"}
          licenses={licenses}
          onClose={() => setLicenseDialogOpen(false)}
          onAddToCart={addSelectedLicense}
          onBuyNow={buySelectedLicense}
        />
      )}
    </>
  );
}

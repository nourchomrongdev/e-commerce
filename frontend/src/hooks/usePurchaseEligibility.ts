"use client";

import { useEffect, useState } from "react";

export type PurchaseEligibility =
  | "checking"
  | "allowed"
  | "purchased"
  | "blocked"
  | "error";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export function usePurchaseEligibility(productId: string): PurchaseEligibility {
  const [eligibility, setEligibility] = useState<PurchaseEligibility>("checking");

  useEffect(() => {
    let active = true;
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) {
      void Promise.resolve().then(() => {
        if (active) setEligibility("allowed");
      });
      return () => {
        active = false;
      };
    }

    async function checkEligibility() {
      try {
        const response = await fetch(
          `${apiUrl.replace(/\/$/, "")}/orders/purchase-eligibility/${encodeURIComponent(productId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
          throw new Error(`Purchase eligibility check failed (${response.status}).`);
        }
        const result = (await response.json()) as {
          canPurchase?: unknown;
          alreadyPurchased?: unknown;
        };
        if (typeof result.canPurchase !== "boolean") {
          throw new Error("Purchase eligibility response was invalid.");
        }
        if (active) {
          setEligibility(
            result.canPurchase
              ? result.alreadyPurchased === true
                ? "purchased"
                : "allowed"
              : "blocked",
          );
        }
      } catch (error) {
        console.error("Purchase eligibility check failed", error);
        if (active) setEligibility("error");
      }
    }

    void checkEligibility();
    return () => {
      active = false;
    };
  }, [productId]);

  return eligibility;
}

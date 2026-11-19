"use client";

import { useState } from "react";
import Image from "next/image";
import PublicIcon from "@/components/icons/PublicIcon";
import { Modal } from "@/components/ui";
import {
  formatMarketplacePrice,
  type ProductLicense,
} from "@/lib/marketplace";

type Props = {
  id: string;
  name: string;
  type: string;
  currency: string;
  thumbnailUrl?: string | null;
  description?: string;
  version?: string | null;
  isPurchased: boolean;
  licenses: ProductLicense[];
  onClose: () => void;
  onAddToCart: (license: ProductLicense | null) => void;
  onBuyNow: (license: ProductLicense | null) => void;
};

export default function ProductLicenseDialog({
  id,
  name,
  type,
  currency,
  thumbnailUrl,
  description = "",
  version,
  isPurchased,
  licenses,
  onClose,
  onAddToCart,
  onBuyNow,
}: Props) {
  const [selectedLicenseId, setSelectedLicenseId] = useState(
    licenses[0]?.id ?? 0,
  );
  const selectedLicense =
    licenses.find((license) => license.id === selectedLicenseId) ??
    licenses[0] ??
    null;

  return (
    <Modal
      open
      title="Product details and license"
      titleId={`license-dialog-title-${id}`}
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-border-control px-4 text-xs font-semibold text-body transition hover:bg-surface-control sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAddToCart(selectedLicense)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover sm:w-auto"
          >
            <PublicIcon name="shopping-cart" className="h-4 w-4" />
            Add to cart
          </button>
          <button
            type="button"
            onClick={() => onBuyNow(selectedLicense)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary bg-white px-4 text-xs font-semibold text-primary transition hover:bg-accent-light sm:w-auto"
          >
            Buy now
          </button>
        </div>
      }
    >
      {isPurchased && (
        <p className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          You already own this product. Choose a license to buy another copy or
          upgrade.
        </p>
      )}
      <div className="flex gap-4 rounded-xl border border-divider bg-surface-muted p-3 sm:p-4">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={`${name} preview`}
            width={112}
            height={80}
            unoptimized
            className="h-20 w-28 shrink-0 rounded-lg bg-white object-cover"
          />
        ) : (
          <div className="grid h-20 w-28 shrink-0 place-items-center rounded-lg bg-white text-primary">
            <PublicIcon name="product" className="h-7 w-7" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-primary">
            {type}{version ? ` · Version ${version}` : ""}
          </p>
          <h3 className="mt-1 text-base font-bold text-heading">{name}</h3>
          {description && (
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">
              {description}
            </p>
          )}
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-xs font-semibold text-heading">
          {licenses.length ? "Select a license" : "License"}
        </legend>
        {licenses.length > 0 ? (
          <div className="mt-2 grid gap-2">
            {licenses.map((license) => {
              const checked = license.id === selectedLicense?.id;
              return (
                <label
                  key={license.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    checked
                      ? "border-primary bg-orange-50/70 ring-1 ring-primary/20"
                      : "border-border-control bg-white hover:border-primary/40 hover:bg-surface-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name={`license-${id}`}
                    value={license.id}
                    checked={checked}
                    onChange={() => setSelectedLicenseId(license.id)}
                    className="mt-1 h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-heading">
                        {license.name}
                      </span>
                      <span className="text-sm font-bold text-primary">
                        {formatMarketplacePrice(license.price, currency)}
                      </span>
                    </span>
                    <span className="mt-1 block text-[10px] text-muted">
                      {license.accessType || "Digital access"}
                      {license.downloadLimit !== undefined && (
                        <>
                          {" · "}
                          {license.downloadLimit === null
                            ? "Unlimited"
                            : `${license.downloadLimit} downloads`}
                        </>
                      )}
                      {license.requiresKey && " · License key included"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-divider p-3 text-xs text-muted">
            No separate license options are available for this product.
          </p>
        )}
      </fieldset>

      {selectedLicense?.terms && (
        <section className="mt-4 rounded-xl border border-divider p-4">
          <h4 className="text-xs font-semibold text-heading">
            {selectedLicense.name} details
          </h4>
          <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-muted">
            {selectedLicense.terms}
          </p>
        </section>
      )}
    </Modal>
  );
}

export type MarketplaceProduct = {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  productType: string;
  categoryName: string;
  categorySlug: string;
  storeName: string;
  storeSlug: string;
  creatorName: string;
  creatorVerified: boolean;
  price: number;
  currency: string;
  discountType: string;
  discountAmount: number;
  isFree: boolean;
  currentVersion: string | null;
  currentVersionId: number | null;
  rating: number | null;
  reviewCount: number;
  salesCount: number;
  recentSalesCount: number;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceCategory = {
  id: number;
  name: string;
  slug: string;
  productCount: number;
};

export type MarketplaceFilterOption = {
  value: string;
  label: string;
};

export type MarketplaceSubcategory = MarketplaceFilterOption & {
  parentId: number;
  parentSlug: string;
  productCount: number;
};

export type MarketplaceCreator = {
  name: string;
  slug: string;
  description: string;
  logoUrl: string | null;
  creatorName: string;
  verified: boolean;
  productCount: number;
  rating: number | null;
  reviewCount: number;
};

export type MarketplaceResponse = {
  products: MarketplaceProduct[];
  total: number;
  page: number;
  pageSize: number;
  categories: MarketplaceCategory[];
  subcategories: MarketplaceSubcategory[];
  filters: {
    productTypes: MarketplaceFilterOption[];
    licenseTypes: Array<{ id: number; name: string }>;
  };
  creators: MarketplaceCreator[];
  bestSellers: MarketplaceProduct[];
  trending: MarketplaceProduct[];
  newArrivals: MarketplaceProduct[];
  recentlyUpdated: MarketplaceProduct[];
};

export type MarketplaceQuery = {
  search?: string;
  category?: string | string[];
  subcategory?: string | string[];
  productType?: string | string[];
  format?: string | string[];
  license?: string | string[];
  store?: string | string[];
  creator?: string | string[];
  minPrice?: string | number;
  maxPrice?: string | number;
  rating?: string | number;
  availability?: string;
  discounted?: string | boolean;
  sort?: string;
  page?: string | number;
  pageSize?: string | number;
};

export type StorefrontDetails = {
  id: number;
  name: string;
  slug: string;
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  creatorName: string;
  verified: boolean;
  productCount: number;
  rating: number | null;
  reviewCount: number;
  categories: Array<{ name: string; slug: string; productCount: number }>;
};

export type StorefrontResponse = {
  store: StorefrontDetails;
  products: MarketplaceProduct[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    productTypes: MarketplaceFilterOption[];
    licenseTypes: Array<{ id: number; name: string }>;
  };
};

export type ProductPreview = {
  type: string;
  title: string;
  url: string;
  sortOrder: number;
};

export type ProductReview = {
  id: number;
  rating: number;
  title: string;
  comment: string;
  verifiedPurchase: boolean;
  createdAt: string;
};

export type ProductLicense = {
  id: number;
  name: string;
  price: number;
  accessType: string;
  downloadLimit: number | null;
};

export type ProductDetails = MarketplaceProduct & {
  previews: ProductPreview[];
  reviews: ProductReview[];
  licenses: ProductLicense[];
};

export type ProductVersion = {
  id: number;
  version: string;
  releaseNotes: string;
  price: number;
  isFree: boolean;
  isCurrent: boolean;
  releasedAt: string;
  fileCount: number;
  fileSize: number;
  files: Array<{ name: string; size: number; mimeType: string | null }>;
};

const apiBase =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

async function marketplaceRequest<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}${path}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? ((await response.json()) as { error?: string })
      : null;
    throw new Error(body?.error || `Marketplace request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function getMarketplace(params: MarketplaceQuery = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (String(item).trim()) query.append(key, String(item));
      }
    } else if (value !== undefined && String(value).trim()) {
      query.set(key, String(value));
    }
  }
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  return marketplaceRequest<MarketplaceResponse>(`/marketplace${suffix}`);
}

export function getStorefront(slug: string, params: MarketplaceQuery = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (String(item).trim()) query.append(key, String(item));
      }
    } else if (value !== undefined && String(value).trim()) {
      query.set(key, String(value));
    }
  }
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  return marketplaceRequest<StorefrontResponse>(
    `/marketplace/${encodeURIComponent(slug)}${suffix}`,
  );
}

export function getProduct(storefrontSlug: string, productSlug: string) {
  return marketplaceRequest<{ product: ProductDetails }>(
    `/marketplace/${encodeURIComponent(storefrontSlug)}/${encodeURIComponent(productSlug)}`,
  );
}

export function getProductVersions(storefrontSlug: string, productSlug: string) {
  return marketplaceRequest<{ versions: ProductVersion[] }>(
    `/marketplace/${encodeURIComponent(storefrontSlug)}/${encodeURIComponent(productSlug)}/versions`,
  );
}

export function formatMarketplacePrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.trim().toUpperCase(),
  }).format(amount);
}

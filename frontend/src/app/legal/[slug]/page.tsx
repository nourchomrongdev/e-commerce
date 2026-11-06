import LegalPage from "@/components/LegalPage";

export const dynamic = "force-dynamic";

async function loadPolicy(slug: string) {
  const base = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
  const response = await fetch(`${base}/policies/public/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()).policy ?? null;
}

export default async function DynamicLegalPolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const policy = await loadPolicy(slug);
  return (
    <LegalPage
      eyebrow="Legal"
      title={policy?.title || "Policy not available"}
      updated={policy?.publishedAt ? new Date(policy.publishedAt).toLocaleDateString("en-US") : "Unavailable"}
      sections={[]}
      htmlContent={policy?.content}
    />
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import CustomerTable, { type Customer } from "@/components/customers/CustomerTable";
import PublicIcon from "@/components/icons/PublicIcon";
import { Button, InputText, MetricTile } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const PAGE_SIZE = 10;

type CustomerSegment = "All Customers" | "New Customers" | "Returning Customers";
type CustomerSpend = { currency: string; amount: number | string };
type CustomerResponse = {
  customers: Array<Omit<Customer, "totalSpent" | "lastOrder"> & {
    id: number;
    lastOrder: string;
    spendByCurrency: CustomerSpend[];
  }>;
  stats: {
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
  };
  averageOrderValues: CustomerSpend[];
  pagination: { page: number; total: number; totalPages: number };
};

const tabLabels: CustomerSegment[] = ["All Customers", "New Customers", "Returning Customers"];

function formatCurrency(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
}

function formatSpend(spend: CustomerSpend[]) {
  return spend.map(({ currency, amount }) => formatCurrency(amount, currency)).join(" · ") || "—";
}

function exportCustomers(customers: Customer[]) {
  const rows = [
    ["Name", "Email", "Orders", "Total Spent", "Last Order", "Status"],
    ...customers.map((customer) => [
      customer.name,
      customer.email,
      String(customer.orders),
      customer.totalSpent,
      customer.lastOrder,
      customer.status,
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "storefront-customers.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function StorefrontCustomerPage() {
  const params = useParams<{ storefront: string }>();
  const storefrontName = String(params.storefront || "");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<CustomerResponse["stats"] | null>(null);
  const [averageOrderValues, setAverageOrderValues] = useState<CustomerSpend[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [activeSegment, setActiveSegment] = useState<CustomerSegment>("All Customers");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatusFilter = useDebouncedValue(statusFilter);
  const debouncedActiveSegment = useDebouncedValue(activeSegment);

  useEffect(() => {
    if (
      search.trim() !== debouncedSearch ||
      statusFilter !== debouncedStatusFilter ||
      activeSegment !== debouncedActiveSegment
    ) return;

    const controller = new AbortController();
    const loadCustomers = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");

        const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch) query.set("search", debouncedSearch);
        if (debouncedStatusFilter !== "All Status") query.set("status", debouncedStatusFilter);
        if (debouncedActiveSegment !== "All Customers") {
          query.set("segment", debouncedActiveSegment === "New Customers" ? "New" : "Returning");
        }

        const response = await fetch(
          `${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}/customers?${query}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load storefront customers.");

        const result = data as CustomerResponse;
        setCustomers(result.customers.map((customer) => ({
          name: customer.name || "Customer",
          email: customer.email,
          orders: Number(customer.orders) || 0,
          totalSpent: formatSpend(customer.spendByCurrency),
          lastOrder: new Date(customer.lastOrder).toLocaleDateString(),
          status: customer.status,
          segment: customer.segment,
        })));
        setStats(result.stats);
        setAverageOrderValues(result.averageOrderValues);
        setTotal(Number(result.pagination.total) || 0);
        setTotalPages(Math.max(1, Number(result.pagination.totalPages) || 1));
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load storefront customers.");
          setCustomers([]);
          setStats(null);
          setAverageOrderValues([]);
          setTotal(0);
          setTotalPages(1);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadCustomers();
    return () => controller.abort();
  }, [
    activeSegment,
    debouncedActiveSegment,
    debouncedSearch,
    debouncedStatusFilter,
    page,
    search,
    statusFilter,
    storefrontName,
  ]);

  const averageOrderValue = averageOrderValues
    .map(({ currency, amount }) => formatCurrency(amount, currency))
    .join(" · ") || "—";
  const metrics = [
    ["Total Customers", String(stats?.totalCustomers ?? "—"), "Paid buyers across this storefront", "user", "text-blue-700"],
    ["New Customers", String(stats?.newCustomers ?? "—"), "One paid order", "user-round", "text-emerald-700"],
    ["Returning Customers", String(stats?.returningCustomers ?? "—"), "More than one paid order", "receipt", "text-primary"],
    ["Avg. Order Value", averageOrderValue, "Paid orders, by currency", "dollar", "text-violet-700"],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Customers</h1>
          <p className="mt-1 text-sm text-muted">View and manage your customers across the store.</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading || customers.length === 0}
          onClick={() => exportCustomers(customers)}
        >
          <PublicIcon name="down" className="h-4 w-4 rotate-180" />
          Export current page
        </Button>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(([label, value, detail, icon, iconTone]) => (
          <MetricTile
            key={label}
            label={label}
            value={value}
            change={detail}
            icon={<PublicIcon name={icon} className="h-5 w-5" />}
            iconClassName={iconTone}
          />
        ))}
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 pt-4 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex shrink-0 flex-wrap gap-5">
              {tabLabels.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setActiveSegment(tab);
                    setPage(1);
                  }}
                  className={`relative whitespace-nowrap pb-3 text-[10px] font-semibold transition ${
                    activeSegment === tab
                      ? "text-[var(--color-primary)]"
                      : "text-tab-muted hover:text-body"
                  }`}
                >
                  {tab}
                  {activeSegment === tab && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--color-primary)]" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 pb-4 sm:flex-row sm:items-center xl:max-w-[900px]">
              <label className="relative block min-w-[220px] flex-1">
                <span className="sr-only">Search customers</span>
                <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
                <InputText
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search customer, email or order..."
                  className="h-9 pl-9 pr-3 text-xs"
                />
              </label>

              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body outline-none focus:border-primary sm:w-[122px]"
                aria-label="Customer status filter"
              >
                <option>All Status</option>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </div>
          </div>
        </div>

        {error && <p role="alert" className="border-b border-divider px-5 py-3 text-xs text-status-danger">{error}</p>}
        {loading && <p className="px-6 py-3 text-center text-xs text-muted">Loading storefront customers...</p>}
        <CustomerTable
          customers={customers}
          total={total}
          page={page}
          pages={totalPages}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}

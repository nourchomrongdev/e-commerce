import ProductCard, { type Item } from "./ProductCard";

export default function ProductGrid({
  items,
  className = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6",
}: {
  items: Item[];
  className?: string;
}) {
  return (
    <div className={className}>
      {items.map((item) => (
        <ProductCard key={item.id} item={item} />
      ))}
    </div>
  );
}

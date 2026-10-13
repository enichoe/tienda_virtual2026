const KEY = "nexotech-cart-v1";
export function normalizeCart(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (x) =>
        x &&
        typeof x.id === "string" &&
        Number.isInteger(x.qty) &&
        x.qty > 0 &&
        x.qty <= 99,
    )
    .slice(0, 50)
    .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i)
    .map((x) => ({ id: x.id, qty: x.qty }));
}
export function loadCart() {
  try {
    return normalizeCart(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return [];
  }
}
export function saveCart(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeCart(rows)));
  } catch {}
}
export function subtotal(rows, products) {
  return (
    rows.reduce((sum, r) => {
      const p = products.find((p) => p.id === r.id);
      return (
        sum +
        (p ? Math.round(Number(p.sale_price ?? p.price) * 100) * r.qty : 0)
      );
    }, 0) / 100
  );
}

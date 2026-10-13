import { money } from "./utils.js";
export function orderMessage(o) {
  const c = o.customer;
  return [
    `*${o.store_name} · Pedido ${o.number}*`,
    new Date(o.created_at).toLocaleString("es-PE", {
      timeZone: "America/Lima",
    }),
    "",
    `Cliente: ${c.name}`,
    `Teléfono: ${c.phone}`,
    "",
    ...o.items.map(
      (i) =>
        `${i.qty} × ${i.name} (${i.sku})\n${money(i.unit_price)} c/u · ${money(i.unit_price * i.qty)}`,
    ),
    "",
    `Subtotal: ${money(o.subtotal)}`,
    `Envío: ${o.shipping === null ? "por confirmar" : money(o.shipping)}`,
    `${o.shipping === null ? "Subtotal provisional" : "Total"}: ${money(o.subtotal + (o.shipping || 0))}`,
    `Pago: ${o.payment_name} (pendiente de verificación)`,
    `Entrega: ${c.delivery === "pickup" ? "Recojo en tienda" : "Envío a domicilio"}`,
    c.delivery === "pickup"
      ? o.pickup
      : `Dirección: ${c.address}\n${c.district}, ${c.province}, ${c.department}\nReferencia: ${c.reference}`,
    c.lat != null
      ? `Ubicación: https://www.google.com/maps?q=${c.lat},${c.lng}`
      : "",
    `Observaciones: ${c.notes || "Sin observaciones"}`,
    "",
    "Solicito confirmar disponibilidad, pago y entrega.",
  ]
    .filter(Boolean)
    .join("\n");
}
export function cleanPhone(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.length === 9) p = `51${p}`;
  return p;
}
export function whatsappUrl(phone, message) {
  const p = cleanPhone(phone);
  if (!/^\d{10,15}$/.test(p))
    throw new Error("La tienda debe configurar su número de WhatsApp.");
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

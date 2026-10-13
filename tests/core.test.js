import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCart, subtotal } from "../dist/src/cart.js";
import { escape, safeUrl } from "../dist/src/utils.js";
import { orderMessage, whatsappUrl } from "../dist/src/whatsapp.js";
test("carrito: descarta entradas manipuladas y duplicadas", () => {
  assert.deepEqual(
    normalizeCart([
      { id: "a", qty: 2 },
      { id: "a", qty: 3 },
      { id: "b", qty: -1 },
      { id: "c", qty: 1.5 },
      { id: "d", qty: 100 },
      null,
    ]),
    [{ id: "a", qty: 2 }],
  );
});
test("subtotal usa el precio vigente y calcula en céntimos", () => {
  assert.equal(
    subtotal([{ id: "a", qty: 3 }], [{ id: "a", price: 20, sale_price: 10.1 }]),
    30.3,
  );
});
test("texto y URLs de productos no inyectan HTML ni JavaScript", () => {
  assert.equal(
    escape('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  );
  assert.equal(safeUrl("javascript:alert(1)"), "");
});
const order = {
  store_name: "Tienda",
  number: "NX-1001",
  created_at: "2026-10-10T03:00:00Z",
  customer: {
    name: "Ana",
    phone: "999999999",
    delivery: "shipping",
    address: "Calle 1",
    district: "Lima",
    province: "Lima",
    department: "Lima",
    reference: "Esquina",
    lat: -12.04,
    lng: -77.03,
  },
  items: [{ name: "SSD", sku: "S1", qty: 2, unit_price: 100 }],
  subtotal: 200,
  shipping: null,
  payment_name: "Yape",
};
test("WhatsApp incluye detalles y señala envío por confirmar", () => {
  const text = orderMessage(order);
  for (const term of [
    "NX-1001",
    "2 × SSD (S1)",
    "Ana",
    "Calle 1",
    "Subtotal provisional",
    "Envío: por confirmar",
    "-12.04,-77.03",
    "pendiente de verificación",
  ])
    assert.ok(text.includes(term), term);
  assert.ok(
    whatsappUrl("51999999999", text).startsWith(
      "https://wa.me/51999999999?text=",
    ),
  );
  assert.throws(() => whatsappUrl("", text));
});
test("recojo no se describe como dirección del cliente", () => {
  const text = orderMessage({
    ...order,
    shipping: 0,
    pickup: "Local 101",
    customer: { name: "Ana", phone: "999999999", delivery: "pickup" },
  });
  assert.ok(text.includes("Local 101"));
  assert.ok(!text.includes("undefined"));
  assert.ok(!text.includes("Subtotal provisional"));
});

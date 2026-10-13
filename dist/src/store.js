import { catalog, query, createOrder } from "./api.js";
import { configured } from "./config.js";
import {
  $,
  escape as e,
  money,
  price,
  safeUrl,
  notice,
  openDialog,
  field,
  select,
} from "./utils.js";
import { loadCart, saveCart, subtotal } from "./cart.js";
import { orderMessage, whatsappUrl } from "./whatsapp.js";
let data,
  cart = loadCart(),
  page = 1,
  mode = "featured",
  locationData = {},
  checkoutKey,
  checkoutFingerprint = "",
  lastOrder,
  busy = false;
const illustrations = [
  "laptop",
  "desktop",
  "monitor",
  "ram",
  "keyboard",
  "ssd",
  "router",
];
const img = (url, alt = "", className = "") =>
  `<img class="${className}" src="${e(safeUrl(url) || "assets/laptop.svg")}" alt="${e(alt)}" loading="lazy">`;
function count() {
  $("#cart-count").textContent = cart.reduce((n, r) => n + r.qty, 0);
  saveCart(cart);
}
function add(id) {
  const p = data.products.find((p) => p.id === id);
  const r = cart.find((r) => r.id === id);
  if (!p || !p.active || p.stock <= (r?.qty || 0))
    return notice("No hay más unidades disponibles.", true);
  if (r) r.qty++;
  else cart.push({ id, qty: 1 });
  count();
  notice("Producto agregado a tu carrito.");
}
function productCard(p) {
  return `<article class="product-card">${!p.stock ? '<span class="product-badge sold">AGOTADO</span>' : p.sale_price ? `<span class="product-badge">−${Math.round((1 - p.sale_price / p.price) * 100)}%</span>` : p.featured ? '<span class="product-badge">DESTACADO</span>' : ""}<button class="product-photo" data-detail="${e(p.id)}" aria-label="Ver ${e(p.name)}">${img(p.image_url, p.name)}</button><div class="product-body"><span class="product-brand">${e(p.brand)}</span><button class="product-name" data-detail="${e(p.id)}">${e(p.name)}</button><p class="product-desc">${e(p.description)}</p><div class="price-line"><strong>${money(price(p))}</strong>${p.sale_price ? `<del>${money(p.price)}</del>` : ""}</div><div class="stock">${p.stock ? "Disponible para tu pedido" : "Sin stock por el momento"}</div><button class="add-button" data-add="${e(p.id)}" ${!p.stock ? "disabled" : ""}>${p.stock ? "＋ &nbsp; Agregar al carrito" : "Agotado"}</button></div></article>`;
}
/** Aplica filtros al catálogo cargado y presenta seis productos por página. */
function render() {
  let list = data.products.filter((p) => p.active);
  const search = $("#search").value.toLocaleLowerCase();
  const cat = $("#category-filter").value;
  const max = $("#price-filter").value;
  if (search)
    list = list.filter((p) =>
      `${p.name} ${p.brand} ${p.sku} ${p.description}`
        .toLocaleLowerCase()
        .includes(search),
    );
  if (cat) list = list.filter((p) => p.category_id === cat);
  if (max !== "") list = list.filter((p) => price(p) <= Number(max));
  if ($("#stock-filter").checked) list = list.filter((p) => p.stock > 0);
  if (mode === "featured" && !search && !cat)
    list = list.filter((p) => p.featured);
  if (mode === "offers") list = list.filter((p) => p.sale_price !== null);
  const sort = $("#sort").value;
  list.sort((a, b) =>
    sort === "price-asc"
      ? price(a) - price(b)
      : sort === "price-desc"
        ? price(b) - price(a)
        : sort === "name"
          ? a.name.localeCompare(b.name)
          : Number(b.featured) - Number(a.featured),
  );
  const pages = Math.max(1, Math.ceil(list.length / 6));
  page = Math.min(page, pages);
  $("#results-count").textContent = `${list.length} productos para ti`;
  $("#products").innerHTML =
    list
      .slice((page - 1) * 6, page * 6)
      .map(productCard)
      .join("") ||
    '<div class="empty">No encontramos productos.<br>Prueba con otra búsqueda o limpia los filtros.</div>';
  $("#pagination").innerHTML =
    pages > 1
      ? Array.from(
          { length: pages },
          (_, i) =>
            `<button data-page="${i + 1}" class="${page === i + 1 ? "active" : ""}" aria-label="Página ${i + 1}">${i + 1}</button>`,
        ).join("")
      : "";
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("#catalog-title").textContent =
    mode === "offers"
      ? "Tecnología en oferta."
      : mode === "featured"
        ? "Nuestros destacados."
        : "Explora nuestro catálogo.";
}
function renderCart() {
  const missing = cart.some((r) => !data.products.find((p) => p.id === r.id));
  $("#cart-content").innerHTML = cart.length
    ? `${cart
        .map((r) => {
          const p = data.products.find((p) => p.id === r.id);
          return `<div class="cart-row"><div class="cart-img-wrap">${img(p?.image_url, p?.name)}</div><div><b>${e(p?.name || "Producto no disponible")}</b><small>${p ? money(price(p)) : "Retira este producto para continuar"}</small><div class="quantity"><button data-qty="${e(r.id)}" data-change="-1" aria-label="Disminuir cantidad">−</button><span>${r.qty}</span><button data-qty="${e(r.id)}" data-change="1" aria-label="Aumentar cantidad">+</button></div><button class="remove-item" data-remove="${e(r.id)}">✕ Quitar</button></div><strong>${p ? money(price(p) * r.qty) : "—"}</strong></div>`;
        })
        .join(
          "",
        )}<div class="total-line"><span>Subtotal</span><span>${money(subtotal(cart, data.products))}</span></div><p class="muted">Envío por confirmar. Verificaremos precio y stock al registrar tu pedido.</p><button id="checkout-button" class="btn btn-primary w-100" ${missing ? "disabled" : ""}>Continuar con mi pedido ↗</button>${lastOrder ? `<button id="reopen-order" class="btn btn-outline-primary w-100 mt-2">Reabrir pedido ${e(lastOrder.number)} en WhatsApp</button>` : ""}`
    : '<div class="empty">Tu próximo equipo te está esperando.<br>Agrega productos para comenzar.</div>';
}
async function detail(id) {
  const p = data.products.find((p) => p.id === id);
  if (!p) return;
  $("#detail-content").innerHTML =
    `<div class="detail-grid"><div>${img(p.image_url, p.name)}<div class="gallery" id="detail-gallery"></div></div><div><span class="eyebrow">${e(p.brand)} · ${e(p.sku)}</span><h2>${e(p.name)}</h2><p>${e(p.description)}</p><p>${e(p.specs)}</p><div class="price-line"><strong>${money(price(p))}</strong>${p.sale_price ? `<del>${money(p.price)}</del>` : ""}</div><p class="stock">${p.stock} unidades disponibles</p><button class="btn btn-primary" data-add="${e(p.id)}" ${!p.stock ? "disabled" : ""}>Agregar al carrito</button></div></div>`;
  openDialog("detail-dialog");
  if (configured) {
    try {
      const images = await query("product_images");
      if ($("#detail-gallery"))
        $("#detail-gallery").innerHTML = images
          .filter((i) => i.product_id === id)
          .map(
            (i) =>
              `<a href="${e(safeUrl(i.url))}" target="_blank" rel="noopener">${img(i.url, p.name)}</a>`,
          )
          .join("");
    } catch {
      notice("No se pudo cargar la galería.", true);
    }
  }
}
function shipping(c) {
  if (c.delivery === "pickup") return 0;
  const z = data.zones.find((z) => z.id === c.zone_id);
  return z ? Number(z.fee) : null;
}
function customer() {
  const f = $("#checkout-form");
  return { ...Object.fromEntries(new FormData(f)), ...locationData };
}
function updateSummary() {
  const c = customer();
  const fee = shipping(c);
  const payment = data.payments.find((p) => p.id === c.payment_id);
  $("#checkout-summary").innerHTML = `${cart
    .map((r) => {
      const p = data.products.find((p) => p.id === r.id);
      return `<div>${r.qty} × ${e(p?.name || "Producto no disponible")} — ${p ? money(price(p) * r.qty) : "Retíralo del carrito"}</div>`;
    })
    .join(
      "",
    )}<hr>Subtotal: <b>${money(subtotal(cart, data.products))}</b><br>Envío: <b>${fee === null ? "por confirmar" : money(fee)}</b><br>${fee === null ? "Subtotal provisional" : "Total"}: <b>${money(subtotal(cart, data.products) + (fee || 0))}</b><hr><b>${e(payment?.name || "Configura un método de pago")}</b><p class="mb-1">${e(payment?.details || "")}</p>${payment?.qr_url ? img(payment.qr_url, "QR de pago", "payment-qr") : ""}<small>El pago será verificado manualmente. Coordina con la tienda antes de pagar.</small>`;
  document.querySelectorAll("[data-address]").forEach((el) => {
    el.hidden = c.delivery === "pickup";
    el.querySelectorAll("input").forEach(
      (i) => (i.required = c.delivery !== "pickup" && i.name !== "reference"),
    );
  });
}
/** Recoge los datos sin reservar stock; la validación definitiva es del servidor. */
function checkout() {
  if (!cart.length) return;
  if (
    cart.some(
      (r) =>
        !data.products.find(
          (p) => p.id === r.id && p.active && p.stock >= r.qty,
        ),
    )
  )
    return notice(
      "Revisa tu carrito: cambió la disponibilidad de un producto.",
      true,
    );
  locationData = {};
  $("#cart-dialog").close();
  $("#checkout-content").innerHTML =
    `${!configured ? '<div class="alert alert-info mt-3">Modo demostración: puedes explorar el carrito y el formulario. Configura Supabase y WhatsApp para registrar pedidos reales.</div>' : ""}<form id="checkout-form"><div class="checkout-grid">${field("Nombre completo", "name", "", "text", 'required maxlength="100" autocomplete="name"')}${field("Teléfono", "phone", "", "tel", 'required pattern="[+0-9 ()-]{7,20}" maxlength="20" autocomplete="tel"')}${select(
      "Entrega",
      "delivery",
      [
        ["shipping", "Envío a domicilio"],
        ["pickup", "Recojo en tienda"],
      ],
    )}${select(
      "Método de pago",
      "payment_id",
      data.payments.filter((p) => p.active).map((p) => [p.id, p.name]),
    )}<div class="full checkout-grid" data-address>${field("Departamento", "department", "", "text", 'maxlength="80"')}${field("Provincia", "province", "", "text", 'maxlength="80"')}${field("Distrito", "district", "", "text", 'maxlength="80"')}${field("Dirección", "address", "", "text", 'maxlength="200" autocomplete="street-address"')}${field("Referencia (opcional)", "reference", "", "text", 'maxlength="200"')}${select("Zona de reparto", "zone_id", [["", "Costo de envío por confirmar"], ...data.zones.map((z) => [z.id, `${z.name} · ${money(z.fee)}`])])}<div class="full"><button type="button" class="btn btn-outline-primary" id="locate">⌖ Usar mi ubicación</button><small class="muted d-block mt-2" id="location-status">Opcional. También puedes escribir tu dirección.</small></div></div><p class="muted full">Recojo: ${e(data.settings.pickup)}</p><label class="field full">Observaciones (opcional)<textarea name="notes" class="form-control" maxlength="500"></textarea></label></div><div class="checkout-summary" id="checkout-summary"></div><label class="check"><input type="checkbox" required> Revisé mis productos y autorizo usar mis datos para atender este pedido.</label><p class="muted mt-3">Se abrirá WhatsApp con el mensaje preparado. Debes pulsar «Enviar» allí. El pedido y el pago quedan pendientes de confirmación.</p><button class="btn btn-primary w-100" id="send-order" ${!configured ? "disabled" : ""}>Enviar pedido por WhatsApp ↗</button></form>`;
  updateSummary();
  openDialog("checkout-dialog");
  $("#checkout-form").addEventListener("change", updateSummary);
  $("#checkout-form").addEventListener("submit", submitOrder);
  $("#locate").onclick = () => {
    if (!navigator.geolocation)
      return notice(
        "Tu navegador no admite ubicación. Escribe la dirección.",
        true,
      );
    $("#location-status").textContent = "Buscando tu ubicación…";
    navigator.geolocation.getCurrentPosition(
      (p) => {
        locationData = { lat: p.coords.latitude, lng: p.coords.longitude };
        $("#location-status").textContent =
          "Ubicación adjunta al pedido. Puedes continuar.";
      },
      () => {
        $("#location-status").textContent =
          "No se pudo obtener la ubicación. Continúa con tu dirección escrita.";
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };
}
/** Genera pedido local (demo) sin llamar a la Edge Function. */
async function submitOrderDemo(event) {
  event.preventDefault();
  const c = customer();
  if (!c.name || c.name.trim().length < 2)
    return notice("Ingresa tu nombre completo.", true);
  if (!c.phone || !/[+0-9 ()-]{7,20}/.test(c.phone))
    return notice("Ingresa un teléfono válido.", true);

  const items = cart.map((r) => {
    const p = data.products.find((p) => p.id === r.id);
    return {
      qty: r.qty,
      name: p?.name || "Producto",
      sku: p?.sku || "",
      unit_price: price(p),
    };
  });
  const pay = data.payments.find((p) => p.id === c.payment_id) || data.payments[0];
  const sub = subtotal(cart, data.products);
  const fee = shipping(c);
  const receipt = {
    number: "DEMO-" + Date.now().toString().slice(-6),
    created_at: new Date().toISOString(),
    store_name: data.settings.name || "NexoTech",
    whatsapp: data.settings.whatsapp || "",
    pickup: data.settings.pickup || "",
    customer: c,
    items,
    subtotal: sub,
    shipping: fee,
    payment_name: pay?.name || "Yape",
  };

  if (!data.settings.whatsapp) {
    notice("La tienda aún no configuró su número de WhatsApp.", true);
    return;
  }

  const text = orderMessage(receipt);
  const url = whatsappUrl(receipt.whatsapp, text);
  $(
    "#checkout-content"
  ).innerHTML = `<div class="checkout-summary"><b>Pedido ${e(receipt.number)} preparado.</b><p class="mb-0">Pulsa el botón para abrir WhatsApp con el mensaje listo.</p></div><a class="btn btn-primary" href="${e(url)}" target="_blank" rel="noopener">Abrir WhatsApp ↗</a> <button class="btn btn-outline-secondary" id="copy-message">Copiar mensaje</button><pre id="message-output" class="mt-3">${e(text)}</pre>`;
  $(
    "#copy-message"
  ).onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notice("Mensaje copiado.");
    } catch {
      notice("Selecciona y copia el mensaje que aparece debajo.", true);
    }
  };
  window.open(url, "_blank", "noopener");
}

/** Conserva la clave del intento para que un reintento no duplique pedidos. */
async function submitOrder(event) {
  event.preventDefault();
  // Si no está configurado Supabase, usar flujo demo local
  if (!configured) return submitOrderDemo(event);
  if (busy) return;
  const c = customer();
  if (c.delivery === "pickup") {
    delete c.lat;
    delete c.lng;
    c.zone_id = "";
  }
  const body = {
    customer: c,
    items: cart.map((r) => ({
      id: r.id,
      qty: r.qty,
      expected_price: price(data.products.find((p) => p.id === r.id)),
    })),
    expected_shipping: shipping(c),
  };
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(body)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("nexo-order-attempt") || "null",
    );
    if (saved?.fingerprint === fingerprint) checkoutKey = saved.key;
    else checkoutKey = crypto.randomUUID();
    sessionStorage.setItem(
      "nexo-order-attempt",
      JSON.stringify({ key: checkoutKey, fingerprint }),
    );
  } catch {
    if (fingerprint !== checkoutFingerprint) checkoutKey = crypto.randomUUID();
  }
  checkoutFingerprint = fingerprint;
  body.idempotency_key = checkoutKey;
  busy = true;
  $("#send-order").disabled = true;
  $("#send-order").textContent = "Validando tu pedido…";
  try {
    const order = await createOrder(body);
    lastOrder = order;
    try {
      sessionStorage.setItem("nexo-last-order", JSON.stringify(order));
    } catch {}
    const text = orderMessage(order);
    const url = whatsappUrl(order.whatsapp, text);
    $("#checkout-content").innerHTML =
      `<div class="checkout-summary"><b>Pedido ${e(order.number)} registrado.</b><p class="mb-0">Pendiente de confirmación. Pulsa «Enviar» en WhatsApp para comunicarlo a la tienda.</p></div><a class="btn btn-primary" href="${e(url)}" target="_blank" rel="noopener">Abrir WhatsApp ↗</a> <button class="btn btn-outline-secondary" id="copy-message">Copiar mensaje</button><pre id="message-output" class="mt-3">${e(text)}</pre><p class="muted">Tu carrito se conserva. No se ha confirmado el pago ni reservado stock.</p>`;
    $("#copy-message").onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        notice("Mensaje copiado.");
      } catch {
        notice("Selecciona y copia el mensaje que aparece debajo.", true);
      }
    };
    window.open(url, "_blank", "noopener");
  } catch (error) {
    notice(error.message, true);
    try {
      data = await catalog();
      render();
      updateSummary();
    } catch {}
    $("#send-order").disabled = false;
    $("#send-order").textContent = "Revisar y enviar pedido";
  } finally {
    busy = false;
  }
}
function help() {
  if (!data.settings.whatsapp)
    return notice("La tienda aún debe configurar su WhatsApp.", true);
  try {
    window.open(
      whatsappUrl(
        data.settings.whatsapp,
        "Hola, necesito asesoría para elegir un equipo.",
      ),
      "_blank",
      "noopener",
    );
  } catch (error) {
    notice(error.message, true);
  }
}
async function init() {
  try {
    lastOrder = JSON.parse(sessionStorage.getItem("nexo-last-order") || "null");
  } catch {}
  count();
  $("#year").textContent = new Date().getFullYear();
  try {
    data = await catalog();
    const s = data.settings;
    document
      .querySelectorAll("[data-brand]")
      .forEach((el) => (el.textContent = s.name));
    document.title = `${s.name} | Tecnología que va contigo`;
    if (/^#[0-9a-f]{6}$/i.test(s.primary_color))
      document.documentElement.style.setProperty("--blue", s.primary_color);
    if (s.logo_url)
      document.querySelectorAll(".brand-icon").forEach((el) => {
        el.innerHTML = img(s.logo_url, s.name);
        el.style.background = "transparent";
        el.querySelector("img").style.cssText =
          "width:37px;height:37px;object-fit:contain";
      });
    $("#hero-title").textContent = s.hero_title;
    $("#hero-text").textContent = s.hero_text;
    $("#store-description").textContent = s.description;
    $("#store-contact").textContent = s.contact;
    $("#store-hours").textContent = s.hours;
    $("#demo-label").textContent = configured
      ? ""
      : "Catálogo de demostración · Precios y equipos de ejemplo";
    if (s.social_url && safeUrl(s.social_url)) {
      $("#social-link").href = safeUrl(s.social_url);
      $("#social-link").hidden = false;
    }
    $("#categories").innerHTML = data.categories
      .map(
        (c, i) =>
          `<button class="category-card" data-cat="${e(c.id)}"><img src="assets/${illustrations[i % 7]}.svg" alt=""><span>${e(c.name)}</span></button>`,
      )
      .join("");
    $("#category-filter").innerHTML =
      '<option value="">Todas las categorías</option>' +
      data.categories
        .map((c) => `<option value="${e(c.id)}">${e(c.name)}</option>`)
        .join("");
    render();
  } catch (error) {
    $("#products").innerHTML =
      '<div class="empty">No pudimos cargar el catálogo. <button id="retry" class="btn btn-outline-primary">Reintentar</button></div>';
    $("#results-count").textContent = "Error de conexión";
    $("#retry").onclick = init;
    notice(error.message, true);
  }
}
document.addEventListener("click", (event) => {
  const t = event.target.closest("button,a");
  if (!t) return;
  if (t.classList.contains("close-dialog")) t.closest("dialog").close();
  if (!data) return;
  if (t.dataset.add) add(t.dataset.add);
  if (t.dataset.detail) detail(t.dataset.detail);
  if (t.dataset.page) {
    page = Number(t.dataset.page);
    render();
  }
  if (t.dataset.mode) {
    mode = t.dataset.mode;
    page = 1;
    render();
  }
  if (t.dataset.cat || t.dataset.category) {
    $("#category-filter").value =
      t.dataset.cat ||
      data.categories.find((c) => c.name === t.dataset.category)?.id ||
      "";
    mode = "all";
    page = 1;
    render();
    $("#catalog").scrollIntoView({ behavior: "smooth" });
  }
  if (t.dataset.qty) {
    const r = cart.find((r) => r.id === t.dataset.qty);
    const p = data.products.find((p) => p.id === r.id);
    const qty = r.qty + Number(t.dataset.change);
    if (qty > 0 && qty <= Math.min(p?.stock || 0, 99)) r.qty = qty;
    else if (qty === 0) cart = cart.filter((x) => x !== r);
    else notice("Cantidad no disponible.", true);
    count();
    renderCart();
  }
  if (t.dataset.remove) {
    cart = cart.filter((r) => r.id !== t.dataset.remove);
    count();
    renderCart();
  }
  if (t.id === "checkout-button") checkout();
  if (t.id === "reopen-order" && lastOrder)
    window.open(
      whatsappUrl(lastOrder.whatsapp, orderMessage(lastOrder)),
      "_blank",
      "noopener",
    );
});
$("#open-cart").onclick = $("#bottom-cart").onclick = () => {
  if (!data) return;
  renderCart();
  openDialog("cart-dialog");
};
$("#help-button").onclick = help;
$("#offers-link").onclick = () => {
  mode = "offers";
  page = 1;
  render();
};
$("#search-form").onsubmit = (event) => {
  event.preventDefault();
  $("#catalog").scrollIntoView({ behavior: "smooth" });
};
["search", "category-filter", "price-filter", "stock-filter", "sort"].forEach(
  (id) =>
    $("#" + id).addEventListener("input", () => {
      if (!data) return;
      page = 1;
      render();
    }),
);
$("#reset-filters").onclick = () => {
  $("#search").value = "";
  $("#category-filter").value = "";
  $("#price-filter").value = "";
  $("#stock-filter").checked = false;
  mode = "all";
  page = 1;
  render();
};
init();

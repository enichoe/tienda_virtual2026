import { db, query, save, remove, rpc, upload, deleteImage } from "./api.js";
import { configured } from "./config.js";
import * as demo from "./demo.js";
import {
  $,
  escape as e,
  money,
  safeUrl,
  notice,
  field,
  select,
  openDialog,
} from "./utils.js";
const statusLabels = {
  pending: "Pendiente de confirmación",
  confirmed: "Confirmado",
  preparing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};
const paymentLabels = {
  pending: "Pendiente",
  review: "En revisión",
  paid: "Pagado",
};
let tab = "dashboard",
  cache = {},
  preview = false,
  editing = false;
const title = {
  dashboard: "Resumen de tu tienda",
  products: "Productos",
  categories: "Categorías",
  orders: "Pedidos",
  payment_methods: "Métodos de pago",
  delivery_zones: "Zonas de reparto",
  settings: "Configuración",
};
const tableNames = [
  "products",
  "categories",
  "orders",
  "order_items",
  "settings",
  "payment_methods",
  "delivery_zones",
  "product_images",
];
function checkbox(label, name, checked) {
  return `<label class="form-check"><input type="checkbox" name="${name}" class="form-check-input" ${checked ? "checked" : ""}> ${e(label)}</label>`;
}
function textarea(label, name, value = "", max = 2000) {
  return `<label class="field">${e(label)}<textarea class="form-control" name="${name}" maxlength="${max}" rows="3">${e(value)}</textarea></label>`;
}
async function load() {
  if (preview) {
    cache = {
      products: demo.products,
      categories: demo.categories,
      orders: [],
      order_items: [],
      settings: [demo.settings],
      payment_methods: demo.payments,
      delivery_zones: [],
      product_images: [],
    };
    return;
  }
  const values = await Promise.all(tableNames.map((t) => query(t)));
  tableNames.forEach((t, i) => (cache[t] = values[i]));
}
/** La UI verifica el rol; RLS vuelve a comprobarlo en cada operación. */
async function authorize() {
  const c = await db();
  const {
    data: { user },
    error,
  } = await c.auth.getUser();
  if (error || !user) return false;
  const { data, error: profileError } = await c
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError || data?.role !== "admin") {
    await c.auth.signOut();
    throw new Error("Tu usuario no tiene permisos de administrador.");
  }
  return true;
}
async function enter() {
  await load();
  $("#admin-root").innerHTML =
    `${preview ? '<div class="alert alert-info mt-4">Vista de demostración de solo lectura. Conecta Supabase para iniciar sesión y gestionar datos reales. <a href="downloads/nexotech-peru.zip">Descargar proyecto y guía</a>.</div>' : ""}<div class="admin-shell"><aside class="admin-nav">${Object.entries(
      title,
    )
      .map(
        ([key, label]) =>
          `<button data-tab="${key}" class="${key === tab ? "active" : ""}">${label}</button>`,
      )
      .join("")}</aside><section id="admin-content"></section></div>`;
  $("#logout").hidden = false;
  render();
}
function table(headers, rows) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}" class="muted">Aún no hay registros.</td></tr>`}</tbody></table></div>`;
}
function action(id, canDelete = true) {
  return `<button data-edit="${e(id)}">${preview ? "Ver" : "Editar"}</button>${canDelete && !preview ? `<button class="danger" data-delete="${e(id)}">Eliminar</button>` : ""}`;
}
function orderRows(orders) {
  return orders.map(
    (o) =>
      `<tr><td>${e(o.number)}</td><td>${e(o.customer.name)}</td><td>${money(Number(o.subtotal) + Number(o.shipping || 0))}${o.shipping === null ? " + envío" : ""}</td><td><span class="pill">${e(statusLabels[o.status])}</span></td><td>${e(paymentLabels[o.payment_status])}</td><td><button data-order="${e(o.id)}">Ver pedido</button></td></tr>`,
  );
}
function render() {
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const root = $("#admin-content");
  root.innerHTML = `<div class="panel"><div class="admin-heading"><div><span class="eyebrow">PANEL DE CONTROL</span><h2>${title[tab]}</h2></div>${!["dashboard", "orders", "settings"].includes(tab) && !preview ? '<button id="new-record" class="btn btn-primary">＋ Crear</button>' : ""}</div><div id="panel-body"></div></div>`;
  const body = $("#panel-body");
  if (tab === "dashboard") {
    const orders = [...cache.orders].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    body.innerHTML = `<div class="metrics"><div class="metric">Productos activos<strong>${cache.products.filter((p) => p.active).length}</strong></div><div class="metric">Stock bajo (≤ 5)<strong>${cache.products.filter((p) => p.active && p.stock <= 5).length}</strong></div><div class="metric">Pedidos por confirmar<strong>${orders.filter((o) => o.status === "pending").length}</strong></div></div><div class="d-flex flex-wrap gap-2 mb-4">${Object.entries(
      statusLabels,
    )
      .map(
        ([k, v]) =>
          `<span class="pill">${v}: ${orders.filter((o) => o.status === k).length}</span>`,
      )
      .join(
        "",
      )}</div><h3 class="h6">Pedidos recientes</h3>${table(["Pedido", "Cliente", "Importe", "Estado", "Pago", ""], orderRows(orders.slice(0, 8)))}<p class="admin-help mt-4">Los pedidos pendientes no reservan stock. Al confirmar, se verifica y descuenta el inventario en una sola transacción.</p>`;
    return;
  }
  if (tab === "settings") {
    body.innerHTML = `<form id="settings-form" class="settings-form">${settingsFields(cache.settings[0])}<button class="btn btn-primary" ${preview ? "disabled" : ""}>Guardar configuración</button></form>`;
    $("#settings-form").onsubmit = saveSettings;
    return;
  }
  body.innerHTML = `<div class="toolbar"><input id="admin-search" class="form-control" placeholder="Buscar ${tab === "orders" ? "pedido o cliente" : "por nombre o código"}…" aria-label="Buscar">${tab === "products" ? '<select id="admin-filter" class="form-select"><option value="">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select>' : tab === "orders" ? '<input id="order-date" type="date" class="form-control" aria-label="Fecha del pedido">' : ""}</div><div id="records"></div>`;
  renderRecords();
  $("#admin-search").oninput = renderRecords;
  if ($("#admin-filter")) $("#admin-filter").onchange = renderRecords;
  if ($("#order-date")) $("#order-date").onchange = renderRecords;
}
function renderRecords() {
  const q = $("#admin-search").value.toLowerCase();
  let rows = cache[tab].filter((r) =>
    `${r.name || ""} ${r.sku || ""} ${r.number || ""} ${r.customer?.name || ""}`
      .toLowerCase()
      .includes(q),
  );
  if (tab === "products") {
    const state = $("#admin-filter").value;
    if (state) rows = rows.filter((r) => r.active === (state === "active"));
    $("#records").innerHTML = table(
      ["Producto", "SKU", "Precio", "Stock", "Estado", "Acciones"],
      rows.map(
        (p) =>
          `<tr><td><img src="${e(safeUrl(p.image_url))}" alt=""> ${e(p.name)}</td><td>${e(p.sku)}</td><td>${money(p.sale_price ?? p.price)}</td><td>${p.stock}</td><td>${p.active ? "Activo" : "Inactivo"}</td><td>${action(p.id)}</td></tr>`,
      ),
    );
  } else if (tab === "orders") {
    const date = $("#order-date").value;
    if (date)
      rows = rows.filter(
        (r) =>
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Lima",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(r.created_at)) === date,
      );
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    $("#records").innerHTML = table(
      ["Pedido", "Cliente", "Importe", "Estado", "Pago", ""],
      orderRows(rows),
    );
  } else
    $("#records").innerHTML = table(
      ["Nombre", tab === "delivery_zones" ? "Tarifa" : "Detalles", "Acciones"],
      rows.map(
        (r) =>
          `<tr><td>${e(r.name)}</td><td>${tab === "delivery_zones" ? money(r.fee) : tab === "payment_methods" ? `${e(r.details)} · ${r.active ? "Activo" : "Inactivo"}` : `${cache.products.filter((p) => p.category_id === r.id).length} productos`}</td><td>${action(r.id)}</td></tr>`,
      ),
    );
}
function settingsFields(s) {
  return `<div class="checkout-grid">${field("Nombre de la tienda", "name", s.name, "text", 'required maxlength="100"')}${field("WhatsApp (código de país + número, sin +)", "whatsapp", s.whatsapp, "text", 'pattern="[0-9]{10,15}" placeholder="Completa tu número"')}${field("Logo: URL", "logo_url", s.logo_url, "url")}${field("O subir logo (JPG, PNG, WebP, máx. 3 MB)", "logo_file", "", "file", 'accept="image/jpeg,image/png,image/webp"')}${field("Color principal", "primary_color", s.primary_color, "color")}${field("Red social: URL", "social_url", s.social_url, "url")}${field("Horario", "hours", s.hours)}${field("Contacto público", "contact", s.contact)}${field("Dirección de recojo", "pickup", s.pickup)}${field("Descripción de la tienda", "description", s.description)}</div>${textarea("Título de portada", "hero_title", s.hero_title, 200)}${textarea("Texto de portada", "hero_text", s.hero_text, 500)}`;
}
async function saveSettings(event) {
  event.preventDefault();
  if (preview) return;
  const f = new FormData(event.target);
  const value = Object.fromEntries(f);
  delete value.logo_file;
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const old = cache.settings[0];
    if (f.get("logo_file").size)
      value.logo_url = await upload(f.get("logo_file"));
    await save("settings", { ...value, id: 1 });
    if (old.logo_url && old.logo_url !== value.logo_url)
      await deleteImage(old.logo_url);
    await load();
    notice("Configuración guardada.");
  } catch (error) {
    notice(error.message, true);
  } finally {
    button.disabled = false;
  }
}
function edit(id) {
  const r = cache[tab].find((x) => x.id === id) || {};
  let fields = "";
  if (tab === "products") {
    fields = `<div class="checkout-grid">${field("Nombre", "name", r.name, "text", 'required maxlength="150"')}${field("SKU", "sku", r.sku, "text", 'required maxlength="60"')}${select(
      "Categoría",
      "category_id",
      cache.categories.map((c) => [c.id, c.name]),
      r.category_id,
    )}${field("Marca", "brand", r.brand, "text", 'maxlength="80"')}${field("Precio (S/)", "price", r.price, "number", 'required min="0.01" step="0.01"')}${field("Precio de oferta (opcional)", "sale_price", r.sale_price ?? "", "number", 'min="0.01" step="0.01"')}${field("Stock", "stock", r.stock ?? 0, "number", 'required min="0" max="1000000" step="1"')}${field("Imagen principal: URL o ruta assets/", "image_url", r.image_url, "text")}${field("O subir imagen (máx. 3 MB)", "image_file", "", "file", 'accept="image/jpeg,image/png,image/webp"')}</div>${textarea("Descripción breve", "description", r.description, 500)}${textarea("Especificaciones técnicas", "specs", r.specs, 5000)}${checkbox("Activo", "active", r.active ?? true)}${checkbox("Destacado", "featured", r.featured)}${
      id
        ? `<div><h3 class="h6 mt-3">Galería</h3><div class="gallery">${cache.product_images
            .filter((i) => i.product_id === id)
            .map(
              (i) =>
                `<div><img src="${e(safeUrl(i.url))}" alt="Imagen del producto">${!preview ? `<button type="button" class="btn btn-sm" data-delete-image="${e(i.id)}">Quitar</button>` : ""}</div>`,
            )
            .join("")}</div></div>`
        : ""
    }${field("Agregar imágenes a galería", "gallery_files", "", "file", 'accept="image/jpeg,image/png,image/webp" multiple')}`;
  } else if (tab === "categories")
    fields = field("Nombre", "name", r.name, "text", 'required maxlength="80"');
  else if (tab === "delivery_zones")
    fields =
      field(
        "Zona / distritos atendidos",
        "name",
        r.name,
        "text",
        'required maxlength="120"',
      ) +
      field(
        "Tarifa (S/)",
        "fee",
        r.fee ?? 0,
        "number",
        'required min="0" step="0.01"',
      );
  else if (tab === "payment_methods")
    fields =
      field(
        "Nombre (Yape, Plin, banco…)",
        "name",
        r.name,
        "text",
        'required maxlength="80"',
      ) +
      textarea(
        "Titular, teléfono o banco, moneda, cuenta y CCI",
        "details",
        r.details,
      ) +
      field("QR: URL (opcional)", "qr_url", r.qr_url, "url") +
      field(
        "O subir QR (opcional)",
        "qr_file",
        "",
        "file",
        'accept="image/jpeg,image/png,image/webp"',
      ) +
      checkbox("Activo", "active", r.active ?? false);
  $("#editor").innerHTML =
    `<h2>${id ? "Editar" : "Crear"} ${title[tab].toLowerCase()}</h2><form id="record-form">${fields}<button class="btn btn-primary" ${preview ? "disabled" : ""}>Guardar cambios</button></form>`;
  openDialog("edit-dialog");
  $("#record-form").onsubmit = async (event) => {
    event.preventDefault();
    if (preview || editing) return;
    editing = true;
    const button = event.target.querySelector(
      'button[type="submit"],button:not([type])',
    );
    button.disabled = true;
    const f = new FormData(event.target);
    let value = Object.fromEntries(f);
    ["image_file", "gallery_files", "qr_file"].forEach((k) => delete value[k]);
    value.id = id || crypto.randomUUID();
    try {
      if (tab === "products") {
        value.price = Number(value.price);
        value.sale_price =
          value.sale_price === "" ? null : Number(value.sale_price);
        value.stock = Number(value.stock);
        value.active = f.has("active");
        value.featured = f.has("featured");
        if (value.sale_price !== null && value.sale_price >= value.price)
          throw new Error("La oferta debe ser menor que el precio regular.");
        if (f.get("image_file").size)
          value.image_url = await upload(f.get("image_file"));
        if (!value.image_url)
          throw new Error("Sube una imagen principal o ingresa su URL.");
        if (!value.description.trim())
          throw new Error("Agrega una descripción breve.");
      }
      if (tab === "delivery_zones") value.fee = Number(value.fee);
      if (tab === "payment_methods") {
        value.active = f.has("active");
        if (value.active && !value.details.trim())
          throw new Error("Completa las instrucciones de pago.");
        if (f.get("qr_file").size)
          value.qr_url = await upload(f.get("qr_file"));
      }
      await save(tab, value);
      if (tab === "products") {
        for (const file of f.getAll("gallery_files").filter((f) => f.size)) {
          const url = await upload(file);
          await save("product_images", { product_id: value.id, url });
        }
        if (r.image_url && r.image_url !== value.image_url)
          await deleteImage(r.image_url);
      }
      if (tab === "payment_methods" && r.qr_url && r.qr_url !== value.qr_url)
        await deleteImage(r.qr_url);
      $("#edit-dialog").close();
      await load();
      render();
      notice("Cambios guardados.");
    } catch (error) {
      notice(error.message, true);
    } finally {
      editing = false;
      button.disabled = false;
    }
  };
}
/** Archiva productos vendidos y elimina recursos que ya no tienen referencias. */
async function deleteRecord(id) {
  if (preview) return;
  const r = cache[tab].find((x) => x.id === id);
  if (
    !confirm(
      `¿Eliminar «${r.name}»? ${tab === "products" ? "Si tiene pedidos, se archivará." : ""}`,
    )
  )
    return;
  try {
    if (tab === "products") {
      const images = cache.product_images.filter((i) => i.product_id === id);
      const result = await rpc("delete_or_archive_product", { p_id: id });
      if (result === "deleted") {
        await deleteImage(r.image_url);
        for (const i of images) await deleteImage(i.url);
      }
      notice(
        result === "archived"
          ? "Producto archivado para conservar el historial."
          : "Producto eliminado.",
      );
    } else {
      if (
        tab === "categories" &&
        cache.products.some((p) => p.category_id === id)
      )
        throw new Error(
          "Esta categoría tiene productos. Reasígnalos antes de eliminarla.",
        );
      await remove(tab, id);
      if (tab === "payment_methods") await deleteImage(r.qr_url);
      notice("Registro eliminado.");
    }
    await load();
    render();
  } catch (error) {
    notice(error.message, true);
  }
}
function showOrder(id) {
  const o = cache.orders.find((o) => o.id === id);
  const c = o.customer;
  const items = cache.order_items.filter((i) => i.order_id === id);
  $("#editor").innerHTML =
    `<span class="eyebrow">PEDIDO ${e(o.number)}</span><h2>${e(c.name)}</h2><p class="muted mt-3">${e(c.phone)} · ${new Date(o.created_at).toLocaleString("es-PE", { timeZone: "America/Lima" })}</p><div class="checkout-summary">${c.delivery === "pickup" ? `Recojo en tienda: ${e(o.receipt?.pickup)}` : `${e(c.address)}<br>${e(c.district)}, ${e(c.province)}, ${e(c.department)}<br>Referencia: ${e(c.reference)}`}${c.lat != null ? `<br><a href="https://www.google.com/maps?q=${encodeURIComponent(c.lat)},${encodeURIComponent(c.lng)}" target="_blank" rel="noopener">Ver ubicación ↗</a>` : ""}<br>Observaciones: ${e(c.notes || "Sin observaciones")}</div>${table(
      ["Producto", "SKU", "Cantidad", "Precio", "Importe"],
      items.map(
        (i) =>
          `<tr><td>${e(i.name)}</td><td>${e(i.sku)}</td><td>${i.qty}</td><td>${money(i.unit_price)}</td><td>${money(i.unit_price * i.qty)}</td></tr>`,
      ),
    )}<p class="mt-3">Subtotal: <b>${money(o.subtotal)}</b> · Envío: <b>${o.shipping === null ? "Por confirmar" : money(o.shipping)}</b><br>${o.shipping === null ? "Subtotal provisional" : "Total"}: <b>${money(Number(o.subtotal) + Number(o.shipping || 0))}</b><br>Método de pago: ${e(o.payment_name)}</p><form id="order-form">${select("Estado del pedido", "status", Object.entries(statusLabels), o.status)}${select("Estado del pago", "payment_status", Object.entries(paymentLabels), o.payment_status)}${textarea("Observaciones internas", "internal_notes", o.internal_notes)}<p class="admin-help">Confirma solo después de coordinar con el cliente. Marca «Pagado» únicamente tras verificar el abono. Los pedidos enviados o entregados no se cancelan desde este flujo.</p><button class="btn btn-primary">Guardar estado</button></form>`;
  openDialog("edit-dialog");
  $("#order-form").onsubmit = async (event) => {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.target));
    if (
      f.payment_status === "paid" &&
      o.payment_status !== "paid" &&
      !confirm("¿Verificaste el abono real en la cuenta de la tienda?")
    )
      return;
    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      await rpc("update_shop_order", {
        p_id: id,
        p_status: f.status,
        p_payment: f.payment_status,
        p_notes: f.internal_notes,
      });
      $("#edit-dialog").close();
      await load();
      render();
      notice("Pedido actualizado.");
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
    }
  };
}
document.addEventListener("click", async (event) => {
  const t = event.target.closest("button");
  if (!t) return;
  if (t.classList.contains("close-dialog")) t.closest("dialog").close();
  if (t.dataset.tab) {
    tab = t.dataset.tab;
    render();
  }
  if (t.id === "new-record") edit();
  if (t.dataset.edit) edit(t.dataset.edit);
  if (t.dataset.delete) deleteRecord(t.dataset.delete);
  if (t.dataset.order) showOrder(t.dataset.order);
  if (t.dataset.deleteImage && !preview) {
    if (!confirm("¿Quitar esta imagen de la galería?")) return;
    try {
      const i = cache.product_images.find(
        (i) => i.id === t.dataset.deleteImage,
      );
      await remove("product_images", i.id);
      await deleteImage(i.url);
      await load();
      edit(i.product_id);
    } catch (error) {
      notice(error.message, true);
    }
  }
});
$("#logout").onclick = async () => {
  if (!preview) {
    const c = await db();
    await c.auth.signOut();
  }
  location.reload();
};
$("#login-form").onsubmit = async (event) => {
  event.preventDefault();
  const b = $("#login-button");
  b.disabled = true;
  try {
    const c = await db();
    const credentials = Object.fromEntries(new FormData(event.target));
    const { error } = await c.auth.signInWithPassword(credentials);
    if (error)
      throw new Error("No se pudo ingresar. Revisa el correo y la contraseña.");
    if (await authorize()) await enter();
  } catch (error) {
    notice(error.message, true);
  } finally {
    b.disabled = false;
  }
};
if (!configured) {
  $("#setup-message").innerHTML =
    '<div class="alert alert-info">Supabase aún no está configurado. Descarga el proyecto y sigue el README para activar el acceso real.</div><button id="preview-admin" class="btn btn-outline-primary w-100 mb-3">Explorar panel de demostración</button>';
  $("#login-button").disabled = true;
  $("#preview-admin").onclick = async () => {
    preview = true;
    await enter();
  };
} else {
  authorize()
    .then((ok) => ok && enter())
    .catch((error) => notice(error.message, true));
}

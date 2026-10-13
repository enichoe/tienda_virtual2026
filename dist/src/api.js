// Capa de acceso a datos. Usa Supabase REST cuando está configurado;
// si no, devuelve el catálogo de demostración definido en demo.js.
import { config, configured } from "./config.js";
import {
  categories as demoCategories,
  products as demoProducts,
  settings as demoSettings,
  payments as demoPayments,
} from "./demo.js";

// ─── Supabase REST helpers ───────────────────────────────────────────────────

const headers = () => ({
  apikey: config.supabaseAnonKey,
  Authorization: `Bearer ${config.supabaseAnonKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
});

/**
 * Consulta una tabla de Supabase vía REST.
 * @param {string} table  Nombre de la tabla pública.
 * @param {string} [qs]   Query-string adicional (p. ej. "select=*&active=eq.true").
 */
export async function query(table, qs = "select=*") {
  const url = `${config.supabaseUrl}/rest/v1/${table}?${qs}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Error al leer ${table}: ${text}`);
  }
  return res.json();
}

// ─── catalog() ──────────────────────────────────────────────────────────────

/**
 * Devuelve todos los datos que la tienda necesita al arrancar:
 * productos activos, categorías, ajustes, métodos de pago y zonas de reparto.
 * Cuando Supabase no está configurado devuelve el catálogo de demostración.
 */
export async function catalog() {
  if (!configured) {
    return {
      products: demoProducts,
      categories: demoCategories,
      settings: demoSettings,
      payments: demoPayments,
      zones: [],
    };
  }

  const [products, categories, settingsArr, payments, zones] =
    await Promise.all([
      query("products", "select=*&active=eq.true&order=featured.desc,name.asc"),
      query("categories", "select=*&order=name.asc"),
      query("settings", "select=*&id=eq.1&limit=1"),
      query("payment_methods", "select=*&active=eq.true&order=name.asc"),
      query("delivery_zones", "select=*&order=name.asc"),
    ]);

  const settings = settingsArr[0] ?? demoSettings;

  return { products, categories, settings, payments, zones };
}

// ─── createOrder() ──────────────────────────────────────────────────────────

/**
 * Llama a la Edge Function `create-order` para registrar un pedido.
 * El servidor valida stock, precios e idempotencia; nosotros solo enviamos.
 * @param {object} body  Payload del pedido (customer, items, expected_shipping, idempotency_key).
 * @returns {Promise<object>} Recibo del pedido devuelto por el servidor.
 */
export async function createOrder(body) {
  if (!configured) throw new Error("Configura Supabase para registrar pedidos.");

  const url = `${config.supabaseUrl}/functions/v1/create-order`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Error del servidor (${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Error ${res.status}.`);
  }

  return data;
}

// ─── Funciones Administrativas (Auth, Base de Datos, Storage y RPC) ─────────

let _client = null;

/**
 * Obtiene o inicializa la instancia del cliente Supabase.
 */
export async function db() {
  if (_client) return _client;

  if (typeof window !== "undefined" && window.supabase?.createClient) {
    _client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    return _client;
  }

  if (typeof window !== "undefined") {
    try {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      _client = createClient(config.supabaseUrl, config.supabaseAnonKey);
      return _client;
    } catch {
      // Entorno sin acceso a CDN
    }
  }

  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: new Error("No autenticado") }),
      signInWithPassword: async () => ({ error: new Error("Supabase no disponible") }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: new Error("No encontrado") }),
        }),
      }),
      upsert: async () => ({ error: null }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: "" }, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove: async () => ({ error: null }),
      }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

/**
 * Guarda o actualiza un registro en la tabla especificada.
 */
export async function save(table, record) {
  const c = await db();
  if (c.from) {
    const { data, error } = await c.from(table).upsert(record).select();
    if (error) throw new Error(`Error al guardar en ${table}: ${error.message}`);
    return data;
  }

  const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Error al guardar en ${table}: ${text}`);
  }
  return res.json();
}

/**
 * Elimina un registro de la tabla por su ID.
 */
export async function remove(table, id) {
  const c = await db();
  if (c.from) {
    const { error } = await c.from(table).delete().eq("id", id);
    if (error) throw new Error(`Error al eliminar de ${table}: ${error.message}`);
    return;
  }

  const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Error al eliminar de ${table}`);
}

/**
 * Ejecuta un procedimiento almacenado (RPC) de Supabase.
 */
export async function rpc(fn, params = {}) {
  const c = await db();
  if (c.rpc) {
    const { data, error } = await c.rpc(fn, params);
    if (error) throw new Error(`Error en ${fn}: ${error.message}`);
    return data;
  }

  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Error en ${fn}: ${text}`);
  }
  return res.json();
}

/**
 * Sube una imagen al bucket público `shop-images` de Supabase Storage.
 */
export async function upload(file) {
  if (!file || !file.size) return "";
  const c = await db();
  const ext = file.name.split(".").pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  if (c.storage) {
    const { data, error } = await c.storage.from("shop-images").upload(fileName, file);
    if (error) throw new Error(`Error al subir imagen: ${error.message}`);
    const { data: { publicUrl } } = c.storage.from("shop-images").getPublicUrl(data.path);
    return publicUrl;
  }
  return "";
}

/**
 * Elimina una imagen de Supabase Storage si pertenece al bucket.
 */
export async function deleteImage(url) {
  if (!url || typeof url !== "string" || url.startsWith("assets/") || !url.includes("shop-images")) return;
  try {
    const c = await db();
    const path = url.split("shop-images/").pop();
    if (path && c.storage) {
      await c.storage.from("shop-images").remove([path]);
    }
  } catch (err) {
    console.warn("No se pudo eliminar la imagen previa:", err);
  }
}
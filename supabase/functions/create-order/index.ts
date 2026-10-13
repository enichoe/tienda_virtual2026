import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
// Endpoint público para compradores invitados. Las funciones SQL no son públicas.
const database = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const origins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const encoder = new TextEncoder();
Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "content-type, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (!origins.includes(origin))
    return respond({ error: "Origen no permitido." }, 403);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return respond({ error: "Método no permitido." }, 405);
  if (!request.headers.get("content-type")?.includes("application/json"))
    return respond({ error: "Usa JSON." }, 415);
  try {
    // Límite real por bytes; no depender solamente de Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: "Faltan datos." }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 18000) {
        await reader.cancel();
        return respond({ error: "Pedido demasiado grande." }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const secret = Deno.env.get("RATE_LIMIT_SECRET");
    if (!secret)
      return respond(
        { error: "Falta configurar la protección del servidor." },
        503,
      );
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    // La IP se hashéa; el segundo límite global mitiga cabeceras IP manipuladas.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ip))),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const { data: allowed, error: limitError } = await database.rpc(
      "consume_order_limit",
      { p_key: hash },
    );
    if (limitError) throw limitError;
    if (!allowed)
      return respond(
        { error: "Demasiados intentos. Intenta nuevamente en una hora." },
        429,
      );
    const globalLimit = await database.rpc("consume_order_limit", {
      p_key: "global",
    });
    if (globalLimit.error) throw globalLimit.error;
    if (!globalLimit.data)
      return respond(
        { error: "La tienda recibió demasiados pedidos. Intenta más tarde." },
        429,
      );
    const { data, error } = await database.rpc("create_shop_order", {
      payload: body,
    });
    if (error)
      return respond(
        {
          error:
            error.code === "P0001"
              ? error.message
              : "Revisa los datos del pedido y vuelve a intentar.",
        },
        400,
      );
    return respond(data);
  } catch {
    return respond(
      {
        error:
          "No se pudo procesar el pedido. Revisa tus datos o intenta de nuevo.",
      },
      400,
    );
  }
});

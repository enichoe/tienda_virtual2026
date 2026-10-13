// Solo configuración pública. Nunca colocar aquí service_role ni secretos.
export const config = {
  supabaseUrl: "https://ktydokrmebvdxwlimrsg.supabase.co",
  supabaseAnonKey: "sb_publishable_sh07YJh4j6CgQYqfPPlfpg_rPqx608T",
  currency: "PEN",
  locale: "es-PE",
  brand: "NexoTech",
};
export const configured =
  Boolean(config.supabaseUrl && config.supabaseAnonKey) &&
  (typeof window === "undefined" || window.location?.hostname !== "shop.test");

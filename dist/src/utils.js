import { config } from "./config.js";
export const money = (value) =>
  new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: config.currency,
  }).format(Number(value));
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const price = (p) => Number(p.sale_price ?? p.price);
export function safeUrl(value) {
  if (!value) return "";
  const s = String(value).trim();
  // Rutas relativas (assets/, ./…) se devuelven tal cual
  if (!s.includes(":")) return s;
  try {
    const u = new URL(s);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return s;
  }
}
export const $ = (selector) => document.querySelector(selector);
export function notice(message, error = false) {
  const n = $("#notice");
  n.textContent = message;
  n.className = `notice ${error ? "error" : ""}`;
  n.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => (n.hidden = true), 6500);
}
export function openDialog(id) {
  const d = document.getElementById(id);
  if (!d.open) d.showModal();
}
export function field(label, name, value = "", type = "text", extra = "") {
  return `<label class="field">${escape(label)}<input class="form-control" name="${escape(name)}" type="${type}" value="${escape(value)}" ${extra}></label>`;
}
export function select(label, name, options, value = "") {
  return `<label class="field">${escape(label)}<select class="form-select" name="${name}">${options.map(([v, l]) => `<option value="${escape(v)}" ${String(v) === String(value) ? "selected" : ""}>${escape(l)}</option>`).join("")}</select></label>`;
}

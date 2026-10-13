import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
async function surface(file) {
  const dom = new JSDOM(
    await readFile(new URL(`../dist/${file}`, import.meta.url), "utf8"),
    { url: "https://shop.test/" },
  );
  for (const key of [
    "window",
    "document",
    "location",
    "localStorage",
    "sessionStorage",
    "FormData",
  ])
    globalThis[key] = dom.window[key];
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  return dom;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (selector) => document.querySelector(selector).click();
const input = (selector, value) => {
  const node = document.querySelector(selector);
  node.value = value;
  node.dispatchEvent(new window.Event("input", { bubbles: true }));
};
test("interacciones de tienda y panel demo en DOM", async (t) => {
  const dom = await surface("index.html");
  await import("../dist/src/store.js");
  await tick();
  await t.test(
    "muestra destacados, categorías y cambio a catálogo completo",
    () => {
      assert.equal(document.querySelectorAll(".product-card").length, 6);
      assert.equal(document.querySelectorAll(".category-card").length, 7);
      click('[data-mode="all"]');
      assert.equal(document.querySelectorAll("[data-page]").length, 2);
      click('[data-page="2"]');
      assert.equal(document.querySelectorAll(".product-card").length, 4);
    },
  );
  await t.test("búsqueda y filtros actualizan resultados", () => {
    input("#search", "DEMO-006");
    assert.equal(document.querySelectorAll(".product-card").length, 1);
    assert.ok(
      document.querySelector(".product-name").textContent.includes("SSD"),
    );
    input("#price-filter", "200");
    assert.equal(document.querySelectorAll(".product-card").length, 0);
    click("#reset-filters");
  });
  await t.test("agregar, cantidades y subtotal en carrito", () => {
    click('[data-add="1"]');
    click('[data-add="1"]');
    assert.equal(document.querySelector("#cart-count").textContent, "2");
    click("#open-cart");
    assert.ok(document.querySelector("#cart-dialog").open);
    assert.equal(document.querySelector(".quantity span").textContent, "2");
    click('[data-change="-1"]');
    assert.equal(document.querySelector("#cart-count").textContent, "1");
    assert.equal(
      JSON.parse(localStorage.getItem("nexotech-cart-v1"))[0].qty,
      1,
    );
  });
  await t.test(
    "checkout real exige configuración; recojo no exige dirección",
    () => {
      click("#checkout-button");
      assert.ok(document.querySelector("#checkout-dialog").open);
      assert.ok(document.querySelector("#send-order").disabled);
      assert.ok(document.querySelector('[name="address"]').required);
      const select = document.querySelector('[name="delivery"]');
      select.value = "pickup";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
      assert.ok(!document.querySelector('[name="address"]').required);
      assert.ok(document.querySelector("[data-address]").hidden);
      assert.ok(
        document
          .querySelector("#checkout-summary")
          .textContent.includes("Total"),
      );
    },
  );
  dom.window.close();
  const admin = await surface("admin.html");
  await import("../dist/src/admin.js");
  await tick();
  await t.test(
    "panel demo es explícito y no permite guardar datos",
    async () => {
      assert.ok(document.querySelector("#login-button").disabled);
      click("#preview-admin");
      await tick();
      assert.ok(
        document
          .querySelector("#admin-content")
          .textContent.includes("Productos activos"),
      );
      click('[data-tab="products"]');
      assert.equal(
        document.querySelectorAll(".admin-table tbody tr").length,
        10,
      );
      click('[data-edit="1"]');
      assert.ok(
        document
          .querySelector("#record-form")
          .querySelector("button:not([type])").disabled,
      );
      click(".close-dialog");
      click('[data-tab="settings"]');
      assert.ok(document.querySelector("#settings-form button").disabled);
    },
  );
  admin.window.close();
});

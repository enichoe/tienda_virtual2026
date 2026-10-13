import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
// PostgreSQL real en WASM. Se emulan solo los esquemas de infraestructura de Supabase.
const db = new PGlite({ extensions: { pgcrypto } });
const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const customer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let product, payment;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const fail = async (fn) => assert.rejects(fn);
async function as(role, uid = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec(`set role ${role}`);
}
const payload = (qty = 2) => ({
  idempotency_key: crypto.randomUUID(),
  customer: {
    name: "Cliente de prueba",
    phone: "999999999",
    delivery: "shipping",
    department: "Lima",
    province: "Lima",
    district: "Lima",
    address: "Calle de prueba 123",
    reference: "",
    notes: "",
    payment_id: payment,
    zone_id: "",
  },
  items: [{ id: product, qty, expected_price: 100 }],
  expected_shipping: null,
});
const create = async (p) =>
  (
    await query("select public.create_shop_order($1::jsonb) as receipt", [
      JSON.stringify(p),
    ])
  )[0].receipt;
const change = async (id, status, pay = "pending") =>
  query("select public.update_shop_order($1,$2,$3,$4)", [id, status, pay, ""]);
test("base de datos: RLS, pedidos, idempotencia, stock y límites", async (t) => {
  await db.exec(`create schema auth;create schema storage;create schema extensions;
 create role anon;create role authenticated;create role service_role bypassrls;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant all on storage.objects to authenticated;
 `);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/001_shop.sql", import.meta.url),
      "utf8",
    ),
  );
  await query("insert into auth.users(id) values($1),($2)", [admin, customer]);
  await query(
    "insert into public.profiles(id,role) values($1,'admin'),($2,'customer')",
    [admin, customer],
  );
  await db.exec(
    "update public.settings set whatsapp='51999999999',pickup='Local de prueba';update public.payment_methods set active=true;",
  );
  payment = (await query("select id from public.payment_methods limit 1"))[0]
    .id;
  product = (
    await query(
      "insert into public.products(sku,name,category_id,description,image_url,price,stock) values('TEST','Equipo',(select id from public.categories limit 1),'Descripción','https://example.com/image.png',100,10) returning id",
    )
  )[0].id;
  await t.test(
    "visitantes leen catálogo pero no escriben ni consultan pedidos",
    async () => {
      await as("anon");
      assert.equal((await query("select * from public.products")).length, 1);
      await fail(() => query("update public.products set price=1"));
      await fail(() => query("select * from public.orders"));
      await fail(() => create(payload()));
    },
  );
  await t.test(
    "un cliente autenticado no puede elevar su rol ni cambiar pedidos",
    async () => {
      await as("authenticated", customer);
      await fail(() =>
        query("update public.profiles set role='admin' where id=$1", [
          customer,
        ]),
      );
      const rows = await query("select * from public.orders");
      assert.equal(rows.length, 0);
      await fail(() => change(crypto.randomUUID(), "confirmed"));
      await query("update public.products set price=1");
      await as("postgres");
      assert.equal(
        Number((await query("select price from public.products"))[0].price),
        100,
      );
    },
  );
  let o, p;
  await t.test(
    "valida precio, cantidad, envío y productos duplicados",
    async () => {
      await as("service_role");
      const bad = payload();
      bad.items[0].expected_price = 1;
      await fail(() => create(bad));
      await fail(() => create(payload(11)));
      const duplicate = payload();
      duplicate.items.push(duplicate.items[0]);
      await fail(() => create(duplicate));
      const wrongShipping = payload();
      wrongShipping.expected_shipping = 0;
      await fail(() => create(wrongShipping));
    },
  );
  await t.test(
    "pedido pendiente conserva stock y crea precios históricos",
    async () => {
      p = payload();
      o = await create(p);
      assert.equal(o.subtotal, 200);
      assert.equal(o.shipping, null);
      await as("postgres");
      assert.equal(
        (
          await query("select stock from public.products where id=$1", [
            product,
          ])
        )[0].stock,
        10,
      );
      assert.equal(
        Number(
          (
            await query(
              "select unit_price from public.order_items where order_id=$1",
              [o.id],
            )
          )[0].unit_price,
        ),
        100,
      );
    },
  );
  await t.test(
    "reintentar una clave devuelve un único pedido; distinta carga se rechaza",
    async () => {
      await as("service_role");
      assert.equal((await create(p)).id, o.id);
      await fail(() => create({ ...p, items: [{ ...p.items[0], qty: 3 }] }));
      await as("postgres");
      assert.equal(
        Number((await query("select count(*) as n from public.orders"))[0].n),
        1,
      );
    },
  );
  await t.test(
    "confirmar descuenta una sola vez; cancelar restaura una sola vez",
    async () => {
      await as("authenticated", admin);
      await change(o.id, "confirmed");
      await change(o.id, "confirmed", "review");
      await as("postgres");
      assert.equal(
        (
          await query("select stock from public.products where id=$1", [
            product,
          ])
        )[0].stock,
        8,
      );
      await as("authenticated", admin);
      await change(o.id, "cancelled");
      await change(o.id, "cancelled");
      await as("postgres");
      assert.equal(
        (
          await query("select stock from public.products where id=$1", [
            product,
          ])
        )[0].stock,
        10,
      );
      await as("authenticated", admin);
      await fail(() => change(o.id, "confirmed"));
    },
  );
  await t.test(
    "confirmación sin stock revierte toda la operación",
    async () => {
      await as("service_role");
      const receipt = await create(payload(9));
      await as("postgres");
      await query("update public.products set stock=3 where id=$1", [product]);
      await as("authenticated", admin);
      await fail(() => change(receipt.id, "confirmed"));
      await as("postgres");
      assert.equal(
        (
          await query("select status from public.orders where id=$1", [
            receipt.id,
          ])
        )[0].status,
        "pending",
      );
      assert.equal(
        (
          await query("select stock from public.products where id=$1", [
            product,
          ])
        )[0].stock,
        3,
      );
    },
  );
  await t.test(
    "producto vendido se archiva y desaparece de lectura pública",
    async () => {
      await as("authenticated", admin);
      assert.equal(
        (
          await query("select public.delete_or_archive_product($1) as result", [
            product,
          ])
        )[0].result,
        "archived",
      );
      await as("anon");
      assert.equal((await query("select * from public.products")).length, 0);
    },
  );
  await t.test("Storage permite escribir solo al administrador", async () => {
    await as("authenticated", customer);
    await fail(() =>
      query(
        "insert into storage.objects(bucket_id,name) values('shop-images','bad.png')",
      ),
    );
    await as("authenticated", admin);
    await query(
      "insert into storage.objects(bucket_id,name) values('shop-images','good.png')",
    );
  });
  await t.test("rate limit compartido bloquea el intento 21", async () => {
    await as("service_role");
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await query("select public.consume_order_limit('test-ip') as ok"))[0]
          .ok,
        true,
      );
    assert.equal(
      (await query("select public.consume_order_limit('test-ip') as ok"))[0].ok,
      false,
    );
  });
  await db.close();
});

-- NexoTech: ejecutar una vez en un proyecto nuevo de Supabase.
create extension if not exists pgcrypto with schema extensions;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text not null default '', role text not null default 'customer' check(role in ('admin','customer')));
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
create table public.categories (id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 1 and 80));
create table public.products (
 id uuid primary key default gen_random_uuid(), sku text not null unique check(length(sku) between 1 and 60), name text not null check(length(name) between 1 and 150),
 category_id uuid not null references public.categories(id) on delete restrict, brand text not null default '', description text not null check(length(description)<=500), specs text not null default '',
 image_url text not null check(length(image_url)>0), price numeric(12,2) not null check(price>0), sale_price numeric(12,2) check(sale_price>0 and sale_price<price), stock integer not null default 0 check(stock>=0),
 active boolean not null default true, featured boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.product_images (id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id) on delete cascade,url text not null);
create table public.settings (id integer primary key default 1 check(id=1),name text not null default 'NexoTech',description text not null default 'Tecnología que va contigo.',whatsapp text not null default '' check(whatsapp='' or whatsapp ~ '^[0-9]{10,15}$'),logo_url text not null default '',primary_color text not null default '#2457ef',hero_title text not null default E'Tu próximo nivel\nempieza aquí.',hero_text text not null default 'Equipa tus ideas con la tecnología que necesitas. Encuentra tu próximo equipo, nosotros te ayudamos a elegir.',hours text not null default '',contact text not null default '',pickup text not null default '',social_url text not null default '');
create table public.payment_methods (id uuid primary key default gen_random_uuid(),name text not null,details text not null default '',qr_url text not null default '',active boolean not null default true);
create table public.delivery_zones (id uuid primary key default gen_random_uuid(),name text not null unique,fee numeric(12,2) not null check(fee>=0));
create sequence public.order_numbers start 1001;
create table public.orders (
 id uuid primary key default gen_random_uuid(), number text not null unique default ('NX-'||nextval('public.order_numbers')::text),
 idempotency_key uuid not null unique, request_hash text not null, customer jsonb not null, payment_id uuid references public.payment_methods(id) on delete restrict,
 payment_name text not null, subtotal numeric(12,2) not null check(subtotal>0), shipping numeric(12,2) check(shipping>=0),
 status text not null default 'pending' check(status in ('pending','confirmed','preparing','shipped','delivered','cancelled')),
 payment_status text not null default 'pending' check(payment_status in ('pending','review','paid')),
 stock_deducted boolean not null default false, internal_notes text not null default '', receipt jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.order_items (id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,product_id uuid not null references public.products(id) on delete restrict,sku text not null,name text not null,unit_price numeric(12,2) not null check(unit_price>0),qty integer not null check(qty between 1 and 99),unique(order_id,product_id));
create table public.order_rate_limits (key text primary key,bucket timestamptz not null,hits integer not null);
create index products_category_idx on public.products(category_id);
create index orders_created_idx on public.orders(created_at desc);
create index orders_status_idx on public.orders(status);
create index order_items_product_idx on public.order_items(product_id);
create index product_images_product_idx on public.product_images(product_id);
create or replace function public.touch_updated() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now();return new;end;$$;
create trigger products_touch before update on public.products for each row execute function public.touch_updated();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated();
-- RLS: ni el registro ni user_metadata pueden conceder privilegios.
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
do $$ declare t text; begin
 foreach t in array array['categories','products','product_images','settings','payment_methods','delivery_zones','orders','order_items','order_rate_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 end loop;
 foreach t in array array['categories','products','product_images','settings','payment_methods','delivery_zones'] loop
 execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',t);
 end loop;
end $$;
create policy category_public on public.categories for select to anon,authenticated using(true);
create policy product_public on public.products for select to anon,authenticated using(active);
create policy image_public on public.product_images for select to anon,authenticated using(exists(select 1 from public.products p where p.id=product_id and p.active));
create policy settings_public on public.settings for select to anon,authenticated using(true);
create policy payment_public on public.payment_methods for select to anon,authenticated using(active);
create policy zone_public on public.delivery_zones for select to anon,authenticated using(true);
create policy orders_admin_read on public.orders for select to authenticated using(public.is_admin());
create policy items_admin_read on public.order_items for select to authenticated using(public.is_admin());
grant select on public.categories,public.products,public.product_images,public.settings,public.payment_methods,public.delivery_zones to anon,authenticated;
grant insert,update,delete on public.categories,public.products,public.product_images,public.settings,public.payment_methods,public.delivery_zones to authenticated;
grant select on public.profiles,public.orders,public.order_items to authenticated;
revoke all on public.order_rate_limits from anon,authenticated;
revoke insert,update,delete on public.profiles,public.orders,public.order_items from anon,authenticated;
-- Una ventana fija atómica, compartida entre instancias de la Edge Function.
create or replace function public.consume_order_limit(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; begin
 insert into public.order_rate_limits(key,bucket,hits) values(p_key,date_trunc('hour',now()),1)
 on conflict(key) do update set hits=case when public.order_rate_limits.bucket=date_trunc('hour',now()) then public.order_rate_limits.hits+1 else 1 end,bucket=date_trunc('hour',now()) returning hits into n;
 delete from public.order_rate_limits where bucket<now()-interval '48 hours';
 return n<=case when p_key='global' then 500 else 20 end; end;$$;
-- Solo service_role invoca esta transacción, nunca el navegador.
create or replace function public.create_shop_order(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c jsonb:=payload->'customer'; items jsonb:=payload->'items'; key uuid; fingerprint text;
 old_order public.orders; o public.orders; p public.products; item jsonb; amount numeric:=0; q integer;
 pay public.payment_methods; s public.settings; fee numeric; result jsonb; prices jsonb:='[]'::jsonb;
 lat numeric; lng numeric;
begin
 if jsonb_typeof(payload)<>'object' or octet_length(payload::text)>18000 then raise exception 'Pedido inválido o demasiado grande.';end if;
 key:=(payload->>'idempotency_key')::uuid;
 if key is null then raise exception 'Falta la clave del pedido.';end if;
 fingerprint:=encode(extensions.digest((payload-'idempotency_key')::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(key::text,0));
 select * into old_order from public.orders where idempotency_key=key;
 if found then
 if old_order.request_hash<>fingerprint then raise exception 'La clave ya fue utilizada para otro pedido.';end if;
 return old_order.receipt;end if;
 if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(items) is distinct from 'array' then raise exception 'Datos incompletos.';end if;
 if jsonb_array_length(items)<1 or jsonb_array_length(items)>50 then raise exception 'El carrito debe tener entre 1 y 50 productos.';end if;
 if length(trim(coalesce(c->>'name','')))<2 or length(c->>'name')>100 or coalesce(c->>'phone','') !~ '^[+0-9 ()-]{7,20}$' then raise exception 'Revisa el nombre y el teléfono.';end if;
 if coalesce(c->>'delivery','') not in ('shipping','pickup') then raise exception 'Modalidad de entrega inválida.';end if;
 if length(coalesce(c->>'notes',''))>500 or length(coalesce(c->>'reference',''))>200 then raise exception 'Las observaciones son demasiado largas.';end if;
 if c->>'delivery'='shipping' then
 if length(trim(coalesce(c->>'address','')))<3 or length(c->>'address')>200 or length(trim(coalesce(c->>'department','')))<1 or length(c->>'department')>80 or length(trim(coalesce(c->>'province','')))<1 or length(c->>'province')>80 or length(trim(coalesce(c->>'district','')))<1 or length(c->>'district')>80 then raise exception 'Completa la dirección, departamento, provincia y distrito.';end if;
 if nullif(c->>'zone_id','') is not null then select z.fee into fee from public.delivery_zones z where z.id=(c->>'zone_id')::uuid; if not found then raise exception 'La zona de reparto cambió. Revisa el pedido.';end if;else fee:=null;end if;
 else fee:=0;c:=c-'lat'-'lng';end if;
 if fee is distinct from (payload->>'expected_shipping')::numeric then raise exception 'La tarifa de envío cambió. Revisa el resumen y vuelve a enviar.';end if;
 if nullif(c->>'lat','') is not null or nullif(c->>'lng','') is not null then
 lat:=(c->>'lat')::numeric;lng:=(c->>'lng')::numeric;
 if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Ubicación inválida.';end if;end if;
 select * into pay from public.payment_methods where id=(c->>'payment_id')::uuid and active;
 if not found then raise exception 'Selecciona un método de pago disponible.';end if;
 select * into s from public.settings where id=1;
 if not found or s.whatsapp !~ '^[0-9]{10,15}$' then raise exception 'La tienda debe configurar su WhatsApp antes de recibir pedidos.';end if;
 if c->>'delivery'='pickup' and trim(s.pickup)='' then raise exception 'La tienda debe configurar la dirección de recojo.';end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(items) x)<>jsonb_array_length(items) then raise exception 'No repitas productos en el carrito.';end if;
 -- Bloqueo ordenado para evitar deadlocks con la confirmación simultánea.
 for item in select x from jsonb_array_elements(items) x order by x->>'id' loop
 if coalesce(item->>'qty','') !~ '^[0-9]{1,2}$' then raise exception 'Cantidad inválida.';end if;
 q:=(item->>'qty')::integer;
 select * into p from public.products where id=(item->>'id')::uuid for share;
 if not found or not p.active or q<1 or q>99 or p.stock<q then raise exception 'Un producto ya no tiene disponibilidad. Revisa tu carrito.';end if;
 if coalesce(p.sale_price,p.price) is distinct from (item->>'expected_price')::numeric then raise exception 'El precio de un producto cambió. Revisa el resumen y vuelve a enviar.';end if;
 amount:=amount+coalesce(p.sale_price,p.price)*q;
 prices:=prices||jsonb_build_array(jsonb_build_object('product_id',p.id,'sku',p.sku,'name',p.name,'unit_price',coalesce(p.sale_price,p.price),'qty',q));
 end loop;
 insert into public.orders(idempotency_key,request_hash,customer,payment_id,payment_name,subtotal,shipping) values(key,fingerprint,c,pay.id,pay.name,amount,fee) returning * into o;
 insert into public.order_items(order_id,product_id,sku,name,unit_price,qty) select o.id,(x->>'product_id')::uuid,x->>'sku',x->>'name',(x->>'unit_price')::numeric,(x->>'qty')::integer from jsonb_array_elements(prices) x;
 result:=jsonb_build_object('id',o.id,'number',o.number,'created_at',o.created_at,'store_name',s.name,'whatsapp',s.whatsapp,'pickup',s.pickup,'customer',c,'items',prices,'subtotal',amount,'shipping',fee,'payment_name',pay.name);
 update public.orders set receipt=result where id=o.id;
 return result;
end;$$;
-- Máquina de estados administrativa. Stock y estado se modifican juntos.
create or replace function public.update_shop_order(p_id uuid,p_status text,p_payment text,p_notes text default '') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; item record; available integer;
begin
 if not public.is_admin() then raise exception 'Acceso denegado.';end if;
 if p_status not in ('pending','confirmed','preparing','shipped','delivered','cancelled') or p_payment not in ('pending','review','paid') or length(p_notes)>2000 then raise exception 'Estado o nota inválidos.';end if;
 select * into o from public.orders where id=p_id for update;
 if not found then raise exception 'Pedido no encontrado.';end if;
 if p_status<>o.status and not ((o.status='pending' and p_status in ('confirmed','cancelled')) or (o.status='confirmed' and p_status in ('preparing','cancelled')) or (o.status='preparing' and p_status in ('shipped','delivered','cancelled')) or (o.status='shipped' and p_status='delivered')) then raise exception 'Transición no permitida. Sigue el orden de preparación y entrega.';end if;
 if o.status='pending' and p_status='confirmed' and not o.stock_deducted then
 for item in select * from public.order_items where order_id=p_id order by product_id loop
 select stock into available from public.products where id=item.product_id and active for update;
 if not found or available<item.qty then raise exception 'Stock insuficiente para %.',item.name;end if;
 update public.products set stock=stock-item.qty where id=item.product_id;
 end loop;
 o.stock_deducted:=true;
 elsif p_status='cancelled' and o.stock_deducted then
 for item in select * from public.order_items where order_id=p_id order by product_id loop
 update public.products set stock=stock+item.qty where id=item.product_id;
 end loop;
 o.stock_deducted:=false;
 end if;
 update public.orders set status=p_status,payment_status=p_payment,internal_notes=p_notes,stock_deducted=o.stock_deducted where id=p_id;
end;$$;
create or replace function public.delete_or_archive_product(p_id uuid) returns text language plpgsql security definer set search_path='' as $$ begin
 if not public.is_admin() then raise exception 'Acceso denegado.';end if;
 perform 1 from public.products where id=p_id for update;
 if exists(select 1 from public.order_items where product_id=p_id) then update public.products set active=false where id=p_id;return 'archived';end if;
 delete from public.products where id=p_id;return 'deleted';end;$$;
revoke execute on function public.create_shop_order(jsonb),public.consume_order_limit(text) from public,anon,authenticated;
grant execute on function public.create_shop_order(jsonb),public.consume_order_limit(text) to service_role;
revoke execute on function public.update_shop_order(uuid,text,text,text),public.delete_or_archive_product(uuid) from public,anon;
grant execute on function public.update_shop_order(uuid,text,text,text),public.delete_or_archive_product(uuid) to authenticated;
-- Bucket público solo para material del catálogo, nunca comprobantes privados.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('shop-images','shop-images',true,3145728,array['image/jpeg','image/png','image/webp']);
create policy shop_images_admin_insert on storage.objects for insert to authenticated with check(bucket_id='shop-images' and public.is_admin());
create policy shop_images_admin_update on storage.objects for update to authenticated using(bucket_id='shop-images' and public.is_admin()) with check(bucket_id='shop-images' and public.is_admin());
create policy shop_images_admin_delete on storage.objects for delete to authenticated using(bucket_id='shop-images' and public.is_admin());
create policy shop_images_admin_read on storage.objects for select to authenticated using(bucket_id='shop-images' and public.is_admin());
insert into public.settings(id) values(1);
insert into public.categories(name) values('Laptops'),('Computadoras'),('Monitores'),('Componentes'),('Periféricos'),('Almacenamiento'),('Redes');
insert into public.payment_methods(name,details,active) values('Yape','Completa número y titular antes de activar.',false),('Plin','Completa número y titular antes de activar.',false),('Transferencia bancaria','Completa banco, titular, moneda, cuenta y CCI antes de activar.',false);

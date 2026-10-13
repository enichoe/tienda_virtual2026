# NexoTech Perú

Tienda de equipos de cómputo con HTML5, Bootstrap 5, CSS propio y JavaScript ES Modules. Catálogo público, carrito sin cuenta, checkout por WhatsApp y administración con Supabase.

## Estado de esta entrega

- El sitio abre en **modo demostración** cuando `dist/src/config.js` no tiene credenciales. El catálogo, filtros, detalle, carrito y formulario funcionan con ejemplos; el botón para registrar pedidos está desactivado y el panel ofrece una vista de solo lectura.
- La integración con Supabase está implementada, pero **no está conectada a un proyecto real ni se ha probado contra una cuenta del usuario**. No hay teléfonos, cuentas bancarias ni QR inventados.
- El SQL fue ejecutado y probado en PostgreSQL mediante PGlite. Se emularon `auth.users`, `auth.uid()` y las tablas de Storage. Esto verifica políticas y transacciones, pero no sustituye la prueba de Auth, Storage y Edge Functions en Supabase real.
- No se realizó inspección visual automatizada en un navegador en este entorno. Se incluyen pruebas de interacción DOM y una lista de validación manual.
- Bootstrap está incluido localmente. Google Fonts y la biblioteca supabase-js se cargan desde CDN. La tipografía tiene alternativa local del sistema.

## Arquitectura

1. **Navegador:** HTML + Bootstrap + módulos ES. Consultas públicas protegidas por RLS; `localStorage` solo guarda IDs/cantidades del carrito. `sessionStorage` guarda la sesión administrativa y el último intento/recibo de pedido para reabrir WhatsApp dentro de la misma pestaña.
2. **Supabase Auth:** contraseña y sesión del administrador. El rol lo asigna el propietario mediante SQL, no mediante metadatos editables del usuario.
3. **PostgreSQL:** productos, categorías, configuración, pedidos y copias históricas de sus líneas. RLS restringe lecturas y escrituras. Los datos del comprador no son consultables públicamente.
4. **Storage:** bucket público `shop-images` para fotos, logo y QR públicos. Escritura y borrado solo para administradores. No usar para documentos privados.
5. **Edge Function `create-order`:** origen permitido, límite de 18 KB, cuota por IP hash y cuota global. Invoca una transacción SQL exclusiva de service_role para calcular y crear el pedido.
6. **WhatsApp:** enlace `wa.me` con mensaje prellenado. El usuario debe enviarlo; no existe integración con WhatsApp Business API ni confirmación automática de envío o pago.

### Estructura

```text
nexotech-peru/
├── dist/                         # Raíz pública, desplegar esta carpeta
│   ├── index.html                # Tienda
│   ├── admin.html                # Acceso y panel administrativo
│   ├── assets/                   # Ilustraciones SVG locales de demostración
│   ├── vendor/bootstrap.min.css  # Bootstrap 5.3.3, licencia MIT incluida
│   └── src/
│       ├── config.js             # URL y clave pública de Supabase
│       ├── api.js                # Datos, Auth, Storage y pedidos
│       ├── demo.js               # Catálogo demostrativo, nunca persistido
│       ├── store.js              # Catálogo, carrito y checkout
│       ├── cart.js               # Estado y cálculo del carrito
│       ├── whatsapp.js           # Mensaje y enlace
│       ├── admin.js              # Administración protegida
│       ├── utils.js              # Escape HTML, formatos y controles
│       └── styles.css            # Identidad visual y responsive
├── supabase/
│   ├── config.toml
│   ├── migrations/001_shop.sql   # Tablas, RLS, funciones y bucket
│   ├── seed.sql                  # Productos de ejemplo opcionales
│   └── functions/create-order/index.ts
├── tests/
│   ├── core.test.js
│   ├── database.test.js
│   └── dom.test.js
├── scripts/check.mjs
├── docs/PRUEBAS_MANUALES.md
├── .env.example
├── package.json
└── README.md
```

## 1. Ejecutar localmente

Descomprime el proyecto y abre su carpeta en VS Code. No abras `index.html` con doble clic: los módulos requieren HTTP.

Con Python 3:

```bash
python -m http.server 8080 --directory dist
```

Abre `http://localhost:8080`. También puedes usar Live Server, seleccionando `dist` como raíz. Para ver el panel entra en `/admin.html` y pulsa “Explorar panel de demostración”.

La tienda no necesita npm ni compilación para funcionar. Node.js 22+ y npm solo son necesarios para las pruebas:

```bash
npm install
npm run check
npm test
```

## 2. Crear y configurar Supabase

1. Crea un proyecto en https://supabase.com/dashboard y espera su preparación.
2. En SQL Editor, ejecuta **todo** `supabase/migrations/001_shop.sql`. Está pensado para un proyecto nuevo; no vuelvas a ejecutarlo sobre las mismas tablas.
3. Opcional: ejecuta `supabase/seed.sql` para cargar ejemplos. Los datos usan imágenes locales de `dist/assets`. Reemplázalos por tu inventario real antes de vender.
4. En la configuración API del proyecto, copia la URL y la clave pública anon o publishable.
5. Modifica únicamente estos valores de `dist/src/config.js`:

```js
supabaseUrl: 'https://TU-PROYECTO.supabase.co',
supabaseAnonKey: 'TU_CLAVE_PUBLICA',
```

No uses la clave secreta/service_role aquí. No hace falta ocultar la clave pública: los permisos efectivos están en RLS.

`config.js` es la configuración pública de un sitio sin compilador: `.env.example` es una guía de valores, no se carga automáticamente en el navegador.

## 3. Crear el primer administrador

1. En Supabase → Authentication → Users, crea/invita al usuario que administrará la tienda. Para ingreso inmediato, configura una contraseña y confirma su correo mediante las herramientas administrativas de tu proyecto.
2. Copia su UUID.
3. Ejecuta desde SQL Editor del propietario:

```sql
insert into public.profiles(id, display_name, role)
values ('UUID_DEL_USUARIO', 'Administrador', 'admin')
on conflict (id) do update set role = excluded.role;
```

4. Entra en `/admin.html` con ese correo y contraseña.

No hay registro público administrativo ni una contraseña preconfigurada. Para retirar acceso, cambia `role` a `customer`; las políticas revisan el rol en la base de datos. Usa las herramientas de Auth para restablecer una contraseña si es necesario.

## 4. Configurar Storage

La migración ya crea el bucket `shop-images`:

- Público para que el catálogo pueda mostrar imágenes.
- Máximo 3 MB por archivo.
- JPG, PNG y WebP. No se aceptan SVG subidos por usuarios.
- Escritura y eliminación solo para administradores.

En Productos, sube una foto principal y, si quieres, varias imágenes de galería. También puedes usar una URL HTTPS o una ruta local `assets/archivo.svg` para los recursos de desarrollo. Al reemplazar/eliminar, se borra el archivo de Storage si ninguna otra fila sigue utilizándolo. Los fallos de subida o base de datos se notifican; si una subida se completó y después falló la escritura, revisa Storage para limpiar archivos sin uso.

## 5. Publicar la Edge Function

Instala la CLI de Supabase siguiendo https://supabase.com/docs/guides/cli. Desde la raíz del proyecto:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase secrets set ALLOWED_ORIGINS="http://localhost:8080,https://TU-DOMINIO"
supabase secrets set RATE_LIMIT_SECRET="TU_SECRETO_ALEATORIO_DE_AL_MENOS_32_BYTES"
supabase functions deploy create-order --no-verify-jwt
```

Genera un secreto propio (por ejemplo, con `openssl rand -hex 32`). No lo copies a un archivo público ni al repositorio. `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se suministran automáticamente en el entorno de Edge Functions.

El endpoint recibe compras de invitados; por eso `verify_jwt = false` es intencional. Solo esa función utiliza service_role y solo para invocar las funciones SQL de creación/límites. **No desactives RLS**.

Agrega al listado de orígenes la URL exacta de tu frontend, sin barra final. Si despliegas en un subdirectorio, el origen sigue siendo únicamente esquema + dominio + puerto. CORS no es autenticación; la función también valida el cuerpo y aplica límites en base de datos.

Límites iniciales: 20 solicitudes por IP hash por hora y 500 globales por hora, incluidos reintentos. La IP depende de la cabecera del proxy de Supabase y no constituye identidad fuerte; la cuota global limita abusos con cabeceras manipuladas. Ajusta cuotas y agrega CAPTCHA antes de campañas con alto tráfico si lo necesitas. No se almacenan IP sin hash.

## 6. Configurar tu tienda y recibir pedidos

En Administración → Configuración:

- Nombre, logo, color, portada, descripción, contacto y horario.
- WhatsApp real, con código de país y solo dígitos. Para Perú empieza por `51` seguido de tu número real. No uses ejemplos para recibir pedidos.
- Dirección real para recojo y enlace a redes.

En Métodos de pago:

- Yape/Plin: nombre, titular, teléfono e instrucciones; QR opcional propio.
- Bancos: banco, titular, moneda, cuenta y CCI en el campo de detalles.
- Activa cada método solo cuando sus datos estén completos. La migración los crea **inactivos** para impedir cobros con ejemplos.

En Zonas de reparto, define nombres claros (por ejemplo, los distritos atendidos) y tarifas. El cliente selecciona la zona; confirma que corresponde a su dirección antes de aprobar el pedido. Si no selecciona una zona, se muestra “Envío por confirmar”. El importe final de ese envío se coordina por WhatsApp y queda documentado en observaciones; esta versión no recalcula una tarifa administrativa posterior sobre el recibo histórico. El recojo cuesta S/ 0.

## 7. Flujo y política de stock

- **Pendiente → Confirmado → En preparación → Enviado → Entregado.** Para recojo, se puede pasar de En preparación a Entregado.
- Se puede cancelar un pedido Pendiente, Confirmado o En preparación.
- Pendiente no reserva inventario. Al confirmar se bloquean las filas de productos y se descuentan unidades en una transacción. Si falta una unidad, falla la confirmación completa.
- Confirmar el mismo pedido repetidamente no vuelve a descontar.
- Cancelar un pedido con stock descontado lo restaura una sola vez. Los pedidos cancelados no se reabren.
- No se cancelan enviados/entregados desde este flujo. Las devoluciones y reembolsos requieren un módulo posterior.
- Pago se gestiona independientemente: Pendiente / En revisión / Pagado. Cancelar un pedido pagado no revierte el abono; coordina y documenta el reembolso aparte.
- El cliente revisa los precios; si cambiaron, la creación se rechaza, el catálogo se refresca y debe enviar de nuevo.
- Un UUID y una huella del pedido evitan duplicar un mismo intento. La base de datos serializa llamadas con esa clave. Cambiar productos, datos o precios crea un nuevo intento.
- El recibo y el intento sobreviven a la recarga dentro de la pestaña mediante sessionStorage. Al cerrar la pestaña se pierde ese estado local; la tienda conserva el pedido en Supabase. El carrito no se borra al abrir WhatsApp.

## 8. Desplegar el frontend

Publica **el contenido de `dist/`** en un hosting estático con HTTPS. La raíz debe contener `index.html` y `admin.html`. No hay build obligatorio ni servidor Node en producción.

Después:

1. Verifica `config.js` con URL/clave pública del proyecto.
2. Añade el dominio a `ALLOWED_ORIGINS` de la Edge Function.
3. Configura la URL del sitio en Supabase Auth para invitaciones o recuperación gestionadas desde Auth.
4. Comprueba que cargan JS, CSS e imágenes.
5. Ejecuta la lista de pruebas manuales con un pedido propio antes de compartir la tienda.

HTTPS es necesario para geolocalización y portapapeles; localhost es una excepción habitual del navegador. Si el navegador bloquea la apertura automática de WhatsApp, el recibo incluye un enlace manual y un botón para copiar el mensaje.

## 9. Adaptar para otro negocio

- Cambia Configuración y categorías desde el panel.
- Sustituye los SVG y datos demo por fotos/productos propios.
- Ajusta variables de color en `styles.css`; el color primario también se configura en el panel.
- Cambia moneda/locale en `config.js` y los textos “S/” de formularios si sales de Perú. `utils.js` utiliza esa configuración para formatear los importes.
- Conserva `api.js` como frontera de acceso a datos y `whatsapp.js` como generador de mensaje.
- No mezcles código del servidor con `dist/`.
- Para migraciones futuras crea nuevos archivos SQL; no modifiques una migración ya aplicada esperando que se ejecute automáticamente.

## 10. Pruebas y límites

`npm test` ejecuta pruebas unitarias, DOM y transacciones PostgreSQL en memoria. Verifica cálculo, sanitización, RLS, restricciones de roles, Storage, precios, idempotencia, stock, archivado y rate limits. Las pruebas no contactan tu Supabase ni envían mensajes.

No incluye facturación SUNAT, pago automático, cálculo logístico por GPS, recuperación de contraseña dentro de la app, notificaciones automáticas, devoluciones ni un sistema multiempresa. Es una base de una sola tienda reutilizable copiando la estructura y usando un proyecto Supabase independiente.

## Referencias técnicas

- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Storage: https://supabase.com/docs/guides/storage/security/access-control
- Edge Functions: https://supabase.com/docs/guides/functions
- Auth en funciones: https://supabase.com/docs/guides/functions/auth
- Bootstrap: https://getbootstrap.com/docs/5.3/

Bootstrap mantiene su licencia MIT en el encabezado de `vendor/bootstrap.min.css`. Las ilustraciones SVG incluidas son recursos creados para esta base, no fotografías oficiales de fabricantes.

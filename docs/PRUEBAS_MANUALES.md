# Validación antes de abrir al público

Ejecutar contra un proyecto de prueba de Supabase y con tu propio WhatsApp. No usar datos reales de otros clientes.

## Tienda y responsive

- [ ] Revisar a 360 px, 768 px y 1440 px: no hay desbordamientos, el catálogo y carrito se leen.
- [ ] Navegar con Tab, abrir/cerrar diálogos y comprobar foco visible.
- [ ] Buscar nombre, SKU y marca; filtrar categoría, máximo, stock; ordenar; cambiar página; limpiar.
- [ ] Consultar detalle, especificaciones y galería.
- [ ] No se pueden agregar agotados ni exceder el stock disponible.
- [ ] Cambiar cantidades, quitar, recargar: solo el carrito persiste en localStorage.
- [ ] Simular red desconectada: error y reintento visibles.

## Administración

- [ ] Usuario administrador puede ingresar; un usuario sin rol no puede.
- [ ] Visitante no puede escribir productos por REST aunque conozca la clave pública.
- [ ] Crear, editar y eliminar producto con imagen; subir galería y quitar imagen.
- [ ] Probar archivo no permitido y mayor de 3 MB.
- [ ] Archivar producto con pedidos: el historial conserva SKU, nombre y precio.
- [ ] Crear/editar categoría; eliminar una ocupada muestra error.
- [ ] Cambiar marca, logo, color, portada, WhatsApp y contacto; recargar tienda.
- [ ] Configurar Yape, Plin, transferencia y QR real; activar métodos.
- [ ] Configurar una zona y tarifa. Asegurar que la zona se identifica claramente.

## Pedido

- [ ] Envío exige dirección, departamento, provincia y distrito. Recojo no los exige.
- [ ] Permitir ubicación adjunta enlace correcto; rechazar permiso permite continuar.
- [ ] Sin zona: envío por confirmar y subtotal provisional. Con zona: tarifa y total.
- [ ] Modificar precio o stock desde otra sesión antes de enviar: el servidor rechaza el pedido y pide revisión.
- [ ] Revisar que el mensaje incluye número, fecha, productos, cantidades, precios, importes, cliente, dirección, ubicación autorizada, entrega y pago.
- [ ] Abrir WhatsApp deja pedido pendiente y pago pendiente; el carrito continúa intacto.
- [ ] Bloquear popup: enlace manual y copiar mensaje funcionan.
- [ ] Reintentar mismo pedido o doble clic: una sola fila en orders.
- [ ] Recargar misma pestaña: se puede reabrir el último pedido desde el carrito.

## Stock y seguridad

- [ ] Confirmar pedido descuenta una vez; repetir confirmación no duplica descuento.
- [ ] Intentar confirmar sin stock: no cambia ni estado ni inventario.
- [ ] Cancelar confirmado restaura una vez; cancelar pendiente no modifica stock.
- [ ] Pedido enviado no admite cancelación desde este flujo.
- [ ] Marcar pagado solo después de ver el abono; el cambio exige confirmación administrativa.
- [ ] Desde anon y usuario no administrador, no se pueden leer clientes/pedidos ni subir imágenes.
- [ ] Revisar DevTools: no aparece service_role ni RATE_LIMIT_SECRET en archivos públicos.
- [ ] Ejecutar una prueba de dos administradores confirmando pedidos competidores contra Supabase real para verificar concurrencia del despliegue.

## Resultados de esta entrega

Las pruebas automatizadas se ejecutan con `npm test`. Esta lista no está marcada como completada: requiere credenciales y validación en tu dominio/proyecto real.

# Auto Sigue v3.2.4

Extensión Manifest V3 para continuar en la misma conversación.

## Controles
- Activa Auto Sigue en cada conversación.
- En «Qué debe enviar Auto Sigue», cambia el mensaje y la frase que debe indicar la IA cuando haya terminado; pulsa Guardar mensajes.
- La instrucción que se envía pide que el modelo termine su última respuesta con esa frase, para parar Auto Sigue.
- En Ajustes avanzados, configura el retardo tras terminar, el máximo de envíos (0 = ilimitados) y el envío por tiempo ante bloqueos.

## Precauciones
- El envío por tiempo intenta detener una generación excesivamente larga antes de enviar. Si no hay botón Detener o no puede comprobarse el envío, se muestra un error y no se insiste automáticamente.
- 0 no anula las protecciones frente a duplicados, errores de interfaz ni finalización de tarea.
- El motor genérico para otras IA depende de la interfaz de cada plataforma. Sin prueba real por plataforma no se garantiza su compatibilidad.
- No hay migración a otro chat ni borrado automático.

## Instalación
Extraer el ZIP, abrir chrome://extensions, activar Modo desarrollador, cargar la carpeta descomprimida y recargar las pestañas de IA. Desactivar versiones anteriores para evitar duplicados.

# Auto Sigue 3.4.1 - continuidad mas robusta

Esta version parte de la 3.3.1 instalada en Chrome y conserva sus rutas de otras IA, los ajustes, la cola de pasos, el popup y los iconos.

## Reparacion
- Bitacora por chat y turno en chrome.storage.local (estado reservado, clic, confirmado o incierto).
- Una sola pestaña puede reservar un mismo turno. Evita duplicar envios al recargar o tener dos pestañas del mismo chat.
- Reserva registrada ANTES de pulsar Enviar y confirmacion guardada despues.
- Si se intenta un clic que no se puede confirmar, no se repite automaticamente.
- Cuenta de continuaciones persistente tras recargar.
- Comprobacion por alarma cada minuto mientras Chrome esta abierto; intenta impedir que Chrome descarte las pestañas activadas.
- Retraso progresivo de reintentos solo cuando no hubo clic.

## LIMITACIONES IMPORTANTES
- No convierte ChatGPT en un servicio garantizado 24/7: Chrome debe permanecer abierto, con equipo despierto, conexion, sesion activa y uso permitido por el plan.
- No elude limites de ChatGPT, captchas, errores de red ni las ventanas de contexto.
- No pasa a un chat nuevo automaticamente cuando se alcanza la longitud maxima: ese comportamiento estaba deshabilitado en 3.3.1 y no se ha reactivado sin validacion real.
- No se debe confundir un clic con un envio recibido por el servidor. FAIL/NO COMPROBABLE se muestran sin reintentos a ciegas.
- El boton de reinicio de estado no borra un registro de clic ambiguo; hay que resolverlo revisando primero los mensajes.

## Instalacion
La version 3.3.1 original no se altera por este paquete. En chrome://extensions desactivar 3.3.1, cargar la carpeta Auto_Sigue_3.4.1_REPARADO_24H, recargar ChatGPT y comprobar v3.4.1. Conservar una sola extension Auto Sigue activa.

# AUTO SIGUE 3.4.1

Objetivo: reenvio automatico de continuaciones en el mismo chat.

Mejoras:
- Transaccion persistente por chat y turno. Reserva previa al clic.
- Marcador visible [AS_TX:UUID] en cada mensaje para comprobar su recepcion.
- Confirmacion basada en burbuja real de usuario que contiene el marcador exacto.
- Recuperacion tras recarga comparando el marcador contra el historial.
- Nunca repetir de forma automatica un envio ambiguo sin confirmacion.
- Reintento gradual solo antes de pulsar Enviar.
- Alarmas cada minuto mientras Chrome esta abierto, sin recargar pestañas descartadas.

Limites:
- No garantiza 24/7 si Chrome esta cerrado, Windows suspendido, Internet se corta, sesion termina o ChatGPT limita mensajes.
- No migra de chat al agotar contexto; esa funcion de la rama original esta deshabilitada.
- Marcador tecnico visible en el historial del chat.
- No se ha probado un envio real contra ChatGPT; no confundir instalacion con funcionamiento completo.

QA: revisar QA/test_reparacion_v341.py. Conservar instalacion anterior como rollback.
Instalacion: desactivar version 3.4.0, cargar descomprimida la carpeta 3.4.1 y recargar ChatGPT. Nunca dos extensiones Auto Sigue activas.

La reconciliacion puede funcionar incluso tras reiniciar Chrome con otro ID de pestaña, pero exige que el marcador figure en un mensaje de usuario visible.

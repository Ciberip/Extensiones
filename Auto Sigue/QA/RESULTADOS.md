# Pruebas v3.2.4 (16/10/2026)

- OK: comprobación de sintaxis de los 7 archivos JavaScript; manifiesto JSON válido y rutas de iconos existentes.
- OK: prueba del panel con Chromium en entorno simulado: activación individual, edición/guardado del mensaje de continuación y frase final, 0 ilimitado y temporizador 5 min, pestaña Rutas IA, anchura fija sin desbordamiento.
- OK: prueba del motor genérico con IA simulada y tiempo acelerado: al alcanzar el umbral, pulsa un control Detener identificable, envía exactamente una continuación y confirma el mensaje del usuario. Cuando aparece el marcador final, se detiene.
- OK: test de función maxReached en ChatGPT: 0 = ilimitado; un máximo positivo sigue aplicándose.
- OK: seis recursos de icono idénticos bit a bit a v3.2.3.
- NO COMPROBABLE: ejecución real de la extensión en el Chrome del usuario y envío real en cada servicio externo.
- Limitación: si la IA no permite detener una generación o identificar un botón Enviar, la extensión no puede forzar el envío con seguridad y deja constancia del fallo.

Los PNG de esta carpeta son capturas de pruebas simuladas y no pruebas de uso en servicios reales.

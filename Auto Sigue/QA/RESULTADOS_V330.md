# Pruebas de Auto Sigue v3.3.0 — 21/10/2026

Entorno: Chromium headless con DOM simulado de conversación y `chrome.storage` simulado, sin acceso a las cuentas reales.

- OK: sintaxis de todos los scripts JS (`node --check`), JSON del manifiesto e iconos conservados.
- OK: tras respuesta del asistente envía 2 mensajes `autosigue`, uno tras otro, confirma que figuran como mensajes del usuario y para cuando la última línea indica `HE ACABADO`.
- OK: al actualizar desde los valores heredados `sigue`/12, los predeterminados pasan a `autosigue`/0 (ilimitado).
- OK: una respuesta que menciona `HE ACABADO` en el cuerpo **no** detiene la continuación.
- OK: botón Enviar deshabilitado: no envía falsamente, vuelve a intentarlo y retira el borrador propio.
- OK: mensaje del usuario pendiente de respuesta: no manda otra continuación hasta que aparece la respuesta del asistente.
- OK: motor genérico: recibe respuestas rápidas sin haber observado botón Detener; envía 2 veces y acaba al leer marcador final.
- NO COMPROBABLE: envío en el Chrome del usuario, servicios externos, restricciones de uso, pestaña suspendida y cambios de interfaz de ChatGPT.

Comandos en un entorno con Python + Playwright + Chromium:

```bash
python QA/test_chatgpt_330.py
python QA/test_generic_330.py
```

Estos tests alteran solo un DOM artificial y sustituyen la interfaz `chrome.*` por un simulador, no realizan envíos reales.

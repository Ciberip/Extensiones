# Pruebas v3.3.1 — 21/10/2026

- OK: `manifest.json` se encuentra directamente en la raíz del ZIP y de la carpeta descomprimida.
- OK: `manifest_version: 3` y versión `3.3.1` legibles por JSON.
- OK: todos los scripts, iconos y popup que referencia el manifiesto existen.
- OK: todos los `.js` validan con `node --check`.
- OK: pruebas de lógica de continuación en DOM simulado (`test_chatgpt_330.py`, `test_generic_330.py`).
- NO COMPROBABLE: carga en Chrome real del usuario. En el Chromium headless disponible el service worker de la extensión no apareció; no se da por validada la instalación en el navegador real.

## Corrección

El ZIP v3.3.0 tenía los archivos dentro de una subcarpeta `Auto Sigue/`, por lo que elegir el directorio externo ocasionaba "Falta el archivo de manifiesto".
En v3.3.1 la raíz extraída ya contiene directamente `manifest.json`.

# Auto Sigue v3.4.1

Extensión Chrome Manifest V3. Se ha actualizado la extensión original del ZIP (sin crear otra app).

## Funcionamiento

- Activa el interruptor global y **Auto Sigue en este chat** en cada conversación.
- Tras completar y estabilizarse cada respuesta, envía **autosigue** (configurable) en la misma conversación.
- El mensaje recuerda a la IA que debe escribir **HE ACABADO** en la última línea cuando termine la tarea.
- **Solo** ese marcador como última línea de la respuesta del asistente marca la tarea como terminada. Una mención incidental a la frase no cuenta.
- El límite predeterminado es **0 = ilimitado**. El límite personalizado distinto de cero se respeta.
- Si faltan temporalmente el editor o el botón Enviar, reintenta con espera progresiva (4, 8, 16 y 30 s).
- Nunca pisa mensajes escritos manualmente. Comprueba un envío por aparición del mensaje del usuario antes de continuar.
- Si hubo clic sin confirmación, bloquea nuevos envíos para evitar duplicados y muestra REVISAR en el panel. Esta es una protección, NO significa que la tarea haya terminado.
- Si otro mensaje del usuario espera respuesta, no envía otra continuación.
- Se conserva el botón de desactivación voluntaria y el modo de envío manual.

## Instalación o actualización

Descomprime el ZIP. En `chrome://extensions`, activa *Modo desarrollador*, desactiva la versión antigua y pulsa **Cargar descomprimida** sobre la carpeta extraída `Auto_Sigue_3.4.1_CARGAR_DIRECTO`, que contiene `manifest.json` DIRECTAMENTE en su raíz. No selecciones el ZIP ni una carpeta superior. Recarga ChatGPT. No actives dos copias simultáneamente.

## Limitaciones

- Chrome/ChatGPT pueden cambiar sus interfaces; los envíos reales requieren una prueba en el navegador del usuario.
- Si la pestaña está suspendida o el navegador cerrado, no puede continuar. El navegador puede ralentizar los temporizadores en segundo plano.
- Los errores de red o de capacidad/límites de ChatGPT no se pueden superar por parte de la extensión.
- Tras un clic de envío **sin confirmación**, no se reintenta automáticamente: evitar duplicados tiene prioridad sobre seguir a ciegas.
- En otras plataformas se utilizan selectores genéricos, menos fiables, y conviene hacer una prueba por cada servicio.
- No se crean ni se borran chats automáticamente.

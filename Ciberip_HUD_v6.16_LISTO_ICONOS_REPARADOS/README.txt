Ciberip HUD v6.16.0 — reparación de iconos y grupo LISTO

Cambios de esta versión:
- El favicon verde de LISTO se mantiene mientras el chat esté pendiente, incluso si ChatGPT modifica el <head>.
- Al abrir, reabrir o recargar un chat pendiente, sale de LISTO y recupera explícitamente el favicon normal.
- La salida de LISTO ya no depende de que el estado interno siga marcado exactamente como done.
- El grupo LISTO se crea/verifica con reintentos y se repara si Chrome pierde o cambia la agrupación.
- Al reiniciar Chrome se reparan los chats pendientes en segundo plano y se reconocen los que ya estén visibles.
- Se conserva el resto del comportamiento de v6.15.

Ciberip HUD v6.15

- Solo aparecen chats cuya pestaña está realmente abierta en Chrome.
- Al cerrar una pestaña, desaparece inmediatamente del HUD y se reconcilia la lista completa.
- Al terminar un chat, su pestaña queda marcada permanentemente con favicon verde y título [LISTO].
- La marca se mantiene aunque ChatGPT cambie el título o la pestaña se recargue en segundo plano.
- La marca solo se quita al entrar manualmente en esa pestaña, abrirla desde el HUD o abrir la notificación.
- Se preservan los grupos reales de Chrome: no se recolorea un grupo completo por un solo chat terminado.
- Mantiene HUD global, grupos, cronómetro, exclusiones, movimiento bloqueado y volumen 0-100 %.


v6.14
- Al terminar: favicon/título LISTO + color verde real en la barra de pestañas.
- Si el chat ya está en un grupo, el grupo pasa a verde y se restaura al abrir el último chat LISTO del grupo.
- Si el chat no tiene grupo, se crea temporalmente un grupo verde LISTO y se elimina al abrir el chat.
- La ventana también pide atención en la barra de tareas al terminar.


v6.15: Un único grupo verde LISTO por ventana. Los terminados se fusionan ahí, el grupo se pliega tras cada alta, y al abrir un chat sale de LISTO (vuelve a su grupo original si sigue existiendo). Los grupos LISTO antiguos se consolidan automáticamente.

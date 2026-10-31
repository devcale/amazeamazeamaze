# XENOLINGUISTIC COMMUNICATION TERMINAL

Soundboard para dos personas con estética de consola de nave espacial (terminal de comunicación Grace ⇄ Rocky).

- **`/console`** — se abre en el computador conectado al parlante. Es el **único** dispositivo que reproduce audio. Muestra el QR de vinculación, el banco de sonidos, el registro de transmisiones y responde al teclado.
- **`/remote`** — se abre en el celular escaneando el QR. Envía órdenes y muestra si el computador las aceptó y las reprodujo. No reproduce audio.

```
celular ──POST /api/sessions/:id/play──▶ servidor ──Socket.IO command:play──▶ consola (Web Audio)
celular ◀──Socket.IO command:result──── servidor ◀──Socket.IO command:result── consola
```

La respuesta HTTP `202` significa «orden aceptada». La confirmación «sonando» llega después por Socket.IO; si no llega en 4 s el mando lo indica como *sin confirmación*.

Stack: React + TypeScript + Vite (cliente) · Node.js + Express + Socket.IO (servidor). Sin cuentas, sin base de datos.

---

## 1. Instalación

Requisitos: Node.js 18 o superior (probado con 20) y npm.

```bash
npm install
npm run demo-sounds      # genera 8 sonidos de DEMOSTRACIÓN en client/public/audio/ (sólo la primera vez)
```

## 2. Arrancar

### Uso normal (un solo origen, puerto 3000)

```bash
npm start
```

Compila el frontend y arranca el servidor en `http://0.0.0.0:3000`. Abre **`http://localhost:3000/console`** en el computador. El terminal también imprime las direcciones de red local disponibles.

Si ya compilaste y sólo quieres arrancar el servidor: `npm run serve`.

### Desarrollo (recarga en caliente)

```bash
npm run dev
```

Vite sirve el frontend en `http://localhost:5173` y reenvía `/api` y `/socket.io` al servidor Node en `:3000`. Abre `http://localhost:5173/console`. El QR usará automáticamente el puerto 5173.

### Variables opcionales

| Variable          | Uso                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `PORT`            | Puerto del servidor (por defecto `3000`).                                                                    |
| `HOST`            | Interfaz de escucha (por defecto `0.0.0.0`, toda la red local).                                              |
| `PUBLIC_BASE_URL` | URL base fija para el QR, p. ej. `http://192.168.1.20:3000`, si tienes varias interfaces de red o un proxy. |

En PowerShell: `$env:PORT=4000; npm start`.

## 3. Vincular el celular

1. En la consola, el panel **REMOTE LINK** muestra un QR y el enlace `http://<IP-del-computador>:3000/remote?s=…&t=…`.
2. Asegúrate de que el celular está en la **misma red Wi‑Fi o hotspot** que el computador.
3. Escanea el QR (o copia el enlace y envíalo al celular). Se abre el mando.
4. En la consola, la lámpara **REMOTE** se enciende y «Mandos» pasa a `1 CONECTADO`.

El QR **nunca** usa `localhost`. El desplegable «Dirección accesible desde el celular» permite elegir otra interfaz de red o escribir la URL manualmente (se recuerda en el navegador). El selector prioriza adaptadores Wi‑Fi y redes privadas (`192.168.x.x`, `10.x.x.x`) frente a adaptadores virtuales (VirtualBox, VMware, WSL…).

Seguridad de la sesión: el enlace contiene un **token aleatorio**. El servidor rechaza cualquier orden sin ese token (`403`). Solo puede existir **una consola activa por sesión**; si abres `/console` en otra pestaña o equipo, la anterior queda inactiva y lo indica. «Regenerar token» expulsa a todos los mandos y obliga a escanear un QR nuevo. La sesión se guarda en el navegador de la consola, así que el QR sigue siendo válido aunque recargues la página o reinicies el servidor.

## 4. Activar el audio

Los navegadores bloquean el sonido hasta una interacción del usuario. Al abrir la consola pulsa **«Activar audio»** (botón ámbar). Cuando aparezca «● Audio activo» y la lámpara AUDIO en verde, el banco queda habilitado.

Hasta entonces el servidor rechaza las órdenes del celular con `409 AUDIO_NOT_READY` y el mando muestra «Pulsa “Activar audio” en el computador».

## 5. Uso

**Consola**

- Clic en un botón del AUDIO BANK o su tecla: `Q W E R A S D F`.
- `Escape` o «Detener todo»: corta el sonido actual.
- Cada sonido nuevo **interrumpe** al anterior, venga del teclado, de un clic o del celular.
- Los atajos no se disparan mientras escribes en un campo de texto, ni al mantener pulsada una tecla.
- Volumen maestro (se recuerda), pantalla completa, panel QR mostrable/ocultable.
- TRANSMISSION LOG: hora, sonido y origen (`TECLADO`, `CONSOLA`, `CELULAR`, `SISTEMA`).

**Mando**

- Botones grandes; al tocar: hundido → LED ámbar «ACEPTADA» → verde «SONANDO» (o rojo «FALLO» con el motivo en la pantalla superior).
- «DETENER TODO» fijo en la parte inferior, respetando las *safe areas*.
- Lámparas LINK (servidor), CONSOLA (computador conectado), AUDIO (audio activado).
- Si la consola está caída o el audio no está activado, la orden se rechaza al instante; **no se encola** para después.

## 6. Sustituir los sonidos de demostración por tus grabaciones

Los archivos `client/public/audio/demo-*.wav` son tonos sintéticos generados por `scripts/generate-demo-sounds.mjs` y están marcados con la etiqueta **DEMO**. No son grabaciones reales.

1. Copia tu archivo a `client/public/audio/` (formatos que decodifica el navegador: `.wav`, `.mp3`, `.ogg`, `.m4a`, `.flac`…). Usa nombres sin rutas ni caracteres raros.
2. Edita `shared/sounds.json`: cambia `"file"` por tu archivo y quita `"demo": true`.
3. Recarga la consola (en modo `npm start` no hace falta reiniciar; el servidor relee el catálogo. Si añadiste archivos nuevos y Vite dev no los ve, reinicia `npm run dev`).

Ejemplo de entrada:

```json
{ "id": "saludo", "name": "Hola, Rocky", "file": "hola-rocky.mp3", "key": "q", "category": "social", "color": "#5fd7ff" }
```

Los archivos que falten o no se puedan decodificar aparecen en rojo como **SIN ARCHIVO** / **ERROR DECOD.** y quedan deshabilitados en consola y mando; el resto sigue funcionando.

## 7. Editar nombres, atajos y añadir sonidos

Todo está en **`shared/sounds.json`**:

| Campo      | Descripción                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| `id`       | Identificador único (`a-z`, `0-9`, `_`, `-`). Es lo que viaja en las órdenes.   |
| `name`     | Nombre visible (puede llevar tildes y espacios).                               |
| `file`     | Nombre del archivo dentro de `client/public/audio/`.                           |
| `key`      | Tecla única (una letra o dígito, minúscula).                                   |
| `category` | Texto libre que se muestra bajo el nombre.                                     |
| `color`    | Opcional, color de acento (`#rrggbb`).                                         |
| `demo`     | Opcional, `true` muestra la etiqueta DEMO.                                     |

Para **añadir** un sonido: copia el archivo y añade una entrada. El servidor valida el catálogo al leerlo (ids y teclas duplicadas, nombres de archivo con rutas, etc.) y, si hay un error, conserva la última versión válida y lo informa en el terminal.

## 8. Problemas comunes

**El celular no abre el enlace / «no se puede acceder al sitio».**

- Comprueba que ambos están en la misma red. Un hotspot del celular al que se conecta el computador también vale.
- **Firewall de Windows**: la primera vez que arranca, Windows pregunta si permitir a *Node.js* en redes privadas: acepta. Si lo denegaste: *Firewall de Windows Defender → Permitir una aplicación* y marca Node.js en «Privada», o crea la regla en PowerShell (administrador):
  ```powershell
  netsh advfirewall firewall add rule name="Soundboard 3000" dir=in action=allow protocol=TCP localport=3000
  ```
  (usa `5173` también si trabajas con `npm run dev`).
- La red del computador debe estar clasificada como **Privada**, no Pública.
- Routers con **aislamiento de clientes / AP isolation** (habitual en redes de invitados, hoteles, universidades) impiden que los dispositivos se vean. Usa el hotspot del celular o un router propio.
- Varias interfaces (VPN, VirtualBox, WSL): elige la IP correcta en el desplegable del panel QR o fija `PUBLIC_BASE_URL`. `ipconfig` muestra la IPv4 del adaptador Wi‑Fi.
- Prueba desde el celular `http://<IP>:3000/api/health`; debe responder `{"ok":true}`.

**El mando dice «Sesión inválida» / «Sesión no reconocida».** El enlace está incompleto, el token fue regenerado o la consola aún no se ha abierto tras un reinicio. Abre la consola y escanea el QR actual. Tras un reinicio del servidor el mando reintenta solo durante ~30 s.

**«La consola del computador no está conectada».** La pestaña de la consola está cerrada, en segundo plano suspendida o sin red. Vuelve a ella; el enlace se restablece solo y el mando lo refleja.

**Órdenes aceptadas pero sin confirmación.** El computador recibió la orden pero no respondió en 4 s: normalmente la pestaña está congelada (equipo suspendido, pestaña en segundo plano con ahorro de energía). Trae la consola al frente.

**No suena nada.** Pulsa «Activar audio», revisa el volumen maestro y el del sistema, y que el LED del botón esté en verde (LISTO).

## 9. Limitaciones

- La pestaña de la consola debe permanecer **abierta y visible** y el computador **despierto** (desactiva la suspensión y el apagado de pantalla si molesta). Los navegadores limitan el audio y los temporizadores en pestañas en segundo plano.
- Funciona en **red local**. Para usarlo entre redes distintas habría que desplegar el servidor en Internet (y usar HTTPS); no está contemplado.
- No hay autenticación más allá del token de sesión. Cualquiera que tenga el enlace puede disparar sonidos; regenera el token si se filtra.
- La sesión vive en memoria del servidor; la consola la recrea automáticamente con sus credenciales guardadas si el servidor se reinicia.

## 10. API

| Método | Ruta                                    | Auth                      | Respuesta                                               |
| ------ | --------------------------------------- | ------------------------- | ------------------------------------------------------- |
| GET    | `/api/sounds`                           | —                         | Catálogo con `fileExists`.                              |
| GET    | `/api/network`                          | —                         | IPs locales, puerto, `PUBLIC_BASE_URL`.                 |
| POST   | `/api/sessions`                         | opcional `consoleSecret`  | Crea o recupera la sesión de la consola.                |
| GET    | `/api/sessions/:sessionId`              | `Bearer <token>`          | Estado: consola online, audio listo, sonidos.           |
| POST   | `/api/sessions/:sessionId/play`         | `Bearer <token>`          | Body `{ soundId, commandId }` → `202` aceptada.         |
| POST   | `/api/sessions/:sessionId/stop`         | `Bearer <token>`          | Body `{ commandId }` → `202` aceptada.                  |
| POST   | `/api/sessions/:sessionId/rotate-token` | body `{ consoleSecret }`  | Nuevo token; expulsa a los mandos.                      |

Errores: `400` payload inválido · `403 INVALID_TOKEN` · `404 UNKNOWN_SOUND` · `409 AUDIO_NOT_READY` / `SOUND_UNAVAILABLE` · `503 CONSOLE_OFFLINE`. Un `commandId` repetido devuelve `200 { duplicate: true }` sin ejecutar la orden de nuevo. Las órdenes nunca se reintentan ni se reenvían tras una reconexión.

Eventos Socket.IO: consola → `console:state`, `command:result`; servidor → consola `command:play`, `command:stop`, `session:remotes`, `console:replaced`; servidor → mando `session:status`, `command:result`, `session:revoked`.

## 11. Estructura

```
shared/sounds.json          catálogo (único sitio que editar para sonidos/teclas)
scripts/generate-demo-sounds.mjs
server/src/index.ts         Express + Socket.IO, API, sesiones, estático en producción
server/src/{catalog,sessions,network}.ts
client/src/pages/ConsolePage.tsx   consola (/console)
client/src/pages/RemotePage.tsx    mando (/remote)
client/src/lib/audioEngine.ts      Web Audio: AudioContext único, precarga, política de interrupción
client/src/components/Display.tsx  pantalla central (canvas: retícula, onda real, progreso)
client/public/audio/               archivos de audio
```

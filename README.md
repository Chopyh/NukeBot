# Base de bot de Discord

Bot modular en TypeScript con discord.js, comandos `/ping` y `/cumple`, configuración por variables de entorno, gestión de errores y cierre de conexión con Ctrl+C.

## Requisitos

- Node.js 22.12 o superior y npm.
- Una aplicación con bot creada en el [portal de desarrolladores de Discord](https://discord.com/developers/applications).
- Un servidor de pruebas donde puedas instalar el bot.

## Configuración

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` a `.env` (PowerShell: `Copy-Item .env.example .env`).
3. Completa `DISCORD_TOKEN` con el token de la sección **Bot**, `DISCORD_CLIENT_ID` con el **Application ID** y `DISCORD_GUILD_ID` con el ID del servidor de pruebas. Configura `DATABASE_URL` para tu PostgreSQL local y `ADMIN_API_TOKEN` con un secreto aleatorio compartido por el bot y el panel. Para generar uno, ejecuta `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Para copiar el ID del servidor, activa el modo desarrollador en Discord.
4. Invita el bot con los scopes `bot` y `applications.commands`, y estos permisos: **Manage Roles**, **Manage Channels**, **Mute Members**, **Deafen Members** y **Move Members**. Coloca el rol del bot por encima de los roles que vaya a gestionar. El rol de cumpleaños quedará lo más alto posible sin superar el rol del bot ni `Dios`; si el rol del bot está debajo de `Dios`, el rol temporal también quedará debajo del rol del bot.
5. Para desarrollo local, ejecuta `npm run deploy:commands` para registrar `/ping` y `/cumple`, y después `npm run dev`. Los usuarios pueden usar `/cumple registrar` con día, mes, emoji y nombre de rol; `/cumple ver` consulta el registro y `/cumple borrar` lo elimina. En el día registrado, el bot añade el emoji al inicio de todos los canales de texto y voz, y crea/entrega el rol con permisos para silenciar, ensordecer y mover miembros de voz. El rol se elimina y los nombres de canales se restauran al terminar 24 horas. La fecha se calcula en `BIRTHDAY_TIMEZONE` (por defecto `Europe/Madrid`); los cumpleaños del 29 de febrero se celebran el 28 en años no bisiestos. El panel muestra los cumpleaños registrados por servidor. Para arrancarlo localmente, configura `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `BOT_API_URL=http://localhost:3001` y `PORT=3000` en `.env`, y ejecuta `node admin-panel/server.mjs` en otra terminal; abre `http://localhost:3000`.

El token es secreto: no lo subas al repositorio. `.env` está excluido por `.gitignore`.

## Scripts

| Comando | Función |
| --- | --- |
| `npm run dev` | Inicia el bot y lo reinicia al editar código |
| `npm run check` | Comprueba los tipos |
| `npm run build` | Compila a `dist/` |
| `npm start` | Ejecuta la versión compilada |
| `npm run deploy:commands` | Actualiza los comandos del servidor de pruebas |

Para producción ejecuta primero `npm run build` y después `npm start` con las variables configuradas.

## Añadir comandos

Crea un archivo en `src/commands/` siguiendo `ping.ts`, exporta un objeto de tipo `Command` e inclúyelo en la lista `definitions` de `src/commands/index.ts`. Registra de nuevo los comandos cuando cambies sus nombres, descripciones u opciones. Los cambios en su lógica solo requieren reiniciar el bot.

El registro reemplaza la lista de comandos de esta aplicación en el servidor indicado. Usa un servidor de pruebas dedicado. En ejecución local vuelve a ejecutar `npm run deploy:commands` si cambian los nombres, descripciones u opciones. El contenedor del bot registra los comandos automáticamente antes de cada inicio.

Si un comando tarda, llama a `interaction.deferReply()` antes de empezar el trabajo y a `interaction.editReply()` al terminar.

Documentación: [discord.js](https://discord.js.org/docs/packages/discord.js/14.27.0).

## Despliegue en Dokploy desde GitHub

El proyecto queda compuesto por tres servicios en el mismo proyecto de Dokploy: PostgreSQL (el servicio que ya tienes), el bot (`Dockerfile`) y el panel web (`Dockerfile.admin`). El bot y el panel comparten PostgreSQL para guardar y aplicar la configuración. Ambos Dockerfiles están en la raíz del repositorio y usan `.` como contexto.

El `Dockerfile` compila TypeScript en una etapa independiente y ejecuta el bot con Node.js 24, usuario sin privilegios y dependencias de producción. `Dockerfile.admin` ejecuta el servicio web con Node.js 24 y el usuario sin privilegios. Incluye `package-lock.json` en GitHub para que `npm ci` instale las versiones fijadas. No subas `.env`, `node_modules` ni `dist`.

### Servicio del bot

1. En el proyecto de Dokploy, crea o conserva una **Application** conectada al repositorio y rama del bot.
2. Selecciona construcción **Dockerfile**, ruta `Dockerfile` y contexto `.`.
3. En **Environment**, configura las variables con tus valores reales. `DATABASE_URL` debe usar el hostname interno del servicio PostgreSQL y sus credenciales; `ADMIN_API_TOKEN` debe ser un secreto largo aleatorio:

   ```dotenv
   DISCORD_TOKEN=token_del_bot
   DISCORD_CLIENT_ID=id_de_la_aplicacion
   DISCORD_GUILD_ID=id_del_servidor
   DATABASE_URL=postgresql://usuario:contraseña@<hostname-postgres>:5432/<base_de_datos>
   BIRTHDAY_TIMEZONE=Europe/Madrid
   ADMIN_API_TOKEN=<secreto-aleatorio-compartido-con-el-panel>
   BOT_API_PORT=3001
   ```

4. Mantén **una sola réplica**. En las opciones de Swarm, usa el orden de actualización **stop-first**. No publiques puertos ni asignes dominio al bot; el puerto `3001` solo se usa entre servicios en la red privada. Deja configurado el reinicio automático ante fallos.
5. Despliega. El contenedor registra `/ping` y `/cumple` en el servidor indicado por `DISCORD_GUILD_ID` antes de iniciar el bot, y repite el registro en cada arranque. Comprueba en logs `comando(s) registrado(s) en el servidor ...`, `Conectado como ...` y `API interna del panel escuchando en el puerto 3001`.

### Servicio del panel

1. Añade otra **Application** al mismo proyecto y conecta el mismo repositorio y rama.
2. Selecciona **Dockerfile**, ruta `Dockerfile.admin` y contexto `.`.
3. Configura estas variables. Usa el mismo `DATABASE_URL` y `ADMIN_API_TOKEN` del bot. `BOT_API_URL` debe apuntar al nombre DNS interno de la aplicación del bot:

   ```dotenv
   PORT=3000
   DATABASE_URL=postgresql://usuario:contraseña@<hostname-postgres>:5432/<base_de_datos>
   ADMIN_API_TOKEN=<el-mismo-secreto-del-servicio-del-bot>
   BOT_API_URL=http://<hostname-interno-del-bot>:3001
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<contraseña-larga-y-unica>
   ```

4. Asigna el dominio web al panel con HTTPS y puerto interno `3000`. No publiques el puerto `3001` del bot. La base de datos, el bot y el panel deben poder comunicarse por la red privada de Dokploy; usa los hostnames internos de esos servicios, no `localhost`.
5. Despliega. Abre el dominio, inicia sesión con `ADMIN_USERNAME` y `ADMIN_PASSWORD` y guarda la actividad o presencia desde **Configuración del bot**. Los ajustes persisten en PostgreSQL y el bot los aplica en un máximo de 15 segundos.

El panel usa autenticación HTTP Basic protegida por el HTTPS de Dokploy. La API interna del bot exige el token compartido y no tiene un dominio público. La primera vez, ambos servicios crean automáticamente la tabla `bot_configuration`; el panel no necesita una migración manual. Para futuras funciones se pueden añadir ajustes al documento JSON de esa tabla y controles al panel.

Si el servicio PostgreSQL está en una red aislada de Dokploy, conecta las tres aplicaciones a la misma red privada antes de desplegar. El hostname exacto depende del nombre que Dokploy haya asignado al servicio de base de datos y a la aplicación del bot.

El bot necesita además acceso saliente a Discord por HTTPS/WebSocket. Evita ejecutar simultáneamente el bot local y el de Dokploy con el mismo token.

Las variables se inyectan al ejecutar cada contenedor; no hacen falta tokens ni argumentos secretos durante la construcción. El proceso Node recibe directamente las señales de parada para cerrar sus conexiones.

### Comprobación local con Docker

```sh
docker build -t discord-bot -f Dockerfile .
docker build -t discord-bot-admin -f Dockerfile.admin .
```

Referencia: [aplicaciones y configuración de Dokploy](https://docs.dokploy.com/docs/core/applications).

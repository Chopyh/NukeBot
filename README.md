# Base de bot de Discord

Bot modular en TypeScript con discord.js, comando `/ping`, configuración por variables de entorno, gestión de errores y cierre de conexión con Ctrl+C.

## Requisitos

- Node.js 22.12 o superior y npm.
- Una aplicación con bot creada en el [portal de desarrolladores de Discord](https://discord.com/developers/applications).
- Un servidor de pruebas donde puedas instalar el bot.

## Configuración

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` a `.env` (PowerShell: `Copy-Item .env.example .env`).
3. Completa `DISCORD_TOKEN` con el token de la sección **Bot**, `DISCORD_CLIENT_ID` con el **Application ID** y `DISCORD_GUILD_ID` con el ID del servidor de pruebas. Para copiar el ID del servidor, activa el modo desarrollador en Discord.
4. En **OAuth2 > URL Generator**, selecciona los scopes `bot` y `applications.commands`. Abre la URL generada e instala el bot en tu servidor. Esta base no requiere permisos de administrador ni intents privilegiados.
5. Ejecuta `npm run deploy:commands` para registrar `/ping` en el servidor configurado.
6. Ejecuta `npm run dev` y prueba `/ping` en Discord.

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

El registro reemplaza la lista de comandos de esta aplicación en el servidor indicado. Usa un servidor de pruebas dedicado. No se registran comandos automáticamente al iniciar.

Si un comando tarda, llama a `interaction.deferReply()` antes de empezar el trabajo y a `interaction.editReply()` al terminar.

Documentación: [discord.js](https://discord.js.org/docs/packages/discord.js/14.27.0).

## Despliegue en Dokploy desde GitHub

El `Dockerfile` compila TypeScript en una etapa independiente y ejecuta el bot con Node.js 24, usuario sin privilegios y solo dependencias de producción. Incluye `package-lock.json` en GitHub para que `npm ci` instale las versiones fijadas. No subas `.env`, `node_modules` ni `dist`.

1. Crea un proyecto en Dokploy y un servicio de tipo **Application**.
2. En **General**, conecta GitHub, selecciona el repositorio y la rama que hayas subido.
3. Selecciona **Dockerfile** como tipo de construcción. Usa `Dockerfile` como ruta del archivo y `.` como contexto, ambos en la raíz del repositorio. Deja la etapa de construcción sin especificar para usar la etapa final.
4. En **Environment**, añade estas variables con sus valores reales y guarda:

   ```dotenv
   DISCORD_TOKEN=token_del_bot
   DISCORD_CLIENT_ID=id_de_la_aplicacion
   DISCORD_GUILD_ID=id_del_servidor
   ```

5. Mantén **una sola réplica**. En las opciones de Swarm, usa el orden de actualización **stop-first** para evitar que dos instancias del bot coincidan durante los despliegues. Deja configurado el reinicio automático ante fallos.
6. No añadas dominio, puertos publicados ni comprobaciones HTTP: este bot mantiene una conexión saliente con Discord y no sirve una web. No necesita volúmenes. El servidor debe poder acceder a Discord por HTTPS/WebSocket.
7. Pulsa **Deploy**. En los logs debe aparecer `Conectado como ...`.
8. Abre la terminal del contenedor en Dokploy y ejecuta una vez:

   ```sh
   node dist/deploy-commands.js
   ```

   También puedes ejecutar `npm run deploy:commands:prod`. Vuelve a registrar los comandos cuando cambies sus definiciones. Este paso reemplaza los comandos de la aplicación en el servidor configurado; no se ejecuta en cada arranque. Si prefieres registrarlos desde tu equipo, usa `npm run deploy:commands` con el mismo `.env`.

Prueba `/ping` en Discord. Puedes activar los despliegues automáticos desde GitHub cuando esté funcionando. Evita ejecutar simultáneamente el bot local y el de Dokploy con el mismo token.

Las variables se inyectan al ejecutar el contenedor; no hacen falta tokens ni argumentos secretos durante la construcción. El proceso Node recibe directamente las señales de parada para cerrar su conexión.

### Comprobación local con Docker

```sh
docker build -t discord-bot .
docker run --rm --env-file .env discord-bot
```

Para registrar comandos desde una imagen ya construida:

```sh
docker run --rm --env-file .env discord-bot node dist/deploy-commands.js
```

Referencia: [aplicaciones y configuración de Dokploy](https://docs.dokploy.com/docs/core/applications).

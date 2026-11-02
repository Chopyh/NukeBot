import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { requiredEnv } from './config.js';
import { startAdminApi } from './admin-api.js';
import { applySettings, createSettingsPool, ensureSettingsTable, readSettings } from './settings.js';
import { ensureBirthdayTables, startBirthdayScheduler } from './birthdays.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const settingsPool = createSettingsPool();
await ensureSettingsTable(settingsPool).catch(async (error) => {
  await settingsPool.end();
  throw error;
});
await ensureBirthdayTables(settingsPool).catch(async (error) => {
  await settingsPool.end();
  throw error;
});
let currentSettings = await readSettings(settingsPool);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Conectado como ${readyClient.user.tag}.`);
  applySettings(client, currentSettings);
});
startBirthdayScheduler(client, settingsPool);

client.on(Events.Error, (error) => console.error('Error del cliente:', error));
client.rest.on('rateLimited', (limit) => {
  console.warn(
    `[discord-rest] rate-limited scope=${limit.scope} global=${limit.global} method=${limit.method} route=${limit.route} major=${limit.majorParameter} retry_after_ms=${limit.retryAfter} bucket=${limit.hash}`,
  );
});
client.rest.on('invalidRequestWarning', (warning) => {
  console.warn(`[discord-rest] invalid-request-warning count=${warning.count} remaining=${warning.remainingTime}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const command = commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Este comando ya no está disponible.', flags: MessageFlags.Ephemeral });
      return;
    }
    await command.execute(interaction, { pool: settingsPool });
  } catch (error) {
    console.error(`Error en /${interaction.commandName}:`, error);
    try {
      const message = { content: 'Ha ocurrido un error al ejecutar el comando.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(message);
      else await interaction.reply(message);
    } catch (replyError) {
      console.error('No se pudo enviar el mensaje de error:', replyError);
    }
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log('Cerrando conexión con Discord…');
    client.destroy();
    void settingsPool.end();
  });
}

try {
  await client.login(requiredEnv('DISCORD_TOKEN'));
  startAdminApi(client, settingsPool);
  const refreshSettings = setInterval(() => {
    void readSettings(settingsPool).then((settings) => {
      currentSettings = settings;
      applySettings(client, settings);
    }).catch((error) => console.error('No se pudo actualizar la configuración:', error));
  }, 15000);
  refreshSettings.unref();
} catch (error) {
  console.error('No se pudo iniciar el bot:', error);
  client.destroy();
  process.exitCode = 1;
}

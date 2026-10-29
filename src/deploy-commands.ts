import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { requiredEnv, requiredId } from './config.js';

try {
  const rest = new REST({ version: '10' }).setToken(requiredEnv('DISCORD_TOKEN'));
  const clientId = requiredId('DISCORD_CLIENT_ID');
  const guildId = requiredId('DISCORD_GUILD_ID');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((command) => command.data.toJSON()),
  });
  console.log(`${commands.size} comando(s) registrado(s) en el servidor ${guildId}.`);
} catch (error) {
  console.error('No se pudieron registrar los comandos:', error);
  process.exitCode = 1;
}

import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { requiredEnv } from './config.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Conectado como ${readyClient.user.tag}.`);
});

client.on(Events.Error, (error) => console.error('Error del cliente:', error));

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const command = commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Este comando ya no está disponible.', flags: MessageFlags.Ephemeral });
      return;
    }
    await command.execute(interaction);
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
  });
}

try {
  await client.login(requiredEnv('DISCORD_TOKEN'));
} catch (error) {
  console.error('No se pudo iniciar el bot:', error);
  client.destroy();
  process.exitCode = 1;
}

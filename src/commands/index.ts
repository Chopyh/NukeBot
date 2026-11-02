import { Collection } from 'discord.js';
import { ping } from './ping.js';
import { cumple } from './cumpleanos.js';
import type { Command } from './types.js';

// Importa aquí tus nuevos comandos y añádelos a la lista.
const definitions: Command[] = [ping, cumple];
export const commands = new Collection<string, Command>();
for (const command of definitions) {
  if (commands.has(command.data.name)) throw new Error(`Comando duplicado: ${command.data.name}`);
  commands.set(command.data.name, command);
}

import { REST, Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { table } from 'console';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

// __dirname workaround for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
const commandsData = [];

// Path to commands folder
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Dynamically import each command module
for (const file of commandFiles) {
  const modulePath = `./commands/${file}`;
  const { data } = await import(modulePath);
  commands.push(data.toJSON());
  commandsData.push({ Command: data.name, Description: data.description });
}

// Display commands table
console.log('\n=== COMMANDS TO REGISTER ===');
if (commandsData.length > 0) {
  table(commandsData);
} else {
  console.log('No commands found to register.');
}

// Initialize REST client
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// Deploy commands
(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
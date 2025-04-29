// src/events/ready.js
import { Events } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);
    
    // Set bot status
    client.user.setPresence({
      activities: [{ name: 'với Hocmai.vn', type: 2 }],
      status: 'online',
    });
  },
};

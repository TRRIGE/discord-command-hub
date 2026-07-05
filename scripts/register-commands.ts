/**
 * Register (or update) the bot's global slash commands with Discord.
 *
 *   npm run register-commands
 *
 * Global commands can take up to ~1 hour to propagate. To test instantly, set
 * DISCORD_TEST_GUILD_ID in .env and this script registers them to that guild
 * (guild commands are near-instant).
 */
import "dotenv/config";

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const TEST_GUILD = process.env.DISCORD_TEST_GUILD_ID; // optional

if (!APP_ID || !TOKEN) {
  console.error("Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}

const commands = [
  {
    name: "status",
    description: "Check the bot / system status.",
    type: 1,
  },
  {
    name: "report",
    description: "File a report. Leave text empty to open a form.",
    type: 1,
    options: [
      {
        name: "text",
        description: "What do you want to report?",
        type: 3, // STRING
        required: false,
      },
    ],
  },
];

async function main() {
  const url = TEST_GUILD
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${TEST_GUILD}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  const res = await fetch(url, {
    method: "PUT", // bulk overwrite
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${TOKEN}`,
    },
    body: JSON.stringify(commands),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`Failed (${res.status}): ${body}`);
    process.exit(1);
  }

  console.log(
    `Registered ${commands.length} commands ${TEST_GUILD ? `to guild ${TEST_GUILD}` : "globally"}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

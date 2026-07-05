/**
 * Central, typed access to environment variables.
 * Throwing here (rather than deep in a handler) gives a clear boot-time error.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get discordApplicationId() {
    return required("DISCORD_APPLICATION_ID");
  },
  get discordPublicKey() {
    return required("DISCORD_PUBLIC_KEY");
  },
  get discordBotToken() {
    return required("DISCORD_BOT_TOKEN");
  },
  get authSecret() {
    return required("AUTH_SECRET");
  },
  get geminiApiKey() {
    return optional("GEMINI_API_KEY");
  },
  get geminiModel() {
    return optional("GEMINI_MODEL", "gemini-2.0-flash");
  },
  get appBaseUrl() {
    return optional("APP_BASE_URL", "http://localhost:3000");
  },
  get aiEnabled() {
    return Boolean(process.env.GEMINI_API_KEY);
  },
};

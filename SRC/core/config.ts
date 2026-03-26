function getEnv(
  name: string,
  options?: { required?: boolean; defaultValue?: string }
): string {
  const value = process.env[name];

  if (value != null && value !== "") {
    return value;
  }

  if (options?.defaultValue != null) {
    return options.defaultValue;
  }

  if (options?.required === false) {
    return "";
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function getPort(): number {
  const raw = getEnv("PORT", { defaultValue: "3000" });
  const port = Number(raw);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${raw}`);
  }

  return port;
}

export const config = {
  port: getPort(),
  openAiApiKey: getEnv("OPENAI_API_KEY"),
  supabaseUrl: getEnv("SUPABASE_URL"),
  supabaseKey: getEnv("SUPABASE_KEY"),
  whatsappToken: getEnv("WHATSAPP_TOKEN"),
  whatsappPhoneId: getEnv("WHATSAPP_PHONE_ID"),
  cronSecret: getEnv("CRON_SECRET", { required: false }),
  verifyToken: getEnv("WHATSAPP_VERIFY_TOKEN", { defaultValue: "meu_token_123" })
} as const;
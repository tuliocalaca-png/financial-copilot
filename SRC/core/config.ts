import dotenv from "dotenv";

dotenv.config();

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  openAiApiKey: getEnv("OPENAI_API_KEY"),
  supabaseUrl: getEnv("SUPABASE_URL"),
  supabaseKey: getEnv("SUPABASE_KEY"),
  whatsappToken: getEnv("WHATSAPP_TOKEN"),
  whatsappPhoneId: getEnv("WHATSAPP_PHONE_ID")
};

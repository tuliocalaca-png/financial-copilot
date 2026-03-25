import { Intent } from "../core/types";

const DAILY_LIMIT_PATTERN =
  /(quanto\s+posso\s+gastar\s+hoje|posso\s+gastar\s+hoje|limite(\s+de)?\s+gasto\s+hoje)/i;
const NUMERIC_AMOUNT_PATTERN = /\d+([.,]\d{1,2})?/;

export function detectIntent(messageText: string): Intent {
  const text = messageText.trim().toLowerCase();

  if (NUMERIC_AMOUNT_PATTERN.test(text)) {
    return "expense";
  }

  if (DAILY_LIMIT_PATTERN.test(text)) {
    return "daily_limit_query";
  }

  return "unknown";
}

export type ParsedExpense = {
  amount: number;
  description: string;
};

export function parseExpense(message: string): ParsedExpense | null {
  if (!message) return null;

  const normalized = message.toLowerCase().trim();

  // captura números
  const numbers = normalized.match(/\d+([.,]\d+)?/g);

  if (!numbers) return null;

  // 🚨 MULTI-GASTO → NÃO PARSEIA
  if (numbers.length > 1) {
    return null;
  }

  const amount = parseFloat(numbers[0].replace(",", "."));

  if (isNaN(amount)) return null;

  const description = normalized.replace(numbers[0], "").trim();

  if (!description) return null;

  return {
    amount,
    description
  };
}
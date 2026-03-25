export type ParsedExpense = {
  amount: number;
  description: string;
  category: string;
};

function guessCategory(description: string): string {
  const text = description.toLowerCase();

  if (
    text.includes("uber") ||
    text.includes("99") ||
    text.includes("taxi") ||
    text.includes("combustivel") ||
    text.includes("combustível") ||
    text.includes("posto") ||
    text.includes("gasolina")
  ) {
    return "transporte";
  }

  if (
    text.includes("ifood") ||
    text.includes("ifood") ||
    text.includes("restaurante") ||
    text.includes("almoco") ||
    text.includes("almoço") ||
    text.includes("janta") ||
    text.includes("jantar") ||
    text.includes("cafe") ||
    text.includes("café") ||
    text.includes("lanche")
  ) {
    return "alimentacao";
  }

  if (
    text.includes("farmacia") ||
    text.includes("farmácia") ||
    text.includes("remedio") ||
    text.includes("remédio") ||
    text.includes("medico") ||
    text.includes("médico")
  ) {
    return "saude";
  }

  if (
    text.includes("cinema") ||
    text.includes("bar") ||
    text.includes("balada") ||
    text.includes("show") ||
    text.includes("lazer")
  ) {
    return "lazer";
  }

  if (
    text.includes("mercado") ||
    text.includes("supermercado")
  ) {
    return "mercado";
  }

  return "outros";
}

export function parseExpense(message: string): ParsedExpense | null {
  if (!message) return null;

  const normalized = message.toLowerCase().trim();
  const numbers = normalized.match(/\d+([.,]\d+)?/g);

  if (!numbers) return null;

  // Se houver mais de um valor, não tenta salvar errado.
  if (numbers.length > 1) {
    return null;
  }

  const amount = parseFloat(numbers[0].replace(",", "."));

  if (Number.isNaN(amount)) return null;

  const description = normalized.replace(numbers[0], "").trim();

  if (!description) return null;

  return {
    amount,
    description,
    category: guessCategory(description)
  };
}
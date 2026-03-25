import { ParsedExpense } from "../core/types";

function parseBrazilianNumber(value: string): number {
  const cleaned = value
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractAllAmounts(text: string): number[] {
  const matches = text.match(/\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:,\d{2})?|\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches
    .map(parseBrazilianNumber)
    .filter((n) => n > 0);
}

function inferCategory(normalized: string): string {
  if (/(ifood|restaurante|barzinho|bar|balada|cerveja|drinks|lanche|jantar|almoco|almoço|cafe|café|mercado|padaria)/i.test(normalized)) {
    return "food";
  }
  if (/(uber|99|taxi|combustivel|combustível|gasolina|estacionamento)/i.test(normalized)) {
    return "transport";
  }
  if (/(farmacia|farmácia|remedio|remédio|consulta|medico|médico)/i.test(normalized)) {
    return "health";
  }
  if (/(internet|luz|agua|água|aluguel|condominio|condomínio|boleto|fatura)/i.test(normalized)) {
    return "bills";
  }
  if (/(cinema|show|netflix|spotify|viagem|hotel|balada|barzinho)/i.test(normalized)) {
    return "entertainment";
  }
  return "other";
}

export function parseExpense(text: string): ParsedExpense | null {
  const amounts = extractAllAmounts(text);

  if (!amounts.length) {
    return null;
  }

  const totalAmount = amounts.reduce((sum, value) => sum + value, 0);
  const normalized = text.toLowerCase();
  const category = inferCategory(normalized);

  const description = text.trim();

  return {
    amount: totalAmount,
    category,
    description
  };
}
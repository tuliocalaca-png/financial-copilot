export type ExpenseCategory =
  | "alimentacao"
  | "transporte"
  | "mercado"
  | "saude"
  | "lazer"
  | "outros";

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).replace(/\s+/g, " ").trim();
}

export function normalizeCategoryKey(input: string | null | undefined): ExpenseCategory {
  const key = normalize(input ?? "");

  switch (key) {
    case "alimentacao":
    case "alimentação":
      return "alimentacao";
    case "transporte":
      return "transporte";
    case "mercado":
      return "mercado";
    case "saude":
    case "saúde":
      return "saude";
    case "lazer":
      return "lazer";
    default:
      return "outros";
  }
}

export function isExpenseCategory(input: string | null | undefined): boolean {
  const key = normalizeCategoryKey(input);
  return (
    key === "alimentacao" ||
    key === "transporte" ||
    key === "mercado" ||
    key === "saude" ||
    key === "lazer" ||
    key === "outros"
  );
}

export function naturalCategoryLabel(input: string | null | undefined): string {
  const key = normalizeCategoryKey(input);

  switch (key) {
    case "alimentacao":
      return "Alimentação";
    case "transporte":
      return "Transporte";
    case "mercado":
      return "Mercado";
    case "saude":
      return "Saúde";
    case "lazer":
      return "Lazer";
    default:
      return "Outros";
  }
}

export function inferExpenseCategoryFromText(text: string): ExpenseCategory {
  const t = normalize(text);

  const alimentacaoKeywords = [
    "ifood",
    "restaurante",
    "almoco",
    "almoço",
    "jantar",
    "lanche",
    "pizza",
    "hamburguer",
    "hambúrguer",
    "cafe",
    "café",
    "padaria",
    "sorvete"
  ];

  const transporteKeywords = [
    "uber",
    "99",
    "taxi",
    "táxi",
    "gasolina",
    "etanol",
    "diesel",
    "posto",
    "combustivel",
    "combustível",
    "pedagio",
    "pedágio",
    "estacionamento"
  ];

  const mercadoKeywords = [
    "mercado",
    "supermercado",
    "atacadao",
    "atacadão",
    "carrefour",
    "pao de acucar",
    "pão de açúcar",
    "big box",
    "oba",
    "hortifruti"
  ];

  const saudeKeywords = [
    "farmacia",
    "farmácia",
    "drogasil",
    "drogaria",
    "consulta",
    "exame",
    "hospital",
    "clinica",
    "clínica",
    "medico",
    "médico",
    "odonto",
    "dentista"
  ];

  const lazerKeywords = [
    "cinema",
    "bar",
    "netflix",
    "spotify",
    "streaming",
    "show",
    "viagem",
    "hotel",
    "ingresso",
    "parque"
  ];

  if (alimentacaoKeywords.some((k) => t.includes(normalize(k)))) {
    return "alimentacao";
  }

  if (transporteKeywords.some((k) => t.includes(normalize(k)))) {
    return "transporte";
  }

  if (mercadoKeywords.some((k) => t.includes(normalize(k)))) {
    return "mercado";
  }

  if (saudeKeywords.some((k) => t.includes(normalize(k)))) {
    return "saude";
  }

  if (lazerKeywords.some((k) => t.includes(normalize(k)))) {
    return "lazer";
  }

  return "outros";
}

export type ExpenseCategory =
  | "alimentacao"
  | "transporte"
  | "mercado"
  | "saude"
  | "lazer"
  | "outros";

export type IncomeCategory =
  | "salario"
  | "pix_recebido"
  | "reembolso_recebido"
  | "receita"
  | "outros_recebimentos";

export type TransactionCategory = ExpenseCategory | IncomeCategory;

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).replace(/\s+/g, " ").trim();
}

export function normalizeCategoryKey(
  input: string | null | undefined
): TransactionCategory {
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
    case "salario":
    case "salário":
      return "salario";
    case "pix_recebido":
    case "pix recebido":
      return "pix_recebido";
    case "reembolso_recebido":
    case "reembolso recebido":
      return "reembolso_recebido";
    case "receita":
      return "receita";
    case "outros_recebimentos":
    case "outros recebimentos":
      return "outros_recebimentos";
    default:
      return "outros";
  }
}

export function isExpenseCategory(
  input: string | null | undefined
): boolean {
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

export function isIncomeCategory(
  input: string | null | undefined
): boolean {
  const key = normalizeCategoryKey(input);

  return (
    key === "salario" ||
    key === "pix_recebido" ||
    key === "reembolso_recebido" ||
    key === "receita" ||
    key === "outros_recebimentos"
  );
}

export function naturalCategoryLabel(
  input: string | null | undefined
): string {
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
    case "salario":
      return "Salário";
    case "pix_recebido":
      return "Pix recebido";
    case "reembolso_recebido":
      return "Reembolso recebido";
    case "receita":
      return "Receita";
    case "outros_recebimentos":
      return "Outros recebimentos";
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

export function inferIncomeCategoryFromText(text: string): IncomeCategory {
  const t = normalize(text);

  if (
    t.includes("salario") ||
    t.includes("salário") ||
    t.includes("holerite") ||
    t.includes("folha")
  ) {
    return "salario";
  }

  if (
    t.includes("pix") ||
    t.includes("transferencia") ||
    t.includes("transferência")
  ) {
    return "pix_recebido";
  }

  if (t.includes("reembolso")) {
    return "reembolso_recebido";
  }

  if (
    t.includes("recebi") ||
    t.includes("entrou") ||
    t.includes("caiu") ||
    t.includes("ganhei") ||
    t.includes("faturei") ||
    t.includes("faturamento")
  ) {
    return "receita";
  }

  return "outros_recebimentos";
}
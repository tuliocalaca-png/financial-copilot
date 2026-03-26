/** Positive amounts with these categories count as income (same table as expenses). */
const INCOME_CATEGORIES = new Set([
  "receita",
  "receitas",
  "income",
  "entrada",
  "entradas",
  "salario",
  "rendimento",
  "deposito"
]);

export function normalizeCategoryKey(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isIncomeCategory(category: string): boolean {
  return INCOME_CATEGORIES.has(normalizeCategoryKey(category));
}

export function isExpenseCategory(category: string): boolean {
  return !isIncomeCategory(category);
}

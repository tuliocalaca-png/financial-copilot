export type Intent =
  | "expense"
  | "spending_query"
  | "report_settings"
  | "multi_expense_blocked"
  | "unknown";

export type TransactionKind = "expense" | "income";

export interface IncomingMessage {
  phoneNumber: string;
  messageText: string;
}

export interface ParsedExpense {
  amount: number;
  category: string;
  description: string;
  kind: TransactionKind;
}

export interface DailyLimitResult {
  totalSpentMonth: number;
  remainingMonthBudget: number;
  remainingDaysInMonth: number;
  dailyLimit: number;
}

export type Intent = "expense" | "daily_limit_query" | "unknown";

export interface IncomingMessage {
  phoneNumber: string;
  messageText: string;
}

export interface ParsedExpense {
  amount: number;
  category: string;
  description: string;
}

export interface DailyLimitResult {
  totalSpentMonth: number;
  remainingMonthBudget: number;
  remainingDaysInMonth: number;
  dailyLimit: number;
}

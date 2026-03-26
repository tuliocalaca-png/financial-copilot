import { resolveInboundMessage } from "./inbound-resolution.service";

export async function detectIntent(
  userId: string,
  messageText: string
): Promise<string> {
  const resolution = await resolveInboundMessage(userId, messageText);

  switch (resolution.kind) {
    case "report_settings":
      return "report_settings";
    case "spending_query":
      return "spending_query";
    case "expense":
      return "expense";
    case "multi_expense_warning":
      return "multi_expense_blocked";
    default:
      return "unknown";
  }
}
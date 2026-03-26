import { Intent } from "../core/types";
import { resolveInboundMessage } from "./inbound-resolution.service";

/** Compatível com logs legados; o roteamento real está em `resolveInboundMessage`. */
export function detectIntent(messageText: string): Intent {
  const r = resolveInboundMessage(messageText);
  switch (r.kind) {
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

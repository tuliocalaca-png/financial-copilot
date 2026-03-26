import { supabase } from "../db/supabase";
import { ParsedExpense } from "../core/types";

export async function getOrCreateUserByPhone(phoneNumber: string): Promise<string> {
  const { data: existing, error: findError } = await supabase
    .from("users")
    .select("id")
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (findError) {
    throw new Error(`Failed to fetch user: ${findError.message}`);
  }

  if (existing?.id) {
    return existing.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("users")
    .insert({
      phone_number: phoneNumber
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    throw new Error(`Failed to create user: ${insertError?.message ?? "unknown error"}`);
  }

  return inserted.id;
}

export async function saveExpense(userId: string, expense: ParsedExpense): Promise<void> {
  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    amount: expense.amount,
    category: expense.category,
    description: expense.description
  });

  if (error) {
    throw new Error(`Failed to save transaction: ${error.message}`);
  }
}

export async function saveMessageEvent(params: {
  userId: string;
  direction: "inbound" | "outbound";
  messageText: string;
  intent?: string;
}): Promise<void> {
  const { error } = await supabase.from("message_events").insert({
    user_id: params.userId,
    direction: params.direction,
    message_text: params.messageText,
    intent: params.intent ?? null
  });

  if (error) {
    throw new Error(`Failed to save message event: ${error.message}`);
  }
}

import { supabase } from "../db/supabase";
import type { Intent, ParsedExpense } from "../core/types";

type UserRow = {
  id: string;
  phone_number: string;
};

export async function getOrCreateUserByPhone(phoneNumber: string): Promise<string> {
  const normalizedPhone = phoneNumber.trim();

  const { data: existingUser, error: findError } = await supabase
    .from("users")
    .select("id, phone_number")
    .eq("phone_number", normalizedPhone)
    .maybeSingle<UserRow>();

  if (findError) {
    throw new Error(`Failed to find user by phone: ${findError.message}`);
  }

  if (existingUser?.id) {
    return existingUser.id;
  }

  const { data: createdUser, error: createError } = await supabase
    .from("users")
    .insert({
      phone_number: normalizedPhone
    })
    .select("id, phone_number")
    .single<UserRow>();

  if (createError || !createdUser?.id) {
    throw new Error(`Failed to create user: ${createError?.message ?? "unknown error"}`);
  }

  return createdUser.id;
}

export async function saveExpense(userId: string, parsed: ParsedExpense): Promise<void> {
  const transactionType = parsed.kind === "income" ? "income" : "expense";

  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    amount: parsed.amount,
    description: parsed.description,
    category: parsed.category,
    type: transactionType
  });

  if (error) {
    throw new Error(`Failed to save transaction: ${error.message}`);
  }
}

export async function saveMessageEvent(input: {
  userId: string;
  direction: "inbound" | "outbound";
  messageText: string;
  intent: Intent | string;
}): Promise<void> {
  const { error } = await supabase.from("message_events").insert({
    user_id: input.userId,
    direction: input.direction,
    message_text: input.messageText,
    intent: input.intent
  });

  if (error) {
    throw new Error(`Failed to save message event: ${error.message}`);
  }
}
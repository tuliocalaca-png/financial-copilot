import { supabase } from "../lib/supabase";

type CreateTransactionInput = {
  userId: string;
  amount: number;
  description: string;
  type: "expense" | "income";
  occurredAt?: string;
};

export async function createTransaction(input: CreateTransactionInput) {
  const {
    userId,
    amount,
    description,
    type,
    occurredAt
  } = input;

  const { error } = await supabase.from("transactions").insert([
    {
      user_id: userId,
      amount,
      description,
      type,
      occurred_at: occurredAt ?? new Date().toISOString()
    }
  ]);

  if (error) {
    console.error("Erro ao salvar transação:", error);
    throw error;
  }
}
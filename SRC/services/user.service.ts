import { supabase } from "../lib/supabase";

type User = {
  id: string;
  phone: string;
  created_at: string;
};

export async function getOrCreateUser(phone: string): Promise<User> {
  // 🔎 tenta buscar usuário existente
  const { data: existing, error: fetchError } = await supabase
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (fetchError) {
    console.error("Erro buscando usuário:", fetchError);
    throw fetchError;
  }

  if (existing) {
    return existing as User;
  }

  // 🆕 cria usuário novo
  const { data: created, error: insertError } = await supabase
    .from("users")
    .insert([{ phone }])
    .select()
    .single();

  if (insertError) {
    console.error("Erro criando usuário:", insertError);
    throw insertError;
  }

  return created as User;
}
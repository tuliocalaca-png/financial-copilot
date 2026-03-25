import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

type Props = {
  intent: string;
  originalMessage: string;
  parsedExpense?: {
    amount: number;
    description: string;
  };
};

export async function generateAssistantReply({
  intent,
  originalMessage,
  parsedExpense
}: Props): Promise<string> {

  // 🚨 BLOQUEIO MULTI-GASTO
  const numbers = originalMessage.match(/\d+([.,]\d+)?/g);
  if (numbers && numbers.length > 1 && !parsedExpense) {
    return "Peguei que você mandou mais de um gasto 👀\n\nPra não errar, me manda um por vez 👍";
  }

  // 🚨 CONSULTA NÃO IMPLEMENTADA
  if (!parsedExpense) {
    return "Ainda não consigo te mostrar isso com segurança 👀\n\nMas já já isso fica redondo 👍";
  }

  // ✅ SOMENTE LINGUAGEM
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `
Você é um copiloto financeiro via WhatsApp.

REGRAS CRÍTICAS:

- Nunca invente números
- Nunca invente totais
- Nunca invente categorias
- Nunca use limite diário
- Nunca fale de dados que não recebeu

Você só pode usar:
- valor
- descrição

Responda de forma:
- direta
- humana
- curta (1 frase)

Exemplo:
"Anotei 💸 R$20 no Uber"
        `
      },
      {
        role: "user",
        content: `
valor: ${parsedExpense.amount}
descrição: ${parsedExpense.description}
mensagem original: "${originalMessage}"
        `
      }
    ]
  });

  return completion.choices[0].message.content ?? "Anotei 👍";
}
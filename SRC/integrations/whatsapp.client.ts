import { config } from "../core/config";

export async function sendWhatsappMessage(to: string, body: string): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.whatsappPhoneId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API error (${response.status}): ${errorText}`);
  }
}

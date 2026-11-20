import { NextRequest } from "next/server";
import { handleWhatsAppGet, handleWhatsAppPost } from "@/lib/whatsappWebhook";

// The URL to register in Meta: https://<your-app>/api/webhook/whatsapp
// GET  -> Meta's verification handshake (hub.verify_token = WHATSAPP_VERIFY_TOKEN)
// POST -> incoming messages (signature X-Hub-Signature-256 checked with WHATSAPP_APP_SECRET)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleWhatsAppGet(req);
}

export async function POST(req: NextRequest) {
  return handleWhatsAppPost(req);
}

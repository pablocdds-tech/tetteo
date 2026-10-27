import { receberWebhookCw } from "@/connectors/cardapioweb/webhook";
import { gravarEventoCw } from "@/connectors/cardapioweb/recebimento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return receberWebhookCw(request, gravarEventoCw);
}

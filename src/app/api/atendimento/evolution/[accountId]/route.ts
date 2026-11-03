import { receiveEvolutionChannel } from "../../_costura/receber-live";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  return receiveEvolutionChannel(request, (await context.params).accountId);
}

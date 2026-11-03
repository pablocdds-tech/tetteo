import {
  receiveMetaChannel,
  verifyMetaChannel,
} from "../../_costura/receber-live";
export const runtime = "nodejs";
type Context = { params: Promise<{ accountId: string }> };
export async function GET(request: Request, context: Context) {
  return verifyMetaChannel(request, (await context.params).accountId);
}
export async function POST(request: Request, context: Context) {
  return receiveMetaChannel(request, (await context.params).accountId);
}

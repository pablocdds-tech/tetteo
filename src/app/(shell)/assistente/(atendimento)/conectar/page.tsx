import VirtualChannelsPage from "@/modules/crm/components/virtual-channels";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ metodo?: string }>;
}) {
  const { metodo } = await searchParams;
  const provider = metodo === "meta" ? "META" : "EVOLUTION";
  return <VirtualChannelsPage key={provider} provider={provider} />;
}

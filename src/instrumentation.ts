export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { iniciarWorkerCw } = await import("./connectors/cardapioweb/worker");
    iniciarWorkerCw();
  }
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.SAIPOS_SYNC_ENABLED === "true"
  ) {
    const { iniciarRelogioSaipos } =
      await import("./connectors/saipos/sincronizar");
    iniciarRelogioSaipos();
    const [
      { SaiposClient },
      { normalizarVenda },
      { clienteIdentificado },
      { startSaiposCustomerSync },
    ] = await Promise.all([
      import("./connectors/saipos/client"),
      import("./connectors/saipos/normalizar"),
      import("./connectors/saipos/clientes"),
      import("./modules/crm/services/saipos-sync"),
    ]);
    const client = new SaiposClient();
    startSaiposCustomerSync(async (storeId, period) =>
      (await client.salesForCrm(period, storeId)).map((s) => {
        const v = normalizarVenda(s, storeId);
        return {
          externalId: v.vendaExternaId,
          soldAt: v.criadaNoSaiposEm,
          updatedAt: v.alteradaNoSaiposEm,
          shiftDate: v.dataTurno,
          totalCents: v.totalCentavos,
          cancelled: v.cancelada,
          customer: clienteIdentificado(s.customer),
        };
      }),
    );
  }
}

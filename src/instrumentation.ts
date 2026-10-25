export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.SAIPOS_SYNC_ENABLED === "true"
  ) {
    const { iniciarRelogioSaipos } =
      await import("./connectors/saipos/sincronizar");
    iniciarRelogioSaipos();
  }
}

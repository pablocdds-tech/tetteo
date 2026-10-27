import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Router, type Response } from "./http-router";
import { CrmError } from "./campaign-domain";
import {
  alterarEnderecoAtendimento,
  consultarClienteAtendimento,
  criarClienteAtendimento,
  criarEnderecoAtendimento,
  ErroAtendimento,
  listarClientesAtendimento,
} from "./atendimento";

const router = Router();
function fail(res: Response, error: unknown) {
  if (error instanceof Error && error.name === "AuthorizationError")
    return res.status(403).json({ error: "Sem acesso a esta unidade." });
  if (error instanceof CrmError)
    return res.status(error.status).json({
      error: error.message,
      codigo: error.code,
      ...(error instanceof ErroAtendimento && error.operacaoConfirmada
        ? { operacaoConfirmada: true }
        : {}),
      ...(error instanceof ErroAtendimento && error.clienteExistente
        ? { clienteExistente: error.clienteExistente }
        : {}),
    });
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: "Confira os dados do cliente e do endereço.",
      details: error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    return res.status(409).json({
      error: "Este cadastro já existe. Atualize os dados antes de continuar.",
    });
  console.error(
    "[crm-atendimento]",
    error instanceof Error ? error.name : "unknown",
  );
  return res.status(503).json({
    error:
      "Não foi possível confirmar a operação. Os dados anteriores foram preservados; atualize o cadastro ou repita a mesma tentativa.",
  });
}
router.get("/atendimento/clientes", async (req, res) => {
  try {
    return res.json(await listarClientesAtendimento(req.user, req.query));
  } catch (e) {
    return fail(res, e);
  }
});
router.get("/atendimento/clientes/:id", async (req, res) => {
  try {
    return res.json(
      await consultarClienteAtendimento(req.user, {
        ...req.query,
        clienteId: req.params.id,
      }),
    );
  } catch (e) {
    return fail(res, e);
  }
});
router.post("/atendimento/clientes", async (req, res) => {
  try {
    return res
      .status(201)
      .json(await criarClienteAtendimento(req.user, req.body));
  } catch (e) {
    return fail(res, e);
  }
});
router.post("/atendimento/clientes/:id/enderecos", async (req, res) => {
  try {
    return res
      .status(201)
      .json(await criarEnderecoAtendimento(req.user, req.params.id, req.body));
  } catch (e) {
    return fail(res, e);
  }
});
router.put(
  "/atendimento/clientes/:id/enderecos/:enderecoId",
  async (req, res) => {
    try {
      return res.json(
        await alterarEnderecoAtendimento(
          req.user,
          req.params.id,
          req.params.enderecoId,
          req.body,
        ),
      );
    } catch (e) {
      return fail(res, e);
    }
  },
);
export default router;

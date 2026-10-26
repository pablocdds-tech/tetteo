import { Router } from "./http-router";
import { CrmActivityType, IntegrationSource, Prisma } from "@prisma/client";
import { z } from "zod";
import { can } from "./scope";
import { assertStoreAccess, scopedStoreIds } from "./scope";
import { normalizeBrazilPhone } from "./domain";
import {
  addActivity,
  createContact,
  getContact,
  getCrmInsights,
  getCrmOverview,
  linkSale,
  listContacts,
  updateContact,
} from "./service";

const router = Router();

const segment = z.enum(["LEAD", "NEW", "ACTIVE", "AT_RISK", "LOST"]);
const storeId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
const contactFields = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z
    .string()
    .trim()
    .min(10)
    .max(30)
    .refine((value) => {
      try {
        normalizeBrazilPhone(value);
        return true;
      } catch {
        return false;
      }
    }, "Telefone brasileiro inválido."),
  email: z
    .union([z.string().trim().email().max(240), z.literal(""), z.null()])
    .optional(),
  notes: z.union([z.string().trim().max(2_000), z.null()]).optional(),
  marketingOptIn: z.boolean(),
});

function fail(res: import("./http-router").Response, error: unknown) {
  if (error instanceof Error && error.name === "AuthorizationError")
    return res.status(403).json({ error: "Sem acesso a esta loja." });
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: "Dados do CRM inválidos.",
      details: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    return res
      .status(409)
      .json({ error: "Já existe um contato com este telefone nesta loja." });
  console.error("[crm]", error instanceof Error ? error.name : "unknown");
  return res
    .status(500)
    .json({ error: "Não foi possível concluir a operação no CRM." });
}

router.get("/overview", async (req, res) => {
  if (!can(req.user!, "CRM", "VIEW"))
    return res.status(403).json({ error: "Sem permissão para acessar o CRM." });
  try {
    const query = z
      .object({ storeId: z.union([storeId, z.literal("all")]).optional() })
      .strict()
      .parse(req.query);
    res.json(
      await getCrmOverview(
        scopedStoreIds(req.user!, query.storeId),
        req.user!.role === "SUPER_ADMIN",
      ),
    );
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/insights", async (req, res) => {
  if (!can(req.user!, "CRM", "VIEW"))
    return res.status(403).json({ error: "Sem permissão para acessar o CRM." });
  try {
    const query = z
      .object({ storeId: z.union([storeId, z.literal("all")]).optional() })
      .strict()
      .parse(req.query);
    res.json(
      await getCrmInsights(
        scopedStoreIds(req.user!, query.storeId),
        req.user!.role === "SUPER_ADMIN",
      ),
    );
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/contacts", async (req, res) => {
  if (!can(req.user!, "CRM", "VIEW"))
    return res.status(403).json({ error: "Sem permissão para acessar o CRM." });
  try {
    const query = z
      .object({
        storeId: z.union([storeId, z.literal("all")]).optional(),
        search: z.string().trim().max(100).optional(),
        segment: segment.optional(),
        marketingOnly: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
        minPurchases: z.coerce.number().int().min(0).max(100_000).optional(),
        maxDaysSincePurchase: z.coerce
          .number()
          .int()
          .min(0)
          .max(3_650)
          .optional(),
        minSpent: z.coerce
          .number()
          .finite()
          .min(0)
          .max(1_000_000_000)
          .optional(),
        page: z.coerce.number().int().min(1).max(100_000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict()
      .parse(req.query);
    res.json(
      await listContacts({
        ...query,
        storeIds: scopedStoreIds(req.user!, query.storeId),
        allStores: req.user!.role === "SUPER_ADMIN",
      }),
    );
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/contacts/:id", async (req, res) => {
  if (!can(req.user!, "CRM", "VIEW"))
    return res.status(403).json({ error: "Sem permissão para acessar o CRM." });
  try {
    const query = z.object({ storeId }).strict().parse(req.query);
    const id = z.string().uuid().parse(req.params.id);
    assertStoreAccess(req.user!, query.storeId);
    const contact = await getContact(query.storeId, id);
    if (!contact)
      return res.status(404).json({ error: "Contato não encontrado." });
    res.json(contact);
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/contacts", async (req, res) => {
  if (!can(req.user!, "CRM", "CREATE"))
    return res
      .status(403)
      .json({ error: "Sem permissão para criar contatos." });
  try {
    const body = contactFields.extend({ storeId }).strict().parse(req.body);
    assertStoreAccess(req.user!, body.storeId);
    const contact = await createContact(
      { ...body, email: body.email || null, notes: body.notes || null },
      req.user!.userId,
    );
    res.status(201).json(contact);
  } catch (error) {
    return fail(res, error);
  }
});

router.put("/contacts/:id", async (req, res) => {
  if (!can(req.user!, "CRM", "EDIT"))
    return res
      .status(403)
      .json({ error: "Sem permissão para editar contatos." });
  try {
    const body = contactFields
      .partial()
      .extend({ storeId })
      .strict()
      .refine(
        (value) => Object.keys(value).some((key) => key !== "storeId"),
        "Informe ao menos um campo para editar.",
      )
      .parse(req.body);
    const id = z.string().uuid().parse(req.params.id);
    assertStoreAccess(req.user!, body.storeId);
    const { storeId: requestedStoreId, ...fields } = body;
    const changes = {
      ...fields,
      ...(fields.email === "" ? { email: null } : {}),
    };
    const contact = await updateContact(
      requestedStoreId,
      id,
      changes,
      req.user!.userId,
    );
    if (!contact)
      return res.status(404).json({ error: "Contato não encontrado." });
    res.json(contact);
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/contacts/:id/sales", async (req, res) => {
  if (!can(req.user!, "CRM", "EDIT"))
    return res
      .status(403)
      .json({ error: "Sem permissão para vincular vendas." });
  try {
    const body = z
      .object({
        storeId,
        source: z.nativeEnum(IntegrationSource),
        externalId: z.string().trim().min(1).max(160),
      })
      .strict()
      .parse(req.body);
    const id = z.string().uuid().parse(req.params.id);
    assertStoreAccess(req.user!, body.storeId);
    const result = await linkSale(
      body.storeId,
      id,
      body.source,
      body.externalId,
      req.user!.userId,
    );
    if (result === "CONTACT_NOT_FOUND")
      return res.status(404).json({ error: "Contato não encontrado." });
    if (result === "SALE_NOT_FOUND")
      return res
        .status(404)
        .json({ error: "Venda não encontrada nesta loja." });
    if (result === "ALREADY_LINKED")
      return res
        .status(409)
        .json({ error: "Venda já vinculada a outro contato." });
    res.json({ linked: true });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/contacts/:id/activities", async (req, res) => {
  if (!can(req.user!, "CRM", "CREATE"))
    return res
      .status(403)
      .json({ error: "Sem permissão para registrar interações." });
  try {
    const body = z
      .object({
        storeId,
        type: z.nativeEnum(CrmActivityType),
        summary: z.string().trim().min(2).max(1_000),
      })
      .strict()
      .parse(req.body);
    const id = z.string().uuid().parse(req.params.id);
    assertStoreAccess(req.user!, body.storeId);
    const activity = await addActivity(
      body.storeId,
      id,
      body.type,
      body.summary,
      req.user!.userId,
    );
    if (!activity)
      return res.status(404).json({ error: "Contato não encontrado." });
    res.status(201).json(activity);
  } catch (error) {
    return fail(res, error);
  }
});

export default router;

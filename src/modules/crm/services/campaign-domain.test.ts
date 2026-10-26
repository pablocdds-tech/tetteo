import test from "node:test";
import assert from "node:assert/strict";
import {
  assignArm,
  canonicalHash,
  compareGroups,
  GroupResult,
  operationalDate,
  protectIdentity,
  retentionSegment,
} from "./campaign-domain";

const now = new Date("2026-10-26T15:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
test("retenção: exemplos, limites e data desconhecida", () => {
  assert.deepEqual(
    [
      [8, 20],
      [3, 45],
      [1, 75],
      [5, 100],
    ].map(([visits, days]) => retentionSegment(visits, ago(days), now)),
    ["VIP", "REGULAR", "AT_RISK", "LOST"],
  );
  assert.equal(retentionSegment(0, null, now), "NEW");
  assert.equal(retentionSegment(2, null, now), "UNKNOWN");
  assert.equal(retentionSegment(2, new Date(NaN), now), "UNKNOWN");
  assert.equal(retentionSegment(8, ago(30), now), "VIP");
  assert.equal(retentionSegment(3, ago(45), now), "REGULAR");
  assert.equal(retentionSegment(1, ago(60), now), "OCCASIONAL");
  assert.equal(retentionSegment(1, ago(90), now), "AT_RISK");
  assert.equal(retentionSegment(1, ago(91), now), "LOST");
  assert.throws(() => retentionSegment(-1, null, now));
});
test("SHA-256 coincide com a referência e não exige exatamente 20% de controle", () => {
  assert.equal(assignArm("c01", "e01", "seed"), "CONTROL");
  assert.equal(
    assignArm("c01", "e01", "seed"),
    assignArm("c01", "e01", "seed"),
  );
  assert.equal(canonicalHash({ b: 2, a: 1 }), canonicalHash({ a: 1, b: 2 }));
  const arms = Array.from({ length: 1000 }, (_, i) =>
    assignArm(String(i), "experiment", "salt"),
  );
  assert.ok(
    arms.filter((a) => a === "CONTROL").length > 100 &&
      arms.filter((a) => a === "CONTROL").length < 300,
  );
});
const group = (
  assigned: number,
  returned: number,
  revenue: number | null,
): GroupResult => ({
  assigned,
  returned,
  netRevenueCents: revenue,
  visits: returned,
  simulated: 0,
  blocked: 0,
  failed: 0,
  uncertain: 0,
  contaminated: 0,
});
test("resultado reproduz 10 p.p., R$ 1.040 e R$ 920 sem atribuir todas as vendas", () => {
  const result = compareGroups(
    group(80, 20, 200000),
    group(20, 3, 24000),
    12000,
  );
  assert.equal(result.upliftPoints, 10);
  assert.equal(result.incrementalRevenueCents, 104000);
  assert.equal(result.contributionAfterCampaignCents, 92000);
  assert.equal(result.conclusion, "descriptive_only");
});
test("controle vazio, receita ausente e resultado negativo são explícitos", () => {
  assert.equal(
    compareGroups(group(80, 20, 200000), group(0, 0, 0), 12000)
      .incrementalRevenueCents,
    null,
  );
  assert.equal(
    compareGroups(group(80, 20, null), group(20, 3, 24000), 12000)
      .incrementalRevenueCents,
    null,
  );
  assert.equal(
    compareGroups(group(80, 20, 200000), group(20, 3, 24000), 200000)
      .contributionAfterCampaignCents,
    -96000,
  );
  assert.equal(
    compareGroups(group(1, 0, 0), group(2, 0, 1), 0).incrementalRevenueCents,
    0,
  );
  assert.throws(
    () =>
      compareGroups(
        group(5000, 20, 0),
        group(1, 1, Number.MAX_SAFE_INTEGER),
        0,
      ),
    /limite/,
  );
});
test("janela local atravessa noite, mês e rejeita datas impossíveis", () => {
  assert.equal(
    operationalDate("2026-11-01").toISOString(),
    "2026-11-01T03:00:00.000Z",
  );
  assert.equal(
    operationalDate("2026-10-31").toISOString(),
    "2026-10-31T03:00:00.000Z",
  );
  assert.throws(() => operationalDate("2026-02-30"));
  assert.throws(() => operationalDate("2026-10-01T00:00:00"));
});
test("identidade é segregada por loja e valor é criptografado com nonce aleatório", () => {
  const previous = process.env.CRM_IDENTITY_KEY;
  process.env.CRM_IDENTITY_KEY = "b".repeat(64);
  try {
    const a = protectIdentity("a", "LOCAL_JSON", "fixture-c01"),
      again = protectIdentity("a", "LOCAL_JSON", "fixture-c01");
    assert.equal(a.normalizedHash, again.normalizedHash);
    assert.notEqual(a.encryptedValue, again.encryptedValue);
    assert.notEqual(
      a.normalizedHash,
      protectIdentity("b", "LOCAL_JSON", "fixture-c01").normalizedHash,
    );
    assert.equal(a.encryptedValue.includes("fixture-c01"), false);
  } finally {
    if (previous === undefined) delete process.env.CRM_IDENTITY_KEY;
    else process.env.CRM_IDENTITY_KEY = previous;
  }
});

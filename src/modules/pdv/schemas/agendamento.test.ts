import assert from "node:assert/strict";
import test from "node:test";
import {
  converterAgendamento,
  converterDataLocalSaoPaulo,
  formatoLocalSaoPaulo,
  esquemaListaAgendamentos,
} from "./agendamento";
const agora = new Date("2026-10-27T15:00:00Z");
test("fuso IANA respeita verão histórico e recusa lacunas/ambiguidades", () => {
  assert.equal(
    converterDataLocalSaoPaulo("2018-12-01T12:00").toISOString(),
    "2018-12-01T14:00:00.000Z",
  );
  assert.equal(
    formatoLocalSaoPaulo("2018-12-01T14:00:00Z"),
    "2018-12-01T12:00",
  );
  assert.throws(() => converterDataLocalSaoPaulo("2018-11-04T00:30"));
  assert.throws(() => converterDataLocalSaoPaulo("2018-02-17T23:30"));
  assert.doesNotThrow(() =>
    converterAgendamento(
      { paraLocal: "2018-12-01T12:00", antecedenciaMinutos: 30 },
      new Date("2018-12-01T13:00:00Z"),
    ),
  );
});
test("conversão usa São Paulo e antecedência sem depender do fuso servidor", () => {
  const d = converterAgendamento(
    { paraLocal: "2026-10-27T13:00", antecedenciaMinutos: 30 },
    agora,
  );
  assert.equal(d.agendadoPara.toISOString(), "2026-10-27T16:00:00.000Z");
  assert.equal(d.iniciarPreparoEm.toISOString(), "2026-10-27T15:30:00.000Z");
});
test("limites de cinco minutos e noventa dias e calendário real", () => {
  for (const paraLocal of [
    "2026-10-27T12:04",
    "2027-02-01T12:00",
    "2026-02-30T12:00",
    "2026-10-27T24:00",
  ])
    assert.throws(() =>
      converterAgendamento({ paraLocal, antecedenciaMinutos: 30 }, agora),
    );
  assert.doesNotThrow(() =>
    converterAgendamento(
      { paraLocal: "2026-10-27T12:05", antecedenciaMinutos: 30 },
      agora,
    ),
  );
  assert.throws(() =>
    converterAgendamento(
      { paraLocal: "2026-10-27T13:00", antecedenciaMinutos: 0 },
      agora,
    ),
  );
});
test("filtros rejeitam datas e períodos inválidos preservando abertos sem dia padrão", () => {
  assert.deepEqual(esquemaListaAgendamentos.parse({}), {
    de: "",
    ate: "",
    estado: "EM_ABERTO",
    pagina: 1,
  });
  for (const dados of [
    { de: "2026-02-30" },
    { de: "2026-10-28", ate: "2026-10-27" },
    { pagina: 0 },
    { estado: "COZINHA" },
  ])
    assert.equal(esquemaListaAgendamentos.safeParse(dados).success, false);
});

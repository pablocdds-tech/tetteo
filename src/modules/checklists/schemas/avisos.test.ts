import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avisoDaRotina,
  avisoDeConclusao,
  avisoDePendencia,
  avisoDePrazo,
} from "./avisos";

const diaria = {
  id: "rotina-ensaio",
  nome: "Abertura de ensaio",
  recorrencia: "DIARIA" as const,
  diaDaSemana: null,
  diaDoMes: null,
  horario: "07:00",
  ultimaFechada: null,
};
const fuso = "America/Sao_Paulo";

test("conclusão só avisa no intervalo das últimas 24 horas, sem incluir o futuro", () => {
  const agora = new Date("2026-11-04T10:00:00Z");
  const base = {
    id: "resposta-ensaio",
    nome: "Abertura de ensaio",
    itensNaoConformes: 0,
  };
  const limite = agora.getTime() - 24 * 60 * 60_000;
  assert.equal(
    avisoDeConclusao({ ...base, fechadaEm: new Date(limite - 1) }, agora),
    null,
  );
  assert.ok(avisoDeConclusao({ ...base, fechadaEm: new Date(limite) }, agora));
  assert.ok(avisoDeConclusao({ ...base, fechadaEm: agora }, agora));
  assert.equal(
    avisoDeConclusao(
      { ...base, fechadaEm: new Date(agora.getTime() + 1) },
      agora,
    ),
    null,
  );
});

test("conclusão tem chave estável, mostra não conformidades e não inventa aprovação", () => {
  const agora = new Date("2026-11-04T10:00:00Z");
  const resposta = {
    id: "resposta-ensaio",
    nome: "Abertura de ensaio",
    fechadaEm: new Date("2026-11-04T09:00:00Z"),
    itensNaoConformes: 0,
  };
  const aviso = avisoDeConclusao(resposta, agora)!;
  assert.equal(aviso.chave, "checklists:concluida:resposta-ensaio");
  assert.equal(
    aviso.assunto,
    'O checklist "Abertura de ensaio" foi concluído. Confira as respostas e evidências no sistema.',
  );
  assert.equal(
    avisoDeConclusao(resposta, new Date("2026-11-04T11:00:00Z"))!.chave,
    aviso.chave,
  );
  assert.match(
    avisoDeConclusao({ ...resposta, itensNaoConformes: 1 }, agora)!.assunto,
    /Apontou 1 não conformidade\./,
  );
  assert.match(
    avisoDeConclusao({ ...resposta, itensNaoConformes: 3 }, agora)!.assunto,
    /Apontou 3 não conformidades\./,
  );
});

test("lembrete começa no horário local e identifica a ocorrência", () => {
  assert.equal(
    avisoDaRotina(diaria, new Date("2026-11-03T09:59:00Z"), fuso),
    null,
  );
  const aviso = avisoDaRotina(diaria, new Date("2026-11-03T10:00:00Z"), fuso);
  assert.equal(
    aviso?.chave,
    "checklists:rotina:rotina-ensaio:2026-11-03:aguardando",
  );
  assert.match(aviso!.assunto, /é para hoje/);
});

test("conclusão no dia local cala cobrança e dia seguinte gera outra chave", () => {
  const rotina = { ...diaria, ultimaFechada: new Date("2026-11-04T02:30:00Z") };
  assert.equal(
    avisoDaRotina(rotina, new Date("2026-11-04T02:59:00Z"), fuso),
    null,
  );
  assert.match(
    avisoDaRotina(rotina, new Date("2026-11-04T10:00:00Z"), fuso)!.chave,
    /2026-11-04/,
  );
});

test("rotina semanal vencida mantém a referência da ocorrência", () => {
  const aviso = avisoDaRotina(
    { ...diaria, recorrencia: "SEMANAL", diaDaSemana: 1 },
    new Date("2026-11-03T10:00:00Z"),
    fuso,
  );
  assert.match(aviso!.chave, /2026-11-02:atrasada$/);
  assert.match(aviso!.assunto, /atrasado/);
});

test("prazo exato só vira atraso depois de vencido e alteração muda a chave", () => {
  const prazoEm = new Date("2026-11-03T10:00:00Z");
  const resposta = { id: "resposta-ensaio", nome: "Limpeza", prazoEm };
  assert.equal(avisoDePrazo(resposta, prazoEm), null);
  const agora = new Date("2026-11-03T10:00:01Z");
  assert.ok(avisoDePrazo(resposta, agora));
  assert.notEqual(
    avisoDePrazo(resposta, agora)!.chave,
    avisoDePrazo(
      { ...resposta, prazoEm: new Date("2026-11-03T09:00:00Z") },
      agora,
    )!.chave,
  );
});

test("pendência sem prazo permanece aberta e prazo vencido muda seu aviso", () => {
  const agora = new Date("2026-11-03T10:00:00Z");
  const base = {
    id: "pendencia-ensaio",
    descricao: "Limpar bancada",
    prazo: null,
  };
  assert.match(avisoDePendencia(base, agora).chave, /aberta:sem-prazo$/);
  assert.match(
    avisoDePendencia(
      { ...base, prazo: new Date("2026-11-02T10:00:00Z") },
      agora,
    ).chave,
    /atrasada:/,
  );
  assert.match(
    avisoDePendencia(
      { ...base, prazo: new Date("2026-11-03T03:00:00Z") },
      agora,
    ).chave,
    /aberta:/,
  );
});

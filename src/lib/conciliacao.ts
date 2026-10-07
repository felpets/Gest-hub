// Conciliação extrato ↔ app: chave de conteúdo para dedup e comparação de um
// extrato (OFX) com o que já está no banco. Funções puras (sem I/O) — usadas
// pela dedup da importação, pelo aviso de duplicata manual e pela tela de
// Conferir extrato.
import { norm } from "@/lib/format";

export type Tipo = "in" | "out";

// Lançamento "genérico" para comparação (serve p/ linha do OFX e p/ movimentação).
export type Lancamento = {
  id?: string;          // presente quando vem de uma movimentação já gravada
  dataISO: string;      // YYYY-MM-DD
  valor: number;        // sempre positivo (abs)
  tipo: Tipo;
  descricao: string;
  fitid: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

// Chave que identifica um lançamento por CONTEÚDO (dia + valor + tipo + nome).
// Dois lançamentos com a mesma chave são "o mesmo" para efeito de duplicata.
export function chaveConteudo(l: { dataISO: string; valor: number; tipo: Tipo; descricao: string }): string {
  return `${l.dataISO}|${r2(l.valor).toFixed(2)}|${l.tipo}|${norm(l.descricao).replace(/\s+/g, " ")}`;
}

export type ConfDivergente = { ofx: Lancamento; app: Lancamento };
export type ConfResultado = {
  batem: number;               // lançamentos do OFX que existem igual no app
  faltam: Lancamento[];        // no extrato, mas não no app (falta importar)
  sobram: Lancamento[];        // no app (no período do extrato), mas não no extrato
  divergentes: ConfDivergente[]; // mesmo FITID, mas valor/tipo diferente (editado)
};

// Compara as linhas do extrato (ofx) com as movimentações já gravadas (app).
// Cada movimentação do app é consumida no máximo uma vez — o que ficar sem
// par, dentro do intervalo de datas do extrato, é "sobra".
//
// A ordem dos passos importa, e custou 31 alarmes falsos para ficar clara:
// alguns bancos montam o FITID como data + POSIÇÃO no dia (20260831001,
// 20260831002...). Esse número não é estável — basta o banco inserir ou
// reordenar um lançamento daquele dia e todos os seguintes são renumerados.
// Ao reconferir o extrato, o FITID de um lançamento passa a apontar para o
// vizinho, e a tela acusava "valor divergente" em cascata, com a coluna do
// app inteira deslocada em uma linha (reiniciando a cada data, porque o
// contador do banco reinicia a cada dia).
//
// Por isso o CONTEÚDO (dia+valor+tipo+descrição) é julgado ANTES do FITID
// solto: ele descreve a transação, enquanto o FITID só a numera. Um FITID que
// andou se resolve no passo 2; sobra para o passo 3 apenas o caso que a tela
// quer mesmo mostrar — o FITID existe, mas aquele lançamento não está no app
// com nenhum valor, o que aponta edição à mão.
export function conferirExtrato(ofx: Lancamento[], app: Lancamento[]): ConfResultado {
  const usados = new Set<Lancamento>();

  // Vários lançamentos podem carregar o mesmo FITID (justamente quando o banco
  // renumera), então cada chave guarda a lista — não só o primeiro.
  const porFitid = new Map<string, Lancamento[]>();
  for (const m of app) {
    if (!m.fitid) continue;
    const arr = porFitid.get(m.fitid);
    if (arr) arr.push(m);
    else porFitid.set(m.fitid, [m]);
  }

  const porChave = new Map<string, Lancamento[]>();
  for (const m of app) {
    const k = chaveConteudo(m);
    const arr = porChave.get(k);
    if (arr) arr.push(m);
    else porChave.set(k, [m]);
  }

  const livre = (arr: Lancamento[] | undefined) => arr?.find((x) => !usados.has(x));

  let batem = 0;
  const faltam: Lancamento[] = [];
  const divergentes: ConfDivergente[] = [];

  // 1) FITID *e* valor/tipo iguais: par indiscutível, resolve antes de tudo
  //    para não deixar o passo 2 roubar a movimentação certa de outra linha.
  const semParForte: Lancamento[] = [];
  for (const o of ofx) {
    const m = o.fitid
      ? porFitid.get(o.fitid)?.find(
          (x) => !usados.has(x) && r2(x.valor) === r2(o.valor) && x.tipo === o.tipo
        )
      : undefined;
    if (m) {
      usados.add(m);
      batem++;
    } else semParForte.push(o);
  }

  // 2) Por conteúdo — é aqui que o FITID renumerado deixa de ser divergência.
  const semParConteudo: Lancamento[] = [];
  for (const o of semParForte) {
    const m = livre(porChave.get(chaveConteudo(o)));
    if (m) {
      usados.add(m);
      batem++;
    } else semParConteudo.push(o);
  }

  // 3) O FITID casa mas o lançamento não existe no app com esse conteúdo:
  //    provável edição à mão. O que nem isso tiver, falta importar.
  for (const o of semParConteudo) {
    const m = o.fitid ? livre(porFitid.get(o.fitid)) : undefined;
    if (m) {
      usados.add(m);
      divergentes.push({ ofx: o, app: m });
    } else faltam.push(o);
  }

  // "Sobra" = movimentação do app dentro do intervalo do extrato, sem par.
  const datas = ofx.map((o) => o.dataISO).sort();
  const de = datas[0];
  const ate = datas[datas.length - 1];
  const sobram = de
    ? app.filter((m) => !usados.has(m) && m.dataISO >= de && m.dataISO <= ate)
    : [];

  return { batem, faltam, sobram, divergentes };
}

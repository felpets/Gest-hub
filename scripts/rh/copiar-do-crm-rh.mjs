// Copia os dados do CRM RH (projeto Supabase antigo) para as tabelas rh_* do
// projeto Financeiro (supabase/42_rh_modulo.sql). O projeto antigo só é LIDO.
//
// Uso:
//   node scripts/rh/copiar-do-crm-rh.mjs                       só confere (conta e soma nos dois lados)
//   node scripts/rh/copiar-do-crm-rh.mjs --gravar              copia (upsert por id; pode rodar de novo)
//   node scripts/rh/copiar-do-crm-rh.mjs --gravar --espelhar   também apaga no destino o que não existe
//                                                              mais na origem — só na virada, com o CRM RH parado
//   node scripts/rh/copiar-do-crm-rh.mjs --gravar --config     também traz a CONFIGURAÇÃO do RH
//
// A configuração (tabela config: base de dias do VT/VR, feriados, rateio, jornada…)
// NÃO é copiada por padrão. Ela é ajustada no sistema novo, e o CRM RH não conhece as
// opções criadas aqui: copiar por cima revertia, em silêncio, o que foi configurado.
// Os dados de operação — pessoas, candidatos, pagamentos, atestados — vêm sempre.
//
// Variáveis (em .env.local — nunca no repositório; as chaves de serviço ficam em
// Supabase › Project Settings › API keys):
//   RH_ORIGEM_URL                  https://apatabasuxkgqxabuqdj.supabase.co
//   RH_ORIGEM_SERVICE_ROLE_KEY     chave de serviço do projeto ZAYTAN CRM RH
//   SUPABASE_URL                   URL do projeto Financeiro (ou VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY      chave de serviço do projeto Financeiro
//
// Não imprime dado pessoal: só nomes de tabela, contagens e somas de valores.
//
// A conferência reprova em duas coisas: linha da origem que não chegou ao
// destino ('faltam') e valor que chegou diferente ('soma origem' × 'soma
// copiada', que só considera as linhas vindas de lá). O que foi cadastrado
// direto no sistema novo aparece em 'só do novo' e NÃO é divergência.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const GRAVAR = args.has("--gravar");
const COM_CONFIG = args.has("--config");
const ESPELHAR = args.has("--espelhar");

// ─── Ambiente ───────────────────────────────────────────────
function lerEnvLocal() {
  for (const nome of [".env.local", ".env"]) {
    const arq = path.resolve(nome);
    if (!fs.existsSync(arq)) continue;
    for (const linha of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
lerEnvLocal();

const URL_DESTINO = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const faltando = ["RH_ORIGEM_URL", "RH_ORIGEM_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  .filter((v) => !process.env[v])
  .concat(URL_DESTINO ? [] : ["SUPABASE_URL"]);
if (faltando.length) {
  console.error(`Faltam variáveis no .env.local: ${faltando.join(", ")}`);
  process.exit(1);
}
if (process.env.RH_ORIGEM_URL === URL_DESTINO) {
  console.error("Origem e destino são o mesmo projeto. Confira RH_ORIGEM_URL e SUPABASE_URL.");
  process.exit(1);
}

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
const origem = createClient(process.env.RH_ORIGEM_URL, process.env.RH_ORIGEM_SERVICE_ROLE_KEY, opcoes);
const destino = createClient(URL_DESTINO, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoes);

// Mensagem de erro sem valores (uma violação de chave, por exemplo, traria o CPF).
const limpo = (e) =>
  `${e?.code ?? "erro"}: ${String(e?.message ?? e).replace(/\([^)]*\)=\([^)]*\)/g, "(…)=(…)").replace(/\d{5,}/g, "•••")}`;

// Ordem importa: pais antes dos filhos (verbas depois dos extratos, itens depois das folhas).
const TABELAS = [
  ...(COM_CONFIG ? [{ nome: "config", pk: "id" }] : []),
  { nome: "perguntas", pk: "id" },
  { nome: "funcionarios", pk: "id" },
  { nome: "candidatos", pk: "id" },
  { nome: "pagamentos", pk: "id", soma: "valor" },
  { nome: "atestados", pk: "id" },
  { nome: "documentos", pk: "id" },
  { nome: "treinamentos", pk: "id" },
  { nome: "pagamentos_diarios", pk: "id", soma: "valor" },
  { nome: "folha_importacoes", pk: "id" },
  { nome: "extratos_mensais", pk: "id", soma: "liquido" },
  { nome: "folha_eventos", pk: "id", soma: "valor" },
  { nome: "folhas", pk: "id", soma: "liquido" },
  { nome: "folha_itens", pk: "id", soma: "valor" },
];
const BUCKETS = [
  { de: "documentos", para: "rh-documentos" },
  { de: "extratos", para: "rh-extratos" },
];

async function lerTudo(cliente, tabela, colunas, pk) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await cliente.from(tabela).select(colunas).order(pk).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${limpo(error)}`);
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

const somar = (linhas, col) => (col ? Math.round(linhas.reduce((s, r) => s + (Number(r[col]) || 0), 0) * 100) / 100 : null);
const blocos = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

async function listarArquivos(cliente, bucket, pasta = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await cliente.storage.from(bucket).list(pasta, { limit: 1000, offset });
    if (error) throw new Error(`bucket ${bucket}: ${limpo(error)}`);
    for (const item of data) {
      const caminho = pasta ? `${pasta}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listarArquivos(cliente, bucket, caminho)));
      else out.push({ caminho, tipo: item.metadata?.mimetype });
    }
    if (data.length < 1000) return out;
  }
}

// ─── Execução ───────────────────────────────────────────────
console.log(GRAVAR ? `Copiando${ESPELHAR ? " (espelhando)" : ""}…` : "Conferindo (nada é gravado; use --gravar para copiar)…");
const relatorio = [];
let falhou = false;

// Espelhar: apaga primeiro, dos filhos para os pais, o que sumiu da origem.
const origemPorTabela = new Map();
for (const t of TABELAS) {
  origemPorTabela.set(t.nome, await lerTudo(origem, t.nome, "*", t.pk));
}

if (GRAVAR && ESPELHAR) {
  for (const t of [...TABELAS].reverse()) {
    const idsOrigem = new Set(origemPorTabela.get(t.nome).map((r) => String(r[t.pk])));
    const noDestino = await lerTudo(destino, `rh_${t.nome}`, t.pk, t.pk);
    const sobrando = noDestino.map((r) => r[t.pk]).filter((id) => !idsOrigem.has(String(id)));
    for (const bloco of blocos(sobrando, 200)) {
      const { error } = await destino.from(`rh_${t.nome}`).delete().in(t.pk, bloco);
      if (error) throw new Error(`rh_${t.nome} (apagar): ${limpo(error)}`);
    }
    if (sobrando.length) console.log(`  rh_${t.nome}: ${sobrando.length} apagado(s) (não existem mais na origem)`);
  }
}

for (const t of TABELAS) {
  const linhas = origemPorTabela.get(t.nome);
  if (GRAVAR) {
    for (const bloco of blocos(linhas, 500)) {
      const { error } = await destino.from(`rh_${t.nome}`).upsert(bloco, { onConflict: t.pk });
      if (error) {
        console.error(`  rh_${t.nome}: ${limpo(error)}`);
        falhou = true;
        break;
      }
    }
  }
  let doDestino;
  try {
    doDestino = await lerTudo(destino, `rh_${t.nome}`, t.soma ? `${t.pk}, ${t.soma}` : t.pk, t.pk);
  } catch (e) {
    console.error(`  ${e.message}${/PGRST205|42P01/.test(e.message) ? " — rode supabase/42_rh_modulo.sql antes" : ""}`);
    falhou = true;
    continue;
  }
  const ids = new Set(doDestino.map((r) => String(r[t.pk])));
  const faltam = linhas.filter((r) => !ids.has(String(r[t.pk]))).length;

  // O destino costuma ter MAIS linhas que a origem: tudo o que foi cadastrado
  // direto no sistema novo, que o CRM antigo nunca conheceu. Por isso a soma
  // comparável é só a das linhas que vieram de lá — somar o destino inteiro
  // acusaria diferença sempre, e quem visse isso poderia tentar 'consertar'
  // com --espelhar, que apagaria justamente esses registros novos.
  const idsOrigem = new Set(linhas.map((r) => String(r[t.pk])));
  const vindasDaOrigem = doDestino.filter((r) => idsOrigem.has(String(r[t.pk])));
  const soDoDestino = doDestino.length - vindasDaOrigem.length;

  relatorio.push({
    tabela: t.nome,
    origem: linhas.length,
    destino: doDestino.length,
    faltam,
    "só do novo": soDoDestino,
    "soma origem": somar(linhas, t.soma) ?? "",
    "soma copiada": somar(vindasDaOrigem, t.soma) ?? "",
  });
}

for (const b of BUCKETS) {
  const arquivos = await listarArquivos(origem, b.de);
  let copiados = 0;
  if (GRAVAR) {
    for (const a of arquivos) {
      const baixado = await origem.storage.from(b.de).download(a.caminho);
      if (baixado.error) { console.error(`  ${b.de}: ${limpo(baixado.error)}`); falhou = true; continue; }
      const { error } = await destino.storage.from(b.para).upload(a.caminho, baixado.data, {
        upsert: true, contentType: a.tipo || undefined,
      });
      if (error) { console.error(`  ${b.para}: ${limpo(error)}`); falhou = true; continue; }
      copiados++;
    }
  }
  const noDestino = await listarArquivos(destino, b.para).catch(() => []);
  relatorio.push({
    tabela: `arquivos ${b.de} → ${b.para}`,
    origem: arquivos.length,
    destino: noDestino.length,
    faltam: GRAVAR ? arquivos.length - copiados : "",
    "só do novo": "",
    "soma origem": "",
    "soma copiada": "",
  });
}

console.table(relatorio);

// Reprova em duas coisas, e só nelas: linha da origem que não chegou, e valor
// que chegou diferente. Registro nascido no sistema novo não é divergência —
// é o sistema sendo usado.
const divergentes = relatorio.filter((r) => r.faltam || r["soma origem"] !== r["soma copiada"]);
const extras = relatorio.filter((r) => Number(r["só do novo"]) > 0);

if (falhou || divergentes.length) {
  console.log(GRAVAR ? "Terminou com diferenças — veja a tabela acima." : "Ainda há diferenças (esperado antes de copiar).");
  process.exitCode = GRAVAR ? 1 : 0;
} else {
  console.log("Tudo o que existe no CRM antigo está no sistema novo, com os mesmos valores.");
  if (extras.length) {
    console.log(
      `Além disso, o sistema novo tem registros próprios (${extras.map((r) => `${r.tabela}: ${r["só do novo"]}`).join(", ")}) — ` +
      "não vieram do CRM antigo e --espelhar os apagaria.",
    );
  }
}

import { useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload, CheckCircle2, AlertTriangle, RefreshCw, Loader2, Info, ListChecks, Sparkles, Landmark, Plus, ArrowRight,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/lib/format";
import {
  useImportLote, usePlanoContas, fetchExistingFitids, fetchMovimentacoesConta, useMovimentacoes,
  useContasBancarias, useSaveContaBancaria, useInterStatus, useInterSync,
  useAcertarSaldoExtrato, useCartoes, useSaveCartao, useImportCartao, useCartaoLancamentos,
  fetchCartaoLancamentosIntervalo,
  type Cartao, type ContaBancaria, type ImportRow, type ImportCartaoRow,
} from "@/lib/queries";
import { chaveDescricao } from "@/lib/cartoes";
import { chaveConteudo } from "@/lib/conciliacao";
import { useEmpresa } from "@/lib/empresa";
import { useEhCelular } from "@/lib/tela";
import {
  parseFile, marcarDuplicatas, novoVistoNoLote,
  type ParsedRow, type OfxAccountMeta, type OfxLedger,
} from "@/lib/import-parsers";
import { hojeISO, fmtBR } from "@/lib/datas";

// Linha que vai de fato para a revisão: válida e não duplicada — ou duplicada
// com o "incluir mesmo assim" marcado pelo usuário.
const vaiImportar = (r: ParsedRow) => r.ok && (!r.duplicate || !!r.incluirMesmoAssim);

// Destino de um arquivo: uma conta bancária (o id dela) ou um cartão de
// crédito ("cartao:<id>"). O extrato do cartão não vira movimentação — vai
// para o demonstrativo do cartão (migração 53) e não mexe no saldo.
const PREFIXO_CARTAO = "cartao:";
const destinoCartao = (id: string) => `${PREFIXO_CARTAO}${id}`;
const cartaoDoDestino = (destino: string): string | null =>
  destino.startsWith(PREFIXO_CARTAO) ? destino.slice(PREFIXO_CARTAO.length) : null;

// OFX de cartão de crédito: casa pelo final do número (4 últimos dígitos).
const ehOfxDeCartao = (acc: OfxAccountMeta | null) => acc?.acctType?.toUpperCase() === "CREDITCARD";
const finalDoNumero = (acctId: string | null | undefined) => (acctId ?? "").replace(/\D/g, "").slice(-4);

// Um arquivo importado com o destino resolvido (conta bancária ou cartão).
type FileEntry = {
  fileName: string;
  source: "ofx" | "sheet" | "pdf";
  account: OfxAccountMeta | null;
  contaId: string; // destino; "" = ainda não resolvido
  rows: ParsedRow[];
  ledger: OfxLedger | null; // saldo do banco (OFX), p/ acertar o saldo inicial
  invertido?: boolean; // sinais trocados para o cartão (ver comSinalDoDestino)
};

// A fatura de cartão em planilha traz a COMPRA como valor positivo e o
// pagamento/estorno como negativo — o contrário do extrato do banco. Mandada
// para um cartão, os sinais são trocados: compra vira gasto, crédito vira
// pagamento da fatura. Voltando para uma conta bancária, desfaz. OFX não
// precisa: lá a compra já vem negativa.
const inverterTipos = (rows: ParsedRow[]) =>
  rows.map((r) => (r.tipo ? { ...r, tipo: r.tipo === "in" ? ("out" as const) : ("in" as const) } : r));

function comSinalDoDestino(e: FileEntry, destino: string): FileEntry {
  const querInvertido = !!cartaoDoDestino(destino) && e.source === "sheet";
  if (querInvertido === !!e.invertido) return { ...e, contaId: destino };
  return { ...e, contaId: destino, rows: inverterTipos(e.rows), invertido: querInvertido };
}

export function Importar() {
  const celular = useEhCelular();
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const importMut = useImportLote();
  const saveConta = useSaveContaBancaria();
  const acertarMut = useAcertarSaldoExtrato();
  const { data: contas = [] } = usePlanoContas();
  const { data: movimentos = [] } = useMovimentacoes();
  const { data: contasBancarias = [] } = useContasBancarias();
  const { contaId: contaAtivaId } = useEmpresa();
  const ativas = contasBancarias.filter((c) => c.ativo);
  const { data: cartoes = [] } = useCartoes();
  const cartoesAtivos = cartoes.filter((c) => c.ativo);
  const { data: lancamentosCartao = [] } = useCartaoLancamentos();
  const saveCartao = useSaveCartao();
  const importCartaoMut = useImportCartao();

  const [step, setStep] = useState<"idle" | "assign" | "preview">("idle");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [acertarSaldo, setAcertarSaldo] = useState(true);
  const [sending, setSending] = useState(false);
  // Importou, mas a pré-categorização falhou: mostra o que entrou + o motivo.
  const [resultado, setResultado] = useState<
    { importadas: number; jaExistiam: number; lote: string; sugestaoErro: string } | null
  >(null);

  const contaById = useMemo(() => new Map(contasBancarias.map((c) => [c.id, c])), [contasBancarias]);
  const cartaoById = useMemo(() => new Map(cartoes.map((c) => [c.id, c])), [cartoes]);
  const nomeDestino = (destino: string) => {
    const cartaoId = cartaoDoDestino(destino);
    if (cartaoId) {
      const c = cartaoById.get(cartaoId);
      return c ? `${c.nome}${c.final ? ` •••• ${c.final}` : ""}` : "Cartão";
    }
    return contaById.get(destino)?.nome ?? "—";
  };

  // A categoria que a mesma compra já recebeu antes no cartão (a mais recente
  // vence): o extrato do cartão repete os mesmos fornecedores todo mês.
  const categoriaAprendida = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lancamentosCartao) {
      if (!l.categoria) continue;
      const k = `${l.cartaoId}|${chaveDescricao(l.descricao)}`;
      if (!map.has(k)) map.set(k, l.categoria); // a lista vem da mais recente para a mais antiga
    }
    return map;
  }, [lancamentosCartao]);

  // Saldo do banco (OFX/PDF) por conta destino — usa o extrato de data mais recente
  // quando há vários arquivos para a mesma conta. Alimenta a conciliação. Cartão
  // fica de fora: o saldo dele é a fatura, não dinheiro na conta.
  const ledgerByConta = useMemo(() => {
    const map = new Map<string, OfxLedger>();
    for (const e of entries) {
      if (!e.ledger || !e.contaId || cartaoDoDestino(e.contaId)) continue;
      const cur = map.get(e.contaId);
      if (!cur || e.ledger.asOfISO > cur.asOfISO) map.set(e.contaId, e.ledger);
    }
    return map;
  }, [entries]);

  // Data do último lançamento já no sistema — ajuda a saber a partir de quando
  // exportar o próximo extrato (evita reimportar o que já entrou).
  const ultimaData = useMemo(() => {
    let max = "";
    for (const m of movimentos) if (m.dataISO > max) max = m.dataISO;
    if (!max) return null;
    const [y, mo, d] = max.split("-");
    return `${d}/${mo}/${y}`;
  }, [movimentos]);

  // Caminho "Pai / Filho" -> id do plano de contas (categoria do Excel = sugestão).
  const pathToId = useMemo(() => {
    const roots = contas.filter((c) => !c.parentId);
    const map = new Map<string, string>();
    for (const r of roots) {
      map.set(r.nome, r.id);
      for (const c of contas.filter((x) => x.parentId === r.id)) {
        map.set(`${r.nome} / ${c.nome}`, c.id);
      }
    }
    return map;
  }, [contas]);

  const allRows = entries.flatMap((e) => e.rows);
  const importableCount = allRows.filter(vaiImportar).length;
  // As do cartão não passam pela revisão: vão direto para o demonstrativo.
  const paraRevisao = entries
    .filter((e) => !cartaoDoDestino(e.contaId))
    .reduce((n, e) => n + e.rows.filter(vaiImportar).length, 0);
  const dupCount = allRows.filter((r) => r.duplicate && !r.incluirMesmoAssim).length;
  const errCount = allRows.filter((r) => !r.ok).length;
  const comSugestao = allRows.filter((r) => vaiImportar(r) && r.categoria).length;

  // Duplicatas por conteúdo: o usuário pode mandar importar assim mesmo.
  const dupContentRows = allRows.filter((r) => r.dupContent);
  const dupContentFora = dupContentRows.filter((r) => !r.incluirMesmoAssim).length;
  const dupNoArquivo = dupContentRows.filter((r) => r.dupNoArquivo).length;
  const allResolved = entries.length > 0 && entries.every((e) => e.contaId);
  const fileName = entries.length === 1 ? entries[0].fileName : entries.length ? `${entries.length} arquivos` : "";
  const showContaCol = new Set(entries.map((e) => e.contaId)).size > 1;

  const reset = () => {
    setStep("idle");
    setEntries([]);
    setParseError(null);
    setResultado(null);
    importMut.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  // Casa a conta pelo fingerprint do OFX (banco + número).
  const matchConta = (acc: OfxAccountMeta | null) => {
    if (!acc?.bankId || !acc?.acctId) return null;
    return contasBancarias.find((c) => c.bankId === acc.bankId && c.acctId === acc.acctId) ?? null;
  };

  // Destino automático: OFX de cartão casa com o cartão de mesmo final (e NUNCA
  // cai na conta ativa — seria compra de cartão virando saída de caixa); o
  // resto segue a regra de sempre (fingerprint → conta ativa → conta única).
  const destinoAutomatico = (acc: OfxAccountMeta | null): string => {
    if (ehOfxDeCartao(acc)) {
      const fim = finalDoNumero(acc?.acctId);
      const c = fim ? cartoesAtivos.find((x) => x.final && x.final === fim) : undefined;
      return c ? destinoCartao(c.id) : "";
    }
    return matchConta(acc)?.id ?? contaAtivaId ?? (ativas.length === 1 ? ativas[0].id : "");
  };

  // Marca duplicatas por conta (mesmo FITID pode existir em bancos diferentes).
  const runDedup = async (list: FileEntry[]): Promise<FileEntry[]> => {
    const byConta = new Map<string, FileEntry[]>();
    for (const e of list) {
      const arr = byConta.get(e.contaId);
      if (arr) arr.push(e);
      else byConta.set(e.contaId, [e]);
    }
    const marked = new Map<FileEntry, ParsedRow[]>();
    for (const [contaId, group] of byConta) {
      const cartaoId = cartaoDoDestino(contaId);
      const fitids = group.flatMap((e) => e.rows.map((r) => r.fitid).filter((x): x is string => !!x));
      const existing = fitids.length && !cartaoId ? await fetchExistingFitids(fitids, contaId) : new Set<string>();

      // Dedup por CONTEÚDO (dia+valor+tipo+descrição): pega lançamentos que já
      // existem sem FITID igual — ex.: manual que repete o extrato, ou
      // reimportação em que o banco gerou FITIDs diferentes. Busca as
      // movimentações já gravadas no intervalo de datas do lote (no cartão, as
      // compras dele — e de lá também saem os FITIDs já importados).
      const datas = group
        .flatMap((e) => e.rows.map((r) => r.data).filter((d): d is string => !!d))
        .sort();
      const contentSet = new Set<string>();
      if (datas.length) {
        const movs = cartaoId
          ? await fetchCartaoLancamentosIntervalo(cartaoId, datas[0], datas[datas.length - 1])
          : await fetchMovimentacoesConta(contaId, datas[0], datas[datas.length - 1]);
        for (const m of movs) {
          contentSet.add(chaveConteudo(m));
          if (cartaoId && m.fitid) existing.add(m.fitid);
        }
      }

      // `visto` é compartilhado pelos arquivos da mesma conta: manda vários
      // meses de uma vez e a repetição entre eles também é pega.
      const visto = novoVistoNoLote();
      for (const e of group) {
        marked.set(
          e,
          marcarDuplicatas(e.rows, { fitids: existing, conteudos: contentSet }, visto).map((r) => ({
            ...r,
            categoria: pathToId.has(r.categoria) ? r.categoria : "",
          }))
        );
      }
    }
    return list.map((e) => ({ ...e, rows: marked.get(e) ?? e.rows }));
  };

  const handleFiles = async (files?: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setParseError(null);
    setReading(true);
    try {
      const built: FileEntry[] = [];
      for (const f of list) {
        const fp = await parseFile(f);
        if (fp.rows.length === 0) continue;
        const auto = destinoAutomatico(fp.account);
        built.push(comSinalDoDestino(
          { fileName: fp.fileName, source: fp.source, account: fp.account, contaId: "", rows: fp.rows, ledger: fp.ledger },
          auto,
        ));
      }
      if (built.length === 0) {
        setParseError("Nenhuma transação encontrada no(s) arquivo(s).");
        return;
      }
      if (built.every((e) => e.contaId)) {
        setEntries(await runDedup(built));
        setStep("preview");
      } else {
        setEntries(built);
        setStep("assign");
      }
    } catch {
      setParseError("Não consegui ler o(s) arquivo(s). Use OFX, PDF (extrato do C6), CSV ou Excel (.xlsx) válidos.");
    } finally {
      setReading(false);
    }
  };

  // "Incluir mesmo assim" de uma duplicata por conteúdo — por linha ou em bloco.
  const setIncluir = (fileIdx: number, rowIdx: number, incluir: boolean) =>
    setEntries((prev) =>
      prev.map((e, i) =>
        i !== fileIdx ? e : { ...e, rows: e.rows.map((r, j) => (j === rowIdx ? { ...r, incluirMesmoAssim: incluir } : r)) }
      )
    );

  const setIncluirTodas = (incluir: boolean) =>
    setEntries((prev) =>
      prev.map((e) => ({ ...e, rows: e.rows.map((r) => (r.dupContent ? { ...r, incluirMesmoAssim: incluir } : r)) }))
    );

  const assignConta = (i: number, contaId: string) =>
    setEntries((prev) => prev.map((x, idx) => (idx === i ? comSinalDoDestino(x, contaId) : x)));

  // Trocar o destino já na prévia: as repetidas dependem do destino (o que já
  // existe numa conta não existe no cartão), então a checagem roda de novo.
  const trocarDestino = async (i: number, destino: string) => {
    const novo = entries.map((x, idx) => (idx === i ? comSinalDoDestino(x, destino) : x));
    setReading(true);
    try {
      setEntries(await runDedup(novo));
    } catch {
      setEntries(novo);
      setParseError("Erro ao verificar duplicatas.");
    } finally {
      setReading(false);
    }
  };

  // Extrato de cartão que ainda não tem cadastro: cria o cartão com o nome do
  // banco e o final do número, e manda para ele este arquivo e os do mesmo cartão.
  const createCartaoFromEntry = async (i: number) => {
    const e = entries[i];
    const fim = finalDoNumero(e.account?.acctId);
    try {
      const id = await saveCartao.mutateAsync({
        input: {
          nome: e.account?.org?.trim() ? `Cartão ${e.account.org.trim()}` : "Cartão de crédito",
          final: fim,
          diaFechamento: null,
          diaVencimento: null,
          ativo: true,
        },
      });
      setEntries((prev) =>
        prev.map((x, idx) =>
          idx === i || (fim && ehOfxDeCartao(x.account) && finalDoNumero(x.account?.acctId) === fim && !x.contaId)
            ? comSinalDoDestino(x, destinoCartao(id))
            : x
        )
      );
      toast.success("Cartão cadastrado. Informe os dias de fechamento e vencimento em Caixa › Cartões.");
    } catch {
      setParseError("Não consegui cadastrar o cartão. Tente selecionar um cartão existente.");
    }
  };

  // Cria a conta a partir do OFX (nome/banco/fingerprint) e a atribui a este
  // arquivo e a outros com o mesmo fingerprint.
  const createContaFromEntry = async (i: number) => {
    const e = entries[i];
    if (!e.account) return;
    const nome = e.account.org?.trim() || e.fileName.replace(/\.[^.]+$/, "") || "Conta importada";
    try {
      const id = await saveConta.mutateAsync({
        input: {
          nome,
          banco: e.account.org ?? "",
          saldoInicial: 0,
          saldoInicialData: hojeISO(),
          ativo: true,
          bankId: e.account.bankId,
          acctId: e.account.acctId,
          acctType: e.account.acctType,
        },
      });
      setEntries((prev) =>
        prev.map((x) =>
          x.account?.fingerprint && e.account?.fingerprint && x.account.fingerprint === e.account.fingerprint
            ? { ...x, contaId: id }
            : x
        )
      );
    } catch {
      setParseError("Não consegui criar a conta. Tente selecionar uma conta existente.");
    }
  };

  const resolveAndContinue = async () => {
    setReading(true);
    try {
      setEntries(await runDedup(entries));
      setStep("preview");
    } catch {
      setParseError("Erro ao verificar duplicatas.");
    } finally {
      setReading(false);
    }
  };

  // Só acerta o saldo pelo banco (sem importar nada) — para quando o extrato já
  // está todo importado mas o saldo do app não bate. Usa o que já está no banco.
  const handleAcertarSaldo = async () => {
    setSending(true);
    setParseError(null);
    try {
      for (const [contaId, l] of ledgerByConta) {
        await acertarMut.mutateAsync({ contaId, ledger: l.amount, asOfISO: l.asOfISO });
      }
      navigate({ to: "/" });
    } catch {
      setParseError("Não consegui acertar o saldo. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const byConta = new Map<string, ImportRow[]>();
      const byCartao = new Map<string, ImportCartaoRow[]>();
      for (const e of entries) {
        const cartaoId = cartaoDoDestino(e.contaId);
        for (const r of e.rows) {
          if (!vaiImportar(r)) continue;
          if (cartaoId) {
            const arr = byCartao.get(cartaoId) ?? [];
            arr.push({
              data: r.data!,
              descricao: r.descricao!,
              valor: r.valor!,
              tipo: r.tipo!,
              fitid: r.fitid ?? null,
              // A categoria da fatura é a do emissor do cartão ("Elétrico",
              // "Serviços de terceiros") e não fala com o plano de contas: vale
              // só a que a mesma compra já recebeu aqui.
              categoria: categoriaAprendida.get(`${cartaoId}|${chaveDescricao(r.descricao!)}`) || null,
            });
            byCartao.set(cartaoId, arr);
            continue;
          }
          const arr = byConta.get(e.contaId) ?? [];
          arr.push({
            data: r.data!,
            descricao: r.descricao!,
            valor: r.valor!,
            tipo: r.tipo!,
            fitid: r.fitid ?? null,
            sugeridaId: r.categoria ? pathToId.get(r.categoria) ?? null : null,
          });
          byConta.set(e.contaId, arr);
        }
      }
      // Cartões primeiro: não passam pela revisão (não viram movimentação).
      let doCartao = 0;
      for (const [cartaoId, rows] of byCartao) {
        const r = await importCartaoMut.mutateAsync({ cartaoId, rows });
        doCartao += r.inserted;
      }
      if (byConta.size === 0) {
        toast.success(`${doCartao} compra${doCartao === 1 ? "" : "s"} do cartão importada${doCartao === 1 ? "" : "s"}.`);
        navigate({ to: "/financeiro/caixa", search: { aba: "cartoes" } });
        return;
      }
      if (doCartao > 0) {
        toast.success(`${doCartao} compra${doCartao === 1 ? "" : "s"} do cartão foram para Caixa › Cartões.`);
      }

      let lastLote = "";
      let importadas = 0;
      let jaExistiam = 0;
      let sugestaoErro: string | null = null;
      for (const [contaId, rows] of byConta) {
        if (rows.length === 0) continue;
        const r = await importMut.mutateAsync({ contaId, rows });
        if (r.loteId) lastLote = r.loteId;
        importadas += r.inserted;
        jaExistiam += r.skipped;
        sugestaoErro = sugestaoErro ?? r.sugestaoErro;
      }
      // Acerta o saldo inicial de cada conta pelo saldo do banco (OFX) — assim
      // o saldo do app bate com o banco quando os lançamentos forem aprovados.
      if (acertarSaldo) {
        for (const [contaId, ledger] of ledgerByConta) {
          try {
            await acertarMut.mutateAsync({ contaId, ledger: ledger.amount, asOfISO: ledger.asOfISO });
          } catch {
            // conciliação é best-effort: não bloqueia a importação
          }
        }
      }
      // As transações JÁ estão gravadas. Se a pré-categorização falhou, ficar
      // na tela mostrando o motivo é melhor do que mandar para a revisão sem
      // explicar por que nada veio sugerido (e melhor ainda do que parecer que
      // a importação falhou, levando a um reenvio).
      if (sugestaoErro) {
        setResultado({ importadas, jaExistiam, lote: byConta.size === 1 ? lastLote : "", sugestaoErro });
        return;
      }
      // 1 conta → foca o lote; várias → mostra todos os pendentes.
      navigate({ to: "/financeiro/extratos", search: { aba: "revisar", lote: byConta.size === 1 ? lastLote : "" } });
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell
      title="Importar extrato"
      subtitle="Envie um ou vários OFX, PDF do C6, CSV ou Excel — a conta é detectada pelo arquivo e as transações entram para revisão"
      actions={
        <Button variant="outline" className="h-9" onClick={reset}>
          <RefreshCw className="h-4 w-4 mr-1.5" />Limpar
        </Button>
      }
    >
      {/* Contas conectadas ao Banco Inter — busca direta via API (sem arquivo) */}
      <InterSyncCard />

      {/* Dropzone */}
      <Card
        className={`card-elevated border-dashed border-2 p-8 mb-6 text-center transition-colors cursor-pointer ${
          dragOver ? "border-primary bg-primary/5" : "border-border/70 hover:border-primary/40"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".ofx,.pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center mb-3">
          {reading ? <Loader2 className="h-5 w-5 text-primary animate-spin" /> : <Upload className="h-5 w-5 text-primary" />}
        </div>
        {/* No celular não existe arrastar: o texto fala do toque, e a lista
            de formatos desce para a linha de baixo para caber em 360px. */}
        <h3 className="font-display text-base font-semibold">
          {celular ? "Escolher arquivo do extrato" : "Arraste os extratos (OFX, PDF do C6, CSV ou Excel) ou clique para selecionar"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl mx-auto">
          {fileName ? (
            <>Selecionado: <strong>{fileName}</strong></>
          ) : celular ? (
            "OFX, PDF do C6, CSV ou Excel exportado do banco. Dá para enviar mais de um; você revisa e aprova antes de valer."
          ) : (
            "Pode enviar vários de uma vez (meses/contas). No OFX e no PDF do C6 a conta é detectada automaticamente; você revisa e aprova antes de valer."
          )}
        </p>
        <Button className="mt-4 h-9 bg-foreground text-background hover:bg-foreground/90">
          <Upload className="h-4 w-4 mr-1.5" />{celular ? "Escolher arquivo" : "Selecionar arquivos"}
        </Button>
        {ultimaData && (
          <p className="text-xs text-muted-foreground mt-3">
            Último lançamento no sistema: <strong>{ultimaData}</strong> — exporte o extrato a partir dessa data (o que repetir é ignorado automaticamente).
          </p>
        )}
      </Card>

      {/* Como funciona */}
      {step === "idle" && (
        <Card className="p-5 card-elevated border-border/70 bg-secondary/30">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Como funciona</p>
              <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
                <strong>OFX</strong> (extrato nativo do banco), <strong>PDF do extrato do C6 Bank</strong> (que não tem OFX) ou <strong>CSV/Excel</strong> com cabeçalho:
                <strong> data</strong> (dd/mm/aaaa), <strong>descrição</strong>, <strong>valor</strong> e, opcionalmente, <strong>categoria</strong> e <strong>tipo</strong>.
                <br />
                No OFX e no PDF do C6 a <strong>conta bancária é reconhecida pelo arquivo</strong> (banco + número). CSV/Excel você escolhe a conta.
                <br />
                <strong>Extrato do cartão de crédito</strong>: escolha o cartão como destino. As compras vão para o demonstrativo em
                <strong> Caixa › Cartões</strong> e não mexem no saldo — a fatura paga continua sendo a saída da conta.
                Envie <strong>vários arquivos de uma vez</strong> — as repetições (por conta) são detectadas e ignoradas.
                Nada vira definitivo até você <strong>aprovar na tela de Revisão</strong>.
              </p>
            </div>
          </div>
        </Card>
      )}

      {parseError && (
        <Card className="p-4 card-elevated border-destructive/30 bg-destructive/5 mb-6">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" /> {parseError}
          </div>
        </Card>
      )}

      {/* Importou, mas as sugestões falharam. O importante é deixar claro que as
          transações ENTRARAM (reenviar só causaria erro de duplicado). */}
      {resultado && (
        <Card className="p-5 card-elevated border-warning/40 bg-warning/5 mb-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold">
                {resultado.importadas} transaç{resultado.importadas > 1 ? "ões entraram" : "ão entrou"} na revisão
              </p>
              {resultado.jaExistiam > 0 && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {resultado.jaExistiam} já existia{resultado.jaExistiam > 1 ? "m" : ""} nesta conta e {resultado.jaExistiam > 1 ? "foram ignoradas" : "foi ignorada"}.
                </p>
              )}
              <p className="text-sm text-warning-foreground mt-2">
                <strong>Mas não consegui sugerir as categorias.</strong> Elas estão na revisão sem sugestão — dá para
                categorizar à mão ou tentar de novo pelo botão <strong>Sugerir categorias</strong> lá.
                Não reenvie o extrato: ele já foi importado.
              </p>
              <p className="text-xs text-muted-foreground mt-2 font-mono break-words bg-secondary/50 rounded-md px-3 py-2">
                {resultado.sugestaoErro}
              </p>
              <div className="mt-3 flex gap-2 flex-wrap">
                <Button asChild className="h-9 bg-foreground text-background hover:bg-foreground/90">
                  <Link to="/financeiro/extratos" search={{ aba: "revisar", lote: resultado.lote }}>
                    Ir para a revisão <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                </Button>
                <Button variant="outline" className="h-9" onClick={reset}>Importar outro extrato</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Atribuir conta a cada arquivo */}
      {step === "assign" && (
        <Card className="p-6 card-elevated border-border/70">
          <div className="flex items-center gap-2 mb-1">
            <Landmark className="h-4 w-4 text-primary" />
            <h3 className="font-display text-base font-semibold">Escolha o destino de cada arquivo</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Não consegui reconhecer o destino de alguns arquivos. Escolha a conta bancária ou o cartão de crédito — ou cadastre o detectado.
          </p>
          <div className="space-y-3">
            {entries.map((e, i) => {
              return (
                <div key={i} className="flex items-center gap-3 flex-wrap rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{e.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.rows.length} linhas{e.account?.org ? ` · ${e.account.org}` : ""}
                      {e.account?.bankId && e.account?.acctId ? ` · ${e.account.bankId}/${e.account.acctId}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <SeletorDestino valor={e.contaId} contas={ativas} cartoes={cartoesAtivos} onChange={(v) => assignConta(i, v)} />
                    {!e.contaId && ehOfxDeCartao(e.account) ? (
                      <Button variant="outline" size="sm" className="h-9" disabled={saveCartao.isPending} onClick={() => createCartaoFromEntry(i)}>
                        <Plus className="h-4 w-4 mr-1" />Cadastrar cartão{finalDoNumero(e.account?.acctId) ? ` •••• ${finalDoNumero(e.account?.acctId)}` : ""}
                      </Button>
                    ) : !e.contaId && e.account?.fingerprint ? (
                      <Button variant="outline" size="sm" className="h-9" disabled={saveConta.isPending} onClick={() => createContaFromEntry(i)}>
                        <Plus className="h-4 w-4 mr-1" />Criar {e.account.org || e.account.bankId}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={resolveAndContinue} disabled={!allResolved || reading} className="h-9 bg-foreground text-background hover:bg-foreground/90">
              {reading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ListChecks className="h-4 w-4 mr-1.5" />}
              Continuar
            </Button>
          </div>
        </Card>
      )}

      {/* Prévia — some depois do envio: o lote já está no banco e reenviar só
          bateria no índice único. */}
      {step === "preview" && !resultado && (
        <>
          {/* Para onde vai cada arquivo — dá para trocar aqui mesmo (ex.: a
              planilha é do cartão, não da conta ativa). */}
          <Card className="p-4 card-elevated border-border/70 mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">Para onde vai cada arquivo</p>
              {reading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="divide-y divide-border">
              {entries.map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{e.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.rows.filter(vaiImportar).length} para importar
                      {cartaoDoDestino(e.contaId) ? " · compras do cartão: não mexem no saldo" : " · entram para revisão"}
                      {e.invertido && " · valores positivos lidos como compras"}
                    </p>
                  </div>
                  <SeletorDestino valor={e.contaId} contas={ativas} cartoes={cartoesAtivos}
                    disabled={reading || sending} onChange={(v) => trocarDestino(i, v)} />
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Linhas (todos os arquivos)</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{allRows.length}</p>
            </Card>
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Válidas para importar</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-success">{importableCount}</p>
            </Card>
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Já importadas (na conta)</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-muted-foreground">{dupCount}</p>
            </Card>
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Com erro (ignoradas)</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-warning-foreground">{errCount}</p>
            </Card>
          </div>

          {dupContentRows.length > 0 && (
            <Card className="p-4 card-elevated border-warning/40 bg-warning/5 mb-5">
              <div className="flex items-start gap-2.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-warning-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground">
                    <strong className="text-foreground">{dupContentRows.length} possível{dupContentRows.length > 1 ? "eis" : ""} duplicata{dupContentRows.length > 1 ? "s" : ""}</strong> — mesmo dia, valor e descrição, sem ser o mesmo código do banco.{" "}
                    {dupNoArquivo > 0 && (
                      <>
                        <strong className="text-foreground">{dupNoArquivo}</strong> repete{dupNoArquivo > 1 ? "m" : ""} outra linha do próprio extrato — comum quando o mesmo valor sai mais de uma vez no dia, e nesse caso são lançamentos de verdade.{" "}
                      </>
                    )}
                    Por segurança ficam de fora; marque <strong className="text-foreground">Incluir</strong> na tabela abaixo para importar assim mesmo.
                  </p>
                  <div className="mt-2">
                    {dupContentFora > 0 ? (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setIncluirTodas(true)}>
                        Incluir as {dupContentFora} mesmo assim
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setIncluirTodas(false)}>
                        Voltar a deixar de fora
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Conciliação: usa o saldo real do banco (LEDGERBAL do OFX ou o
              "Saldo do dia" do PDF) p/ acertar o saldo inicial da conta e o app
              passar a bater com o banco. */}
          {ledgerByConta.size > 0 && (
            <Card className="p-4 card-elevated border-primary/30 bg-primary/5 mb-5">
              <div className="flex items-start gap-3">
                {importableCount > 0 ? (
                  <Checkbox checked={acertarSaldo} onCheckedChange={(v) => setAcertarSaldo(!!v)} className="mt-0.5" id="acertar-saldo" />
                ) : (
                  <Landmark className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                )}
                <label htmlFor="acertar-saldo" className="min-w-0 cursor-pointer">
                  <p className="text-sm font-medium">Acertar o saldo pelo extrato do banco</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {importableCount > 0
                      ? "O extrato traz o saldo real do banco. Ao importar, ajustamos o saldo inicial da conta para o saldo do app bater com o banco (o histórico do gráfico é preservado)."
                      : "Tudo já importado. Mesmo assim dá para acertar o saldo inicial da conta pelo saldo do banco — clique em “Acertar saldo pelo banco”."}
                  </p>
                  <ul className="mt-2 space-y-0.5">
                    {[...ledgerByConta].map(([contaId, l]) => (
                      <li key={contaId} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{contaById.get(contaId)?.nome ?? "Conta"}</span>: banco informa{" "}
                        <span className="font-numeric tabular-nums text-foreground">{brl(l.amount)}</span> em {fmtBR(l.asOfISO)}
                      </li>
                    ))}
                  </ul>
                </label>
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {comSugestao > 0
                ? `${comSugestao} já vêm com categoria do arquivo (entram como sugestão).`
                : "A categoria de cada transação será sugerida e revisada na próxima tela."}
            </p>
            {importableCount > 0 ? (
              <Button
                onClick={handleSend}
                disabled={sending}
                className="h-9 bg-foreground text-background hover:bg-foreground/90"
              >
                {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ListChecks className="h-4 w-4 mr-1.5" />}
                {paraRevisao === 0
                  ? `Importar ${importableCount} no cartão`
                  : paraRevisao === importableCount
                    ? `Enviar ${importableCount} para revisão`
                    : `Enviar ${paraRevisao} para revisão e ${importableCount - paraRevisao} ao cartão`}
              </Button>
            ) : ledgerByConta.size > 0 ? (
              // Nada novo p/ importar, mas dá p/ acertar o saldo pelo banco (extrato).
              <Button
                onClick={handleAcertarSaldo}
                disabled={sending}
                className="h-9 bg-foreground text-background hover:bg-foreground/90"
              >
                {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ListChecks className="h-4 w-4 mr-1.5" />}
                Acertar saldo pelo banco
              </Button>
            ) : (
              <Button disabled className="h-9 bg-foreground text-background">Nada novo para importar</Button>
            )}
          </div>

          {importCartaoMut.isError && (
            <Card className="p-4 card-elevated border-destructive/30 bg-destructive/5 mb-4">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                {importCartaoMut.error instanceof Error ? importCartaoMut.error.message : "Erro ao importar o extrato do cartão."}
              </div>
            </Card>
          )}

          {importMut.isError && (
            <Card className="p-4 card-elevated border-destructive/30 bg-destructive/5 mb-4">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                {importMut.error instanceof Error ? importMut.error.message : "Erro ao enviar para revisão."}
              </div>
            </Card>
          )}

          <Card className="card-elevated border-border/70 overflow-hidden">
            <div className="overflow-x-auto max-h-[480px]">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Data</th>
                    <th className="text-left px-4 py-3 font-medium">Descrição</th>
                    {showContaCol && <th className="text-left px-4 py-3 font-medium">Conta</th>}
                    <th className="text-right px-4 py-3 font-medium">Valor</th>
                    <th className="text-left px-4 py-3 font-medium">Categoria (arquivo)</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries
                    .flatMap((e, fileIdx) =>
                      e.rows.map((r, rowIdx) => ({ r, fileIdx, rowIdx, conta: nomeDestino(e.contaId) }))
                    )
                    .slice(0, 300)
                    .map(({ r, fileIdx, rowIdx, conta }, i) => (
                    <tr key={i} className={`hover:bg-secondary/30 ${vaiImportar(r) ? "" : "bg-muted/30"}`}>
                      <td className="px-4 py-2.5 font-numeric tabular-nums">{r.data ?? (r.dataRaw || "—")}</td>
                      <td className="px-4 py-2.5 max-w-[260px] truncate">{r.descricao ?? (r.descRaw || "—")}</td>
                      {showContaCol && <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[120px]">{conta}</td>}
                      <td className={`px-4 py-2.5 text-right font-numeric tabular-nums ${r.tipo === "in" ? "text-success" : ""}`}>
                        {r.ok ? `${r.tipo === "in" ? "+" : "−"}${brl(r.valor!)}` : (r.valorRaw || "—")}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {vaiImportar(r) ? (r.categoria || <span className="text-muted-foreground/60">a sugerir</span>) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.dupContent ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              variant="outline"
                              className={r.incluirMesmoAssim
                                ? "bg-success/10 text-success border-success/30 gap-1"
                                : "bg-warning/10 text-warning-foreground border-warning/40 gap-1"}
                              title={r.dupNoArquivo
                                ? "Repete outra linha deste mesmo extrato"
                                : "Já existe um lançamento com mesmo dia, valor e descrição nesta conta"}
                            >
                              {r.incluirMesmoAssim ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                              {r.dupNoArquivo ? "Repetida no extrato" : "Possível duplicata"}
                            </Badge>
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                              <Checkbox
                                checked={!!r.incluirMesmoAssim}
                                onCheckedChange={(v) => setIncluir(fileIdx, rowIdx, !!v)}
                              />
                              Incluir
                            </label>
                          </div>
                        ) : r.duplicate ? (
                          <Badge variant="outline" className="bg-secondary text-muted-foreground border-border gap-1">Já importada</Badge>
                        ) : r.ok ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/30 gap-1">
                            <CheckCircle2 className="h-3 w-3" />OK
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-warning/10 text-warning-foreground border-warning/40 gap-1">
                            <AlertTriangle className="h-3 w-3" />{r.erro}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allRows.length > 300 && (
              <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
                Mostrando as primeiras 300 de {allRows.length} linhas — todas as válidas serão enviadas.
              </div>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}

// Destino do extrato: as contas bancárias e, logo abaixo, os cartões de
// crédito — o cartão é escolhido como se fosse mais um banco.
function SeletorDestino({ valor, contas, cartoes, onChange, disabled }: {
  valor: string;
  contas: ContaBancaria[];
  cartoes: Cartao[];
  onChange: (destino: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={valor || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 w-60"><SelectValue placeholder="Selecionar conta ou cartão..." /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Landmark className="h-3 w-3" /> Contas bancárias
          </SelectLabel>
          {contas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
        </SelectGroup>
        {cartoes.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <CreditCard className="h-3 w-3" /> Cartões de crédito
              </SelectLabel>
              {cartoes.map((c) => (
                <SelectItem key={c.id} value={destinoCartao(c.id)}>
                  {c.nome}{c.final ? ` •••• ${c.final}` : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}

// ─── Contas conectadas ao Banco Inter (busca via API, sem arquivo) ──
// Só aparece se a empresa tiver ao menos uma integração configurada.
// "Buscar extrato" chama a função server-side; transações novas caem na
// Revisão como um lote, igual ao upload.
function InterSyncCard() {
  const navigate = useNavigate();
  const { data: interStatus = [] } = useInterStatus();
  const { data: contasBancarias = [] } = useContasBancarias();
  const syncMut = useInterSync();
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const conectadas = interStatus.filter((s) => s.ativo);
  if (conectadas.length === 0) return null;

  const nomeConta = (id: string) => contasBancarias.find((c) => c.id === id)?.nome ?? "Conta";

  const buscar = async (contaId: string) => {
    setMsg(null);
    try {
      const r = await syncMut.mutateAsync({ contaId });
      if (r.inserted > 0 && r.loteId) {
        navigate({ to: "/financeiro/extratos", search: { aba: "revisar", lote: r.loteId } });
      } else {
        setMsg({ tipo: "ok", texto: `Nenhum lançamento novo desde a última busca (${r.skipped} já importados).` });
      }
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : "Falha na sincronização." });
    }
  };

  return (
    <Card className="p-5 card-elevated border-border/70 mb-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          <Landmark className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-display text-base font-semibold">Banco Inter conectado</h3>
          <p className="text-xs text-muted-foreground">
            Busca saldo e extrato direto da API — sem exportar arquivo. As transações novas entram na Revisão.
          </p>
        </div>
      </div>
      <div className="divide-y divide-border mt-2">
        {conectadas.map((s) => {
          const buscando = syncMut.isPending && syncMut.variables?.contaId === s.contaId;
          return (
            <div key={s.contaId} className="flex items-center gap-3 py-2.5 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{nomeConta(s.contaId)}</p>
                <p className="text-xs text-muted-foreground">
                  {s.ultimaSync
                    ? `Última busca: ${new Date(s.ultimaSync).toLocaleString("pt-BR")}`
                    : "Nunca sincronizada — a primeira busca traz até 89 dias de extrato."}
                  {s.ultimoSaldo != null && <> · Saldo no banco: <span className="font-numeric tabular-nums text-foreground">{brl(s.ultimoSaldo)}</span></>}
                </p>
                {s.ultimoErro && (
                  <p className="text-xs text-destructive mt-0.5" title={s.ultimoErro}>
                    Última sincronização falhou — tente de novo ou confira as credenciais em Ajustes.
                  </p>
                )}
              </div>
              <Button
                size="sm"
                className="h-9 bg-foreground text-background hover:bg-foreground/90 shrink-0"
                disabled={syncMut.isPending}
                onClick={() => buscar(s.contaId)}
              >
                {buscando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                Buscar extrato
              </Button>
            </div>
          );
        })}
      </div>
      {msg && (
        <p className={`text-[13px] font-medium rounded-md px-3 py-2 mt-2 ${
          msg.tipo === "erro" ? "text-destructive bg-destructive/10" : "text-muted-foreground bg-secondary/50"
        }`}>
          {msg.texto}
        </p>
      )}
    </Card>
  );
}

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { CreditCard, FileDown, FileSpreadsheet, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { brl } from "@/lib/format";
import { fmtBR, hojeISO, pad } from "@/lib/datas";
import { cn } from "@/lib/utils";
import { caminhoConta } from "@/lib/categorias";
import { useEmpresa } from "@/lib/empresa";
import { exportToPdf, exportToXlsx } from "@/lib/export";
import { chaveDescricao, faturaDe, gastosPorCategoria, resumoPorFatura } from "@/lib/cartoes";
import {
  useCartoes, useSaveCartao, useDesativarCartao, usePlanoContas,
  useCartaoLancamentos, useSetCategoriaCartaoLancamento, useDeleteCartaoLancamento,
  type Cartao, type CartaoInput,
} from "@/lib/queries";

// Financeiro › Caixa › Cartões: o demonstrativo de gastos de cada cartão.
//
// As compras vêm do extrato do cartão, importado em Extratos › Importar com o
// cartão como destino (migração 53). Elas NÃO entram no saldo nem nos
// relatórios de caixa: o dinheiro sai da conta uma vez só, quando a fatura é
// paga — e isso chega pelo extrato do banco. Aqui é o detalhe dessa fatura:
// quanto foi gasto, em quê, em cada mês.
//
// Todo valor POSITIVO no extrato do cartão é pagamento da fatura: aparece na
// lista e no total de pagamentos, mas nunca nos gastos por categoria.

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMes = (ym: string) => `${MESES_PT[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const SEM_CATEGORIA = "__sem__";

const vazio = (): CartaoInput => ({ nome: "", final: "", diaFechamento: null, diaVencimento: null, ativo: true });

export function Cartoes() {
  const hoje = hojeISO();
  const { data: cartoes = [], isLoading } = useCartoes();
  const { data: lancamentos = [] } = useCartaoLancamentos();
  const { data: plano = [] } = usePlanoContas();
  const desativar = useDesativarCartao();
  const setCategoria = useSetCategoriaCartaoLancamento();
  const excluir = useDeleteCartaoLancamento();
  const { empresaId, empresas } = useEmpresa();
  const empresaNome = empresas.find((e) => e.id === empresaId)?.nome ?? "Empresa";

  const [dialogo, setDialogo] = useState(false);
  const [editando, setEditando] = useState<Cartao | null>(null);
  const [cartaoSelId, setCartaoSelId] = useState<string | null>(null);
  const [faturaSel, setFaturaSel] = useState<string | null>(null);

  // Ativos primeiro; o selecionado cai no primeiro quando nada foi escolhido.
  const ordenados = useMemo(
    () => [...cartoes].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR")),
    [cartoes],
  );
  const cartao = ordenados.find((c) => c.id === cartaoSelId) ?? ordenados[0] ?? null;

  const doCartao = useMemo(
    () => (cartao ? lancamentos.filter((l) => l.cartaoId === cartao.id) : []),
    [lancamentos, cartao],
  );
  const faturas = useMemo(() => (cartao ? resumoPorFatura(doCartao, cartao) : []), [doCartao, cartao]);

  // Fatura aberta por padrão: a de hoje, se já tem compra; senão a mais recente.
  const faturaAtual = cartao ? faturaDe(hoje, cartao) : "";
  const fatura = faturas.find((f) => f.mes === faturaSel)
    ?? faturas.find((f) => f.mes === faturaAtual)
    ?? faturas[0]
    ?? null;

  const itensFatura = useMemo(
    () => (cartao && fatura
      ? doCartao
          .filter((l) => faturaDe(l.dataISO, cartao) === fatura.mes)
          .sort((a, b) => b.dataISO.localeCompare(a.dataISO) || a.descricao.localeCompare(b.descricao, "pt-BR"))
      : []),
    [doCartao, cartao, fatura],
  );
  const categorias = useMemo(() => gastosPorCategoria(itensFatura), [itensFatura]);
  const maiorCategoria = categorias[0]?.total ?? 0;

  // Categorias de despesa, como caminho "Pai / Filho" (o mesmo texto das movimentações).
  const opcoesCategoria = useMemo(
    () => plano.filter((c) => c.tipo === "despesa").map((c) => caminhoConta(c, plano)).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [plano],
  );

  // Categorizar uma compra categoriza também as outras iguais do cartão que
  // ainda estão sem categoria (o mesmo fornecedor se repete todo mês).
  const categorizar = (id: string, descricao: string, valor: string) => {
    const categoria = valor === SEM_CATEGORIA ? "" : valor;
    const k = chaveDescricao(descricao);
    const iguais = categoria
      ? doCartao.filter((l) => l.id !== id && !l.categoria && chaveDescricao(l.descricao) === k).map((l) => l.id)
      : [];
    setCategoria.mutate(
      { ids: [id, ...iguais], categoria },
      {
        onSuccess: () => { if (iguais.length) toast.success(`Categoria aplicada também a ${iguais.length} compra(s) igual(is).`); },
        onError: () => toast.error("Não consegui salvar a categoria."),
      },
    );
  };

  const removerCompra = (id: string, descricao: string) => {
    if (!window.confirm(`Excluir "${descricao}" do extrato do cartão? Use para desfazer uma importação errada.`)) return;
    excluir.mutate(id, { onError: () => toast.error("Não consegui excluir.") });
  };

  // Relatório da fatura aberta: os mesmos números, categorias e compras da
  // tela, mais o histórico de faturas do cartão. No PDF o valor sai em R$; no
  // Excel fica numérico, para somar e filtrar.
  const relatorio = () => {
    if (!cartao || !fatura) return null;
    const nomeCartao = `${cartao.nome}${cartao.final ? ` final ${cartao.final}` : ""}`;
    const compras = itensFatura.filter((i) => i.tipo === "out");
    const vencimento = cartao.diaVencimento
      ? `${pad(cartao.diaVencimento)}/${fatura.mes.slice(5, 7)}/${fatura.mes.slice(0, 4)}`
      : "";
    const linhasCompras = itensFatura.map((i) => [
      fmtBR(i.dataISO),
      i.descricao,
      i.tipo === "in" ? "Pagamento da fatura" : i.categoria || "Sem categoria",
      i.tipo === "in" ? i.valor : -i.valor,
    ] as (string | number)[]);
    const arquivo = `cartao-${chaveDescricao(cartao.nome).replace(/ /g, "-")}-fatura-${fatura.mes}`;
    return { nomeCartao, compras, vencimento, linhasCompras, arquivo };
  };

  const exportarPdf = () => {
    const r = relatorio();
    if (!cartao || !fatura || !r) return;
    const total = fatura.gastos || 1;
    exportToPdf({
      title: `Fatura ${fmtMes(fatura.mes)} · ${r.nomeCartao}`,
      company: empresaNome,
      subtitle: r.vencimento ? `Vencimento em ${r.vencimento}` : "Compras agrupadas pelo mês da fatura",
      kpis: [
        { label: "Gasto na fatura", value: brl(fatura.gastos) },
        { label: "Pagamentos da fatura", value: brl(fatura.creditos) },
        { label: "Compras", value: String(r.compras.length), hint: `${r.compras.filter((i) => !i.categoria).length} sem categoria` },
      ],
      tables: [
        {
          title: "Gastos por categoria",
          columns: ["Categoria", "Valor", "% da fatura"],
          rows: [
            ...categorias.map((c) => [c.categoria || "Sem categoria", brl(c.total), `${((c.total / total) * 100).toFixed(1).replace(".", ",")}%`]),
            ["Total", brl(fatura.gastos), "100,0%"],
          ],
          rowKinds: [...categorias.map(() => undefined), "total"],
        },
        {
          title: "Compras da fatura",
          columns: ["Data", "Descrição", "Categoria", "Valor"],
          rows: [
            ...r.linhasCompras.map((l) => [l[0], l[1], l[2], Number(l[3]) > 0 ? `+ ${brl(Number(l[3]))}` : brl(-Number(l[3]))]),
            ["", "Total gasto na fatura", "", brl(fatura.gastos)],
          ],
          rowKinds: [...r.linhasCompras.map(() => undefined), "total"],
        },
        {
          title: "Histórico de faturas",
          columns: ["Fatura", "Gastos", "Pagamentos", "Lançamentos"],
          rows: faturas.map((f) => [fmtMes(f.mes), brl(f.gastos), brl(f.creditos), String(f.itens)]),
        },
      ],
      filename: `${r.arquivo}.pdf`,
    });
  };

  const exportarXlsx = () => {
    const r = relatorio();
    if (!fatura || !r) return;
    exportToXlsx({
      filename: r.arquivo,
      sheets: [
        { name: "Compras", columns: ["Data", "Descrição", "Categoria", "Valor"], rows: r.linhasCompras },
        { name: "Por categoria", columns: ["Categoria", "Valor"], rows: categorias.map((c) => [c.categoria || "Sem categoria", c.total]) },
        { name: "Faturas", columns: ["Fatura", "Gastos", "Pagamentos", "Lançamentos"], rows: faturas.map((f) => [fmtMes(f.mes), f.gastos, f.creditos, f.itens]) },
      ],
    });
  };

  const abrirNovo = () => { setEditando(null); setDialogo(true); };
  const abrirEdicao = (c: Cartao) => { setEditando(c); setDialogo(true); };

  return (
    <AppShell
      title="Cartões"
      subtitle="O demonstrativo de gastos de cada cartão de crédito, fatura a fatura"
      actions={
        <>
          {fatura && (
            <>
              <Button variant="outline" className="h-9" onClick={exportarXlsx}>
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel
              </Button>
              <Button variant="outline" className="h-9" onClick={exportarPdf}>
                <FileDown className="mr-1.5 h-4 w-4" />PDF
              </Button>
            </>
          )}
          <Button asChild variant="outline" className="h-9">
            <Link to="/financeiro/extratos" search={{ aba: "importar" }}>
              <Upload className="mr-1.5 h-4 w-4" />Importar extrato do cartão
            </Link>
          </Button>
          <Button onClick={abrirNovo} className="h-9 bg-foreground text-background hover:bg-foreground/90">
            <Plus className="mr-1.5 h-4 w-4" />Novo cartão
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando cartões...
        </div>
      ) : !cartao ? (
        <Card className="card-elevated border-border/70 px-6 py-14 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-secondary">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="font-display text-base font-semibold">Nenhum cartão cadastrado</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Cadastre o cartão e importe o extrato dele em Extratos › Importar, escolhendo o cartão como destino.
            As compras aparecem aqui, separadas por fatura e por categoria.
          </p>
          <Button onClick={abrirNovo} className="mt-5 h-9 bg-foreground text-background hover:bg-foreground/90">
            <Plus className="mr-1.5 h-4 w-4" />Cadastrar cartão
          </Button>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Qual cartão */}
          <div role="tablist" aria-label="Cartão" className="flex flex-wrap gap-2">
            {ordenados.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === cartao.id}
                onClick={() => { setCartaoSelId(c.id); setFaturaSel(null); }}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3.5 py-2 text-left text-[13px] transition-colors",
                  c.id === cartao.id ? "border-foreground bg-foreground text-background" : "border-border/70 bg-card hover:bg-secondary/60",
                  !c.ativo && "opacity-60",
                )}>
                <CreditCard className="h-4 w-4 shrink-0" />
                <span className="font-medium">{c.nome}</span>
                {c.final && <span className="opacity-70">•••• {c.final}</span>}
              </button>
            ))}
          </div>

          {/* Cabeçalho do cartão */}
          <Card className={cn("card-elevated border-border/70 p-5", !cartao.ativo && "opacity-70")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold">
                  {cartao.nome}
                  {cartao.final && <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">•••• {cartao.final}</span>}
                  {!cartao.ativo && <Badge variant="outline" className="ml-2 border-0 bg-secondary text-[10px]">inativo</Badge>}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {cartao.diaFechamento ? `Fecha dia ${cartao.diaFechamento}` : "Fechamento não informado — as compras ficam no mês em que foram feitas"}
                  {cartao.diaVencimento ? ` · vence dia ${cartao.diaVencimento}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" title="Editar cartão" onClick={() => abrirEdicao(cartao)} className="h-8 w-8 p-0">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Switch
                  checked={cartao.ativo}
                  aria-label={`Cartão ${cartao.nome} ativo`}
                  onCheckedChange={(v) => desativar.mutate({ id: cartao.id, ativo: v })}
                />
              </div>
            </div>

            {/* Faturas: o gasto de cada uma, da mais recente para a mais antiga */}
            {faturas.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {faturas.map((f) => (
                  <button key={f.mes} onClick={() => setFaturaSel(f.mes)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-center transition-colors",
                      fatura?.mes === f.mes ? "border-primary bg-primary/10" : "border-transparent bg-secondary/50 hover:bg-secondary",
                    )}>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {fmtMes(f.mes)}{f.mes === faturaAtual ? " · atual" : ""}
                    </p>
                    <p className="font-numeric text-[13px] font-semibold tabular-nums">{brl(f.gastos)}</p>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {!fatura ? (
            <Card className="card-elevated border-border/70 px-6 py-12 text-center">
              <p className="font-display text-base font-semibold">Nenhuma compra importada neste cartão</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Em Extratos › Importar, envie o OFX ou a planilha da fatura e escolha <strong>{cartao.nome}</strong> como destino.
                As compras não mexem no saldo — a fatura paga já sai pelo extrato do banco.
              </p>
              <Button asChild className="mt-5 h-9 bg-foreground text-background hover:bg-foreground/90">
                <Link to="/financeiro/extratos" search={{ aba: "importar" }}>
                  <Upload className="mr-1.5 h-4 w-4" />Importar extrato
                </Link>
              </Button>
            </Card>
          ) : (
            <>
              {/* Os números da fatura */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Numero rotulo={`Gasto na fatura de ${fmtMes(fatura.mes)}`} valor={brl(fatura.gastos)}
                  detalhe={cartao.diaVencimento ? `vence em ${pad(cartao.diaVencimento)}/${fatura.mes.slice(5, 7)}/${fatura.mes.slice(0, 4)}` : `${fatura.itens} lançamento(s)`} />
                <Numero rotulo="Pagamentos da fatura" valor={brl(fatura.creditos)} detalhe="valores positivos no extrato do cartão" />
                <Numero rotulo="Compras" valor={String(itensFatura.filter((i) => i.tipo === "out").length)}
                  detalhe={`${itensFatura.filter((i) => !i.categoria && i.tipo === "out").length} sem categoria`} />
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                {/* Em quê */}
                <Card className="card-elevated self-start border-border/70 p-6">
                  <h3 className="font-display text-lg font-semibold">Gastos por categoria</h3>
                  <p className="mb-4 text-sm text-muted-foreground">Fatura de {fmtMes(fatura.mes)} · só compras, sem os pagamentos</p>
                  {categorias.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma compra nesta fatura.</p>
                  ) : (
                    <ul className="space-y-3">
                      {categorias.map((c) => (
                        <li key={c.categoria || SEM_CATEGORIA}>
                          <div className="flex items-baseline justify-between gap-3 text-[13px]">
                            <span className={cn("truncate", !c.categoria && "italic text-muted-foreground")}>{c.categoria || "Sem categoria"}</span>
                            <span className="whitespace-nowrap font-numeric font-semibold tabular-nums">{brl(c.total)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-primary"
                              style={{ width: `${maiorCategoria > 0 ? Math.max(2, (c.total / maiorCategoria) * 100) : 0}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {/* Compra a compra */}
                <Card className="card-elevated overflow-hidden border-border/70">
                  <div className="border-b border-border px-5 py-4">
                    <h3 className="font-display text-lg font-semibold">Compras da fatura</h3>
                    <p className="text-sm text-muted-foreground">Categorize aqui — as compras iguais sem categoria recebem a mesma</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">Data</th>
                          <th className="px-4 py-3 text-left font-medium">Descrição</th>
                          <th className="px-4 py-3 text-left font-medium">Categoria</th>
                          <th className="px-4 py-3 text-right font-medium">Valor</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {itensFatura.map((i) => (
                          <tr key={i.id} className="hover:bg-secondary/30">
                            <td className="whitespace-nowrap px-4 py-2.5 font-numeric tabular-nums text-muted-foreground">{fmtBR(i.dataISO)}</td>
                            <td className="max-w-[200px] truncate px-4 py-2.5 font-medium" title={i.descricao}>{i.descricao}</td>
                            <td className="px-4 py-2">
                              {i.tipo === "in" ? (
                                <Badge variant="outline" className="border-0 bg-success/10 text-[11px] text-success">Pagamento da fatura</Badge>
                              ) : (
                              <Select value={i.categoria || SEM_CATEGORIA} onValueChange={(v) => categorizar(i.id, i.descricao, v)}>
                                <SelectTrigger className={cn("h-8 w-44 text-[12px]", !i.categoria && "text-muted-foreground")}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={SEM_CATEGORIA}>Sem categoria</SelectItem>
                                  {/* Categoria que veio do arquivo mas não está no plano continua visível. */}
                                  {i.categoria && !opcoesCategoria.includes(i.categoria) && (
                                    <SelectItem value={i.categoria}>{i.categoria}</SelectItem>
                                  )}
                                  {opcoesCategoria.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              )}
                            </td>
                            <td className={cn("whitespace-nowrap px-4 py-2.5 text-right font-numeric font-semibold tabular-nums", i.tipo === "in" && "text-success")}>
                              {i.tipo === "in" ? "+ " : ""}{brl(i.valor)}
                            </td>
                            <td className="px-2 py-2.5">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                title="Excluir do extrato do cartão" onClick={() => removerCompra(i.id, i.descricao)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-secondary/30 text-sm font-semibold">
                        <tr>
                          <td className="px-4 py-3" colSpan={3}>Total gasto na fatura</td>
                          <td className="px-4 py-3 text-right font-numeric tabular-nums">{brl(fatura.gastos)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              </div>
            </>
          )}

        </div>
      )}

      <CartaoDialog aberto={dialogo} onFechar={() => setDialogo(false)} cartao={editando} />
    </AppShell>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) {
  return (
    <Card className="card-elevated border-border/70 p-5">
      <p className="text-[13px] font-medium text-muted-foreground">{rotulo}</p>
      <p className="mt-1.5 whitespace-nowrap font-numeric text-[24px] font-semibold tabular-nums">{valor}</p>
      <p className="text-[12px] text-muted-foreground">{detalhe}</p>
    </Card>
  );
}

function CartaoDialog({ aberto, onFechar, cartao }: { aberto: boolean; onFechar: () => void; cartao: Cartao | null }) {
  const salvar = useSaveCartao();
  const [form, setForm] = useState<CartaoInput>(vazio());
  const [erro, setErro] = useState<string | null>(null);
  const [chave, setChave] = useState(false);

  if (aberto !== chave) {
    setChave(aberto);
    if (aberto) {
      setErro(null);
      setForm(cartao ? { ...cartao } : vazio());
    }
  }

  const confirmar = async () => {
    if (!form.nome.trim()) { setErro("Dê um nome ao cartão."); return; }
    setErro(null);
    try {
      await salvar.mutateAsync({ id: cartao?.id, input: form });
      toast.success(cartao ? "Cartão atualizado." : "Cartão cadastrado.");
      onFechar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui salvar.";
      setErro(/cartoes/.test(msg) && /not find|does not exist|schema cache/i.test(msg)
        ? "A tabela de cartões ainda não existe: rode supabase/51_cartoes.sql no SQL Editor."
        : msg);
    }
  };

  const dia = (v: number) => (Number.isFinite(v) && v >= 1 && v <= 31 ? Math.floor(v) : null);

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!salvar.isPending && !v) onFechar(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{cartao ? "Editar cartão" : "Novo cartão"}</DialogTitle>
          <DialogDescription>
            O fechamento decide em que fatura cada compra cai. O final do número faz o extrato OFX achar o cartão sozinho.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-1">
          <div className="col-span-2">
            <Label className="text-xs">Nome</Label>
            <Input value={form.nome} autoFocus placeholder="Ex.: Inter PJ"
              onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">4 últimos dígitos</Label>
            <Input value={form.final} inputMode="numeric" maxLength={4} placeholder="1234"
              onChange={(e) => setForm({ ...form, final: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs">Fecha dia</Label>
              <Input type="number" min={1} max={31} className="w-20"
                value={form.diaFechamento ?? ""}
                onChange={(e) => setForm({ ...form, diaFechamento: dia(e.target.valueAsNumber) })} />
            </div>
            <div>
              <Label className="text-xs">Vence dia</Label>
              <Input type="number" min={1} max={31} className="w-20"
                value={form.diaVencimento ?? ""}
                onChange={(e) => setForm({ ...form, diaVencimento: dia(e.target.valueAsNumber) })} />
            </div>
          </div>
        </div>
        {erro && <p className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvar.isPending} className="bg-foreground text-background hover:bg-foreground/90">
            {salvar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{cartao ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

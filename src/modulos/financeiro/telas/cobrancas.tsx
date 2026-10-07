import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle, Ban, CheckCircle2, FileSpreadsheet, Loader2, RotateCcw, Search, Wallet,
} from "lucide-react";
import { brl, numFromInput } from "@/lib/format";
import { fmtBR, hojeISO } from "@/lib/datas";
import { exportToXlsx } from "@/lib/export";
import { cn } from "@/lib/utils";
import {
  useMarcarCobrancaPaga, useReabrirCobranca, useCancelarCobranca, statusCobranca,
  type Cobranca, type StatusCobranca,
} from "@/lib/queries";
import {
  useDadosCobrancas, FORMAS_PAGAMENTO as FORMAS, type FiltroCobranca,
} from "@/modulos/financeiro/receitas/dados-cobrancas";

// Contas a receber, todas na mesma lista: as mensalidades que o sistema gera
// por cliente e as parcelas das vendas. É a ponta que liga cliente → venda →
// cobrança → Financeiro: enquanto está em aberto, a cobrança é entrada
// PREVISTA; quando o recebimento é registrado, ela sai da projeção e o dinheiro
// aparece pelo extrato.

const ESTILO: Record<StatusCobranca, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-secondary border-0" },
  pago: { label: "Pago", cls: "bg-success/10 text-success border-0" },
  vencido: { label: "Vencido", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  cancelado: { label: "Cancelado", cls: "bg-secondary border-0 text-muted-foreground line-through" },
};

export function Cobrancas() {
  const hoje = hojeISO();
  const reabrir = useReabrirCobranca();
  const cancelar = useCancelarCobranca();

  const [filtro, setFiltro] = useState<FiltroCobranca>("todas");
  const [busca, setBusca] = useState("");
  const [mes, setMes] = useState("");           // "" = todo o período
  const [receber, setReceber] = useState<Cobranca | null>(null);
  const [cancelarAlvo, setCancelarAlvo] = useState<Cobranca | null>(null);

  // As linhas e os totais são do módulo: a tela de celular lê os mesmos,
  // e "vencido" quer dizer a mesma coisa nos dois tamanhos.
  const { cobrancas, linhas, totais, quemCadastrou, carregando: isLoading } =
    useDadosCobrancas(hoje, { filtro, busca, mes });
  const { aReceber, vencido, recebido, qtdVencidas } = totais;

  const exportar = () => {
    exportToXlsx({
      filename: `cobrancas${mes ? `-${mes}` : ""}`,
      sheets: [{
        name: "Cobranças",
        columns: ["Vencimento", "Cliente", "Descrição", "Origem", "Parcela", "Forma", "Valor", "Situação", "Pago em", "Valor pago", "Cadastrado por"],
        rows: linhas.map(({ c, st, cliente, venda }) => [
          fmtBR(c.vencimento), cliente, c.descricao || (venda?.descricao ?? ""),
          c.vendaId ? "Venda" : "Mensalidade",
          c.parcela ? `${c.parcela}/${c.parcelasTotal}` : "",
          FORMAS[c.formaPagamento] ?? c.formaPagamento,
          c.valor, ESTILO[st].label,
          c.pagoEm ? fmtBR(c.pagoEm) : "", c.pagoValor ?? "",
          c.criadoPor ? quemCadastrou.get(c.criadoPor) ?? "" : "",
        ]),
      }],
    });
  };

  const KPIS = [
    { label: "A receber", valor: brl(aReceber), meta: mes ? "no mês filtrado" : "em aberto, no prazo", icon: Wallet, cor: "" },
    { label: "Vencido", valor: brl(vencido), meta: `${qtdVencidas} cobrança(s)`, icon: AlertTriangle, cor: vencido > 0 ? "text-destructive" : "" },
    { label: "Recebido", valor: brl(recebido), meta: "pagamentos registrados", icon: CheckCircle2, cor: "text-success" },
  ];

  return (
    <AppShell
      title="Cobranças"
      subtitle="Contas a receber: mensalidades dos clientes e parcelas das vendas, na mesma lista"
      actions={
        <Button variant="outline" className="h-9" onClick={exportar} disabled={linhas.length === 0}>
          <FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel
        </Button>
      }
    >
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {KPIS.map((k) => (
          <Card key={k.label} className="card-elevated border-border/70 p-5">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                <k.icon className="h-[18px] w-[18px] stroke-[1.6]" />
              </div>
              <span className="text-[13px] text-muted-foreground">{k.label}</span>
            </div>
            <p className={`mt-3 font-numeric text-2xl font-semibold tabular-nums ${k.cor}`}>{k.valor}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{k.meta}</p>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border/70 p-0.5 text-xs">
          {(["todas", "pendente", "vencido", "pago", "cancelado"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cn(
                "h-8 cursor-pointer rounded-md px-2.5 font-medium capitalize transition-colors",
                filtro === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "todas" ? "Todas" : ESTILO[f].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Vencimento em</span>
          <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 w-[150px]" aria-label="Mês do vencimento" />
          {mes && <button onClick={() => setMes("")} className="text-xs text-muted-foreground hover:text-foreground">todo o período</button>}
        </div>
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar cliente ou descrição..." className="h-9 pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando cobranças...
        </div>
      ) : (
        <Card className="card-elevated border-border/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Vencimento</th>
                  <th className="px-5 py-3 text-left font-medium">Cliente</th>
                  <th className="px-5 py-3 text-left font-medium">Origem</th>
                  <th className="px-5 py-3 text-left font-medium">Forma</th>
                  <th className="px-5 py-3 text-right font-medium">Valor</th>
                  <th className="px-5 py-3 text-left font-medium">Recebimento</th>
                  <th className="px-5 py-3 text-left font-medium">Situação</th>
                  <th className="px-5 py-3 text-left font-medium">Cadastrado por</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {linhas.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-14 text-center text-muted-foreground">
                      {cobrancas.length === 0
                        ? "Nenhuma cobrança ainda. Elas nascem da mensalidade do cliente ou de uma venda parcelada."
                        : "Nada com esses filtros."}
                    </td>
                  </tr>
                ) : (
                  linhas.map(({ c, st, cliente, venda }) => (
                    <tr key={c.id} className="group hover:bg-secondary/30">
                      <td className="whitespace-nowrap px-5 py-3 font-medium">{fmtBR(c.vencimento)}</td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{cliente}</div>
                        {c.descricao && <div className="text-xs text-muted-foreground">{c.descricao}</div>}
                      </td>
                      <td className="px-5 py-3">
                        {c.vendaId ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 text-[11px] text-primary">
                              Venda{c.parcela ? ` · ${c.parcela}/${c.parcelasTotal}` : ""}
                            </Badge>
                            {venda && <span className="text-[11px] text-muted-foreground">{venda.descricao || fmtBR(venda.data)}</span>}
                          </div>
                        ) : (
                          <Badge variant="outline" className="border-0 bg-secondary text-[11px]">{c.descricao || "Mensalidade"}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{FORMAS[c.formaPagamento] ?? c.formaPagamento ?? "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-numeric font-semibold tabular-nums">{brl(c.valor)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {c.pagoEm ? (
                          <>
                            {fmtBR(c.pagoEm)}
                            {c.pagoValor != null && c.pagoValor !== c.valor && (
                              <span className="block text-[11px]">{brl(c.pagoValor)} recebido</span>
                            )}
                          </>
                        ) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="outline" className={cn("text-[11px] font-medium", ESTILO[st].cls)}>{ESTILO[st].label}</Badge>
                      </td>
                      <td className="px-5 py-3 text-[12px] text-muted-foreground">
                        {c.criadoPor ? quemCadastrou.get(c.criadoPor) ?? "—" : "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {st === "pago" ? (
                          <Button size="sm" variant="ghost" title="Desfazer o recebimento"
                            onClick={() => reabrir.mutate(c.id)}
                            className="h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        ) : st === "cancelado" ? (
                          <Button size="sm" variant="ghost" title="Reabrir a cobrança"
                            onClick={() => reabrir.mutate(c.id)}
                            className="h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" title="Registrar recebimento"
                              onClick={() => setReceber(c)}
                              className="h-7 w-7 p-0 text-success opacity-0 transition-opacity hover:text-success group-hover:opacity-100">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" title="Cancelar cobrança"
                              onClick={() => setCancelarAlvo(c)}
                              className="h-7 w-7 p-0 text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {linhas.length > 0 && (
                <tfoot className="bg-secondary/30 text-sm font-semibold">
                  <tr>
                    <td className="px-5 py-3" colSpan={4}>{linhas.length} cobrança(s)</td>
                    <td className="px-5 py-3 text-right font-numeric tabular-nums">
                      {brl(linhas.reduce((s, l) => s + l.c.valor, 0))}
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Cobrança em aberto é <strong className="text-foreground">entrada prevista</strong> no fluxo de caixa. Registrar o
        recebimento tira ela da projeção — o saldo continua vindo do extrato.
      </p>

      <ReceberDialog alvo={receber} onFechar={() => setReceber(null)} />

      <AlertDialog open={!!cancelarAlvo} onOpenChange={(v) => !v && setCancelarAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta cobrança?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelarAlvo && `${brl(cancelarAlvo.valor)} com vencimento em ${fmtBR(cancelarAlvo.vencimento)}. `}
              Ela sai dos totais e da projeção de caixa, mas continua na lista como cancelada — e dá para reabrir depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelar.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (cancelarAlvo) cancelar.mutate(cancelarAlvo.id, { onSuccess: () => setCancelarAlvo(null) }); }}
              disabled={cancelar.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {cancelar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Cancelar cobrança
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

// Registrar recebimento: data e valor (pode ser diferente do combinado).
export function ReceberDialog({ alvo, onFechar }: { alvo: Cobranca | null; onFechar: () => void }) {
  const marcar = useMarcarCobrancaPaga();
  const [quando, setQuando] = useState(hojeISO());
  const [valor, setValor] = useState(0);
  const [chave, setChave] = useState<string | null>(null);

  if (alvo && alvo.id !== chave) {
    setChave(alvo.id);
    setQuando(hojeISO());
    setValor(alvo.valor);
  }

  const confirmar = async () => {
    if (!alvo) return;
    try {
      await marcar.mutateAsync({ id: alvo.id, valor, pagoEm: quando });
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui registrar.");
    }
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(v) => { if (!marcar.isPending && !v) onFechar(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <DialogDescription>
            A cobrança deixa de ser entrada prevista. O saldo do caixa continua vindo do extrato.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-1">
          <div>
            <Label className="text-xs">Recebido em</Label>
            <Input type="date" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valor recebido (R$)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal"
              value={Number.isFinite(valor) ? valor : 0}
              onChange={(e) => setValor(numFromInput(e.target.valueAsNumber))} />
          </div>
        </div>
        {/* Receber valor diferente do combinado é comum (desconto, juros,
            tarifa). A diferença aparece antes de confirmar, não depois. */}
        {!!alvo && valor > 0 && Math.abs(valor - alvo.valor) > 0.001 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-secondary px-3 py-2 text-[12px]">
            <span className="text-muted-foreground">Previsto <strong className="text-foreground tabular-nums">{brl(alvo.valor)}</strong></span>
            <span className="text-muted-foreground">Recebido <strong className="text-foreground tabular-nums">{brl(valor)}</strong></span>
            <strong className={cn("ml-auto tabular-nums", valor < alvo.valor ? "text-destructive" : "text-success")}>
              Diferença {valor < alvo.valor ? "−" : "+"}{brl(Math.abs(valor - alvo.valor))}
            </strong>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={marcar.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={marcar.isPending || !quando || !(valor > 0)}
            className="bg-success text-white hover:bg-success/90">
            {marcar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

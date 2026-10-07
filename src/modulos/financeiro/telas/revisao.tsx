import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2, AlertTriangle, Loader2, Sparkles, Check, Trash2, ListChecks, ArrowRight, History,
} from "lucide-react";
import { brl } from "@/lib/format";
import { msgErro } from "@/lib/erros";
import { type Conta } from "@/lib/queries";
import { useRevisao } from "@/modulos/financeiro/extratos/dados-revisao";

// Valor sentinela "só o pai" (Radix Select não aceita value vazio).
const ROOT_ONLY = "__root__";

// Seletor encadeado Pai → Filho, trabalhando com IDs do plano de contas.
function CatSelect({
  contas, value, onChange, disabled,
}: {
  contas: Conta[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const roots = useMemo(() => contas.filter((c) => !c.parentId), [contas]);
  const byId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);

  const conta = value ? byId.get(value) : undefined;
  const parentId = conta ? conta.parentId ?? conta.id : undefined;
  const childId = conta && conta.parentId ? conta.id : null;
  const kids = parentId ? contas.filter((c) => c.parentId === parentId) : [];

  return (
    <div className="flex items-center gap-1.5">
      <Select value={parentId} onValueChange={(v) => onChange(v)} disabled={disabled}>
        <SelectTrigger className="h-8 text-xs w-[150px]">
          <SelectValue placeholder="Categoria..." />
        </SelectTrigger>
        <SelectContent>
          {roots.map((rt) => (
            <SelectItem key={rt.id} value={rt.id}>{rt.nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {parentId && kids.length > 0 && (
        <Select
          value={childId ?? ROOT_ONLY}
          onValueChange={(v) => onChange(v === ROOT_ONLY ? parentId : v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs w-[150px]">
            <SelectValue placeholder="Subcategoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ROOT_ONLY}>— Geral (só o pai)</SelectItem>
            {kids.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

// `lote` vem da URL da tela consolidada (Financeiro › Extratos › Revisar).
export function Revisao({ lote }: { lote?: string } = {}) {
  const navigate = useNavigate();
  // Quem decide a categoria de cada pendência é o módulo: a tela de celular
  // lê o mesmo estado, e assim "pronta para aprovar" quer dizer o mesmo nos dois.
  const {
    pendentes, contas, carregando: isLoading, escolhas: choices, escolher: setChoice,
    comCategoria, semCategoria, comSugestao, semPlano,
    aprovar: aprovarMut, aprovarUma, aprovarTodas,
    excluirUma: deleteMut, excluirTodasMut, excluirTodas: descartarTodas,
    semear: semearMut, sugerir: sugerirMut,
  } = useRevisao(lote);
  const [excluirTodasOpen, setExcluirTodasOpen] = useState(false);

  const excluirTodas = async () => {
    try {
      await descartarTodas();
      setExcluirTodasOpen(false);
    } catch { /* erro exibido no diálogo via isError; mantém aberto p/ tentar de novo */ }
  };

  const subtitle = lote
    ? "Revisando o lote recém-importado — confira as sugestões e aprove"
    : "Transações importadas aguardando aprovação";

  return (
    <AppShell
      title="Revisão de importação"
      subtitle={subtitle}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-9"
            disabled={sugerirMut.isPending || pendentes.length === 0}
            onClick={() => sugerirMut.mutate(lote)}
            title="Aplica as regras já cadastradas nos pendentes que estão sem sugestão"
          >
            {sugerirMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
            Sugerir categorias
          </Button>
          <Button
            variant="outline"
            className="h-9"
            disabled={semearMut.isPending}
            onClick={() => semearMut.mutate()}
            title="Cria regras a partir das transações já confirmadas e re-sugere os pendentes"
          >
            {semearMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <History className="h-4 w-4 mr-1.5" />}
            Aprender do histórico
          </Button>
          {lote && (
            <Button variant="outline" className="h-9" onClick={() => navigate({ to: "/financeiro/extratos", search: { aba: "revisar" } })}>
              Ver todas as pendências
            </Button>
          )}
        </div>
      }
    >
      {semPlano && (
        <Card className="p-4 card-elevated border-warning/40 bg-warning/5 mb-5">
          <div className="flex items-center gap-2 text-sm text-warning-foreground">
            <AlertTriangle className="h-4 w-4" />
            Seu plano de contas está vazio. Cadastre as categorias em{" "}
            <Link to="/financeiro/plano-de-contas" className="font-medium underline">Plano de Contas</Link>{" "}
            para conseguir aprovar.
          </div>
        </Card>
      )}

      {sugerirMut.isSuccess && (
        <Card className="p-4 card-elevated border-primary/30 bg-primary/5 mb-5">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            {sugerirMut.data > 0
              ? <><strong className="mx-1">{sugerirMut.data}</strong> pendente(s) ganharam sugestão pelas regras cadastradas.</>
              : "Nenhuma regra cadastrada bateu com as descrições pendentes — cadastre regras em Ajustes ou use “Aprender do histórico”."}
          </div>
        </Card>
      )}
      {sugerirMut.isError && (
        <Card className="p-4 card-elevated border-destructive/30 bg-destructive/5 mb-5">
          <div className="flex items-start gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p>Não consegui aplicar as regras. As transações continuam aqui — dá para categorizar à mão.</p>
              <p className="text-xs font-mono break-words mt-1 opacity-80">
                {detalheErro(sugerirMut.error)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {semearMut.isSuccess && (
        <Card className="p-4 card-elevated border-primary/30 bg-primary/5 mb-5">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Aprendi <strong className="mx-1">{semearMut.data.regras}</strong> regra(s) do histórico —{" "}
            <strong className="mx-1">{semearMut.data.sugeridas}</strong> pendente(s) ganharam sugestão.
          </div>
        </Card>
      )}
      {semearMut.isError && (
        <Card className="p-4 card-elevated border-destructive/30 bg-destructive/5 mb-5">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" />
            {semearMut.error instanceof Error ? semearMut.error.message : "Erro ao aprender do histórico."}
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card className="card-elevated border-border/70 p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando pendências...
        </Card>
      ) : pendentes.length === 0 ? (
        <Card className="card-elevated border-border/70 p-10 text-center">
          <div className="mx-auto h-11 w-11 rounded-xl bg-success/10 grid place-items-center mb-3">
            <CheckCircle2 className="h-5 w-5 text-success" />
          </div>
          <p className="font-display font-semibold text-base">Nenhuma transação pendente</p>
          <p className="text-sm text-muted-foreground mt-1">Tudo revisado. Importe um extrato para começar um novo lote.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild variant="outline" className="h-9">
              <Link to="/financeiro/extratos" search={{ aba: "importar" }}>Importar extrato</Link>
            </Button>
            <Button asChild className="h-9 bg-foreground text-background hover:bg-foreground/90">
              <Link to="/financeiro/caixa" search={{ aba: "movimentacoes" }}>Ver movimentações <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Pendentes</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{pendentes.length}</p>
            </Card>
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Com sugestão</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-primary">{comSugestao}</p>
            </Card>
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Prontas p/ aprovar</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-success">{comCategoria.length}</p>
            </Card>
            <Card className="p-5 card-elevated border-border/70">
              <p className="text-[12px] text-muted-foreground">Sem categoria</p>
              <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-warning-foreground">{semCategoria}</p>
            </Card>
          </div>

          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Aprovar grava a categoria e ensina o sistema. Sem aprovar, nada conta nos relatórios.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-9 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                disabled={aprovarMut.isPending || excluirTodasMut.isPending}
                onClick={() => setExcluirTodasOpen(true)}
                title={lote ? "Descarta as pendências deste lote" : "Descarta todas as pendências"}
              >
                {excluirTodasMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                Excluir {lote ? "o lote" : "todas"} ({pendentes.length})
              </Button>
              <Button
                onClick={aprovarTodas}
                disabled={semPlano || comCategoria.length === 0 || aprovarMut.isPending}
                className="h-9 bg-foreground text-background hover:bg-foreground/90"
              >
                {aprovarMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ListChecks className="h-4 w-4 mr-1.5" />}
                Aprovar {comCategoria.length} com categoria
              </Button>
            </div>
          </div>

          {aprovarMut.isError && (
            <Card className="p-4 card-elevated border-destructive/30 bg-destructive/5 mb-4">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                {aprovarMut.error instanceof Error ? aprovarMut.error.message : "Erro ao aprovar."}
              </div>
            </Card>
          )}

          <Card className="card-elevated border-border/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Data</th>
                    <th className="text-left px-4 py-3 font-medium">Descrição</th>
                    <th className="text-right px-4 py-3 font-medium">Valor</th>
                    <th className="text-left px-4 py-3 font-medium">Categoria</th>
                    <th className="text-right px-4 py-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pendentes.map((p) => {
                    const ddMM = `${p.dataISO.slice(8, 10)}/${p.dataISO.slice(5, 7)}`;
                    const temSugestao = !!p.sugeridaId;
                    const escolhida = choices[p.id];
                    const busy = aprovarMut.isPending || deleteMut.isPending;
                    return (
                      <tr key={p.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-2.5 font-numeric tabular-nums whitespace-nowrap">{ddMM}</td>
                        <td className="px-4 py-2.5 max-w-[280px] truncate">
                          <div className="flex items-center gap-2">
                            <span className="truncate">{p.descricao}</span>
                            {temSugestao && (
                              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 gap-1 shrink-0">
                                <Sparkles className="h-3 w-3" />Sugerida
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-numeric tabular-nums ${p.tipo === "in" ? "text-success" : ""}`}>
                          {p.tipo === "in" ? "+" : "−"}{brl(p.valor)}
                        </td>
                        <td className="px-4 py-2.5">
                          <CatSelect
                            contas={contas}
                            value={escolhida || undefined}
                            onChange={(id) => setChoice(p.id, id)}
                            disabled={semPlano}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              className="h-8 bg-foreground text-background hover:bg-foreground/90"
                              disabled={!escolhida || busy}
                              onClick={() => aprovarUma(p.id)}
                              title="Aprovar esta transação"
                            >
                              <Check className="h-3.5 w-3.5 mr-1" />Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => deleteMut.mutate(p.id)}
                              title="Descartar (não importar)"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Descartar tudo o que está na revisão. Fica fora do bloco acima para o
          diálogo não sumir no meio da própria exclusão (a lista esvazia). */}
      <AlertDialog
        open={excluirTodasOpen}
        onOpenChange={(v) => { if (!excluirTodasMut.isPending) setExcluirTodasOpen(v); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {pendentes.length} transaç{pendentes.length > 1 ? "ões" : "ão"} pendente{pendentes.length > 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lote
                ? "Todas as transações deste lote de importação serão removidas permanentemente."
                : "Todas as transações que estão aguardando revisão serão removidas permanentemente."}{" "}
              Como ainda não foram aprovadas, nada muda no saldo nem nos relatórios — mas, para trazê-las de volta, será preciso importar o extrato de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {excluirTodasMut.isError && (
            <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {excluirTodasMut.error instanceof Error ? excluirTodasMut.error.message : "Erro ao excluir."}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirTodasMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); excluirTodas(); }}
              disabled={excluirTodasMut.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {excluirTodasMut.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Excluir {pendentes.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

// O erro do Supabase é um objeto ({ message, code, details, hint }), não um
// Error: String() dele saía "[object Object]" e escondia o motivo da falha.
function detalheErro(e: unknown): string {
  const extra = (e && typeof e === "object" ? e : {}) as { code?: unknown; details?: unknown; hint?: unknown };
  const partes = [msgErro(e)];
  if (extra.code === "57014") partes.push("o banco demorou demais e cancelou — tente aplicar por lote, ou com menos pendências de uma vez");
  if (typeof extra.details === "string" && extra.details) partes.push(extra.details);
  if (typeof extra.hint === "string" && extra.hint) partes.push(extra.hint);
  return (typeof extra.code === "string" && extra.code ? `[${extra.code}] ` : "") + partes.join(" · ");
}

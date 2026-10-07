// ─── Detalhe de um Pix, no celular ──────────────────────────────────────────
// Tela 02 do desenho: o valor em destaque, os dados do Pix com o botão de
// copiar a chave, as informações do lançamento e o histórico em linha do tempo.
// As ações ficam presas embaixo, ao alcance do polegar.
//
// Ela cobre a tela inteira (inclusive a barra de navegação), como no desenho, e
// quem a abre é o endereço: ?pix=<id> na rota de Pagamentos. É de propósito —
// assim o botão "voltar" do aparelho fecha o detalhe em vez de sair da tela, e
// um link leva direto ao pagamento.
//
// Medidas, cores e raios vêm do arquivo do Figma (Make). O que não veio de lá é
// o TAMANHO DO TEXTO: o desenho usa 8 e 9px numa tela de 360, ilegível no
// aparelho de verdade a um palmo do rosto, então os textos pequenos sobem para
// 11-12px. A hierarquia (o que é maior que o quê) é a mesma.
import { useMemo } from "react";
import {
  ArrowLeft,
  Copy,
  CheckCircle2,
  Pencil,
  Trash2,
  RotateCcw,
  Plus,
  MoreHorizontal,
  Loader2,
} from "lucide-react";
import { brl } from "@/lib/format";
import { fmtBR, fmtDataHora } from "@/lib/datas";
import { formatarChavePix, labelTipoChave } from "@/lib/pix";
import {
  useHistoricoPagamentosDiarios,
  type PagamentoDiario,
  type HistoricoPagamentoDiario,
  type AutorPagamento,
} from "@/lib/queries";
import { LABEL_CAMPO, valorCampo } from "@/modulos/financeiro/telas/pagamentos-diarios";

type Situacao = "pendente" | "pago" | "estornado";
const situacaoDe = (p: PagamentoDiario): Situacao =>
  p.estornado ? "estornado" : p.pago ? "pago" : "pendente";

const ICONE_ACAO = {
  criado: Plus,
  alterado: Pencil,
  pago: CheckCircle2,
  estornado: RotateCcw,
  excluido: Trash2,
} as const;

const TITULO_ACAO: Record<string, string> = {
  criado: "Lançado",
  alterado: "Alterado",
  pago: "Pago",
  estornado: "Estornado",
  excluido: "Excluído",
};

export function DetalheDoPix({
  p,
  isMaster,
  autor,
  fechar,
  onCopiar,
  onPagar,
  onEstornar,
  onMaisAcoes,
  pagando,
}: {
  p: PagamentoDiario;
  isMaster: boolean;
  autor?: AutorPagamento;
  fechar: () => void;
  onCopiar: () => void;
  onPagar: () => void;
  onEstornar: () => void;
  onMaisAcoes: () => void;
  pagando: boolean;
}) {
  const situacao = situacaoDe(p);
  const { data: historico = [] } = useHistoricoPagamentosDiarios(p.data.slice(0, 7));
  const linhas = useMemo(
    () =>
      historico
        .filter((h) => h.pagamentoId === p.id)
        .sort((a, b) => a.ocorridoEm.localeCompare(b.ocorridoEm)),
    [historico, p.id],
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex h-[68px] shrink-0 items-center gap-1 border-b border-border/70 px-3">
        <button
          type="button"
          onClick={fechar}
          aria-label="Voltar"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold leading-tight">Detalhes</p>
          <p className="truncate text-[11px] text-muted-foreground">{fmtBR(p.data)}</p>
        </div>
        <button
          type="button"
          onClick={onMaisAcoes}
          aria-label="Mais ações"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24">
        {/* ── Valor ── */}
        <div className="flex flex-col items-center py-5">
          <Pastilha situacao={situacao} />
          <p className="mt-2.5 text-[30px] font-bold leading-none tracking-tight">{brl(p.valor)}</p>
          <p className="mt-1.5 text-[12px] text-muted-foreground">{p.titular}</p>
        </div>

        {/* ── Dados do Pix ── */}
        <section className="mb-2.5 rounded-xl border border-border/70 bg-card p-3.5">
          <h2 className="mb-3 text-[14px] font-bold">Dados do Pix</h2>
          <Linha rotulo="Titular" valor={p.titular} />
          <div className="flex min-h-[28px] items-center justify-between gap-3 border-b border-border/70 py-1">
            <span className="text-[12px] text-muted-foreground">Tipo de chave</span>
            <span className="rounded-md bg-[var(--primary-tint)] px-1.5 py-0.5 text-[10px] font-bold text-primary">
              {labelTipoChave(p.tipoChave)}
            </span>
          </div>
          <div className="flex flex-col pt-2.5">
            <span className="text-[11px] text-muted-foreground">Chave Pix</span>
            <b className="mt-1 break-all text-[12px] font-semibold">
              {formatarChavePix(p.chavePix, p.tipoChave)}
            </b>
            <button
              type="button"
              onClick={onCopiar}
              className="mt-2.5 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[10px] border border-primary text-[12.5px] font-bold text-primary"
            >
              <Copy className="h-4 w-4" /> Copiar chave
            </button>
          </div>
        </section>

        {/* ── Informações ── */}
        <section className="mb-2.5 rounded-xl border border-border/70 bg-card p-3.5">
          <h2 className="mb-3 text-[14px] font-bold">Informações</h2>
          <Linha rotulo="Competência" valor={fmtBR(p.data)} />
          {p.descricao && <Linha rotulo="Descrição" valor={p.descricao} />}
          <Linha
            rotulo="Lançado por"
            valor={
              autor
                ? `${autor.email.split("@")[0]}, ${fmtDataHora(autor.em)}`
                : fmtDataHora(p.criadoEm)
            }
          />
          {p.pago && p.pagoEm && <Linha rotulo="Pago em" valor={fmtDataHora(p.pagoEm)} />}
          {p.estornado && (
            <>
              {p.estornadoEm && <Linha rotulo="Estornado em" valor={fmtDataHora(p.estornadoEm)} />}
              {p.estornoMotivo && <Linha rotulo="Motivo do estorno" valor={p.estornoMotivo} />}
            </>
          )}
        </section>

        {/* ── Histórico ── */}
        <section className="rounded-xl border border-border/70 bg-card p-3.5">
          <h2 className="mb-3 text-[14px] font-bold">Histórico</h2>
          {linhas.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Sem registro no histórico deste mês. Ele começou a ser gravado na migração 39.
            </p>
          ) : (
            linhas.map((h, i) => (
              <ItemDaLinhaDoTempo key={h.id} h={h} ultimo={i === linhas.length - 1} />
            ))
          )}
        </section>
      </div>

      {/* ── Ações presas embaixo ── */}
      <div
        className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-background px-3 pb-3.5 pt-2.5"
        style={{ paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={onMaisAcoes}
          aria-label="Mais ações"
          className="grid h-10 w-11 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)] text-primary"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {situacao === "pendente" ? (
          <button
            type="button"
            onClick={onPagar}
            disabled={pagando}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-primary text-[12.5px] font-bold text-[var(--primary-ink)] disabled:opacity-60"
          >
            {pagando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Marcar como pago
          </button>
        ) : situacao === "pago" && isMaster ? (
          <button
            type="button"
            onClick={onEstornar}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-destructive text-[12.5px] font-bold text-destructive"
          >
            <RotateCcw className="h-4 w-4" /> Estornar
          </button>
        ) : (
          <button
            type="button"
            onClick={fechar}
            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-[10px] bg-secondary text-[12.5px] font-bold"
          >
            Voltar para a lista
          </button>
        )}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex min-h-[28px] items-center justify-between gap-3 border-b border-border/70 py-1 last:border-0">
      <span className="shrink-0 text-[12px] text-muted-foreground">{rotulo}</span>
      <b className="min-w-0 truncate text-right text-[12px] font-semibold">{valor}</b>
    </div>
  );
}

function Pastilha({ situacao }: { situacao: Situacao }) {
  const cor =
    situacao === "pendente"
      ? "bg-warning/15 text-warning-ink"
      : situacao === "pago"
        ? "bg-success/10 text-success"
        : "bg-destructive/10 text-destructive";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-[11px] font-bold ${cor}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {situacao === "pendente" ? "Pendente" : situacao === "pago" ? "Pago" : "Estornado"}
    </span>
  );
}

function ItemDaLinhaDoTempo({ h, ultimo }: { h: HistoricoPagamentoDiario; ultimo: boolean }) {
  const Icone = ICONE_ACAO[h.acao] ?? Pencil;
  // O que mudou, quando a ação foi "alterado": mesmos rótulos e formatação da
  // tela de computador, para o histórico não contar duas versões da história.
  const mudancas = (h.campos ?? [])
    .filter((c) => LABEL_CAMPO[c])
    .map((c) => {
      const antes = valorCampo(c, h.dadosAntes?.[c]);
      const depois = valorCampo(c, h.dadosDepois?.[c]);
      return `${LABEL_CAMPO[c]}: ${antes} → ${depois}`;
    });

  return (
    <div className="flex min-h-[50px] gap-2.5">
      <div className="flex w-6 flex-col items-center">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--primary-tint)] text-primary">
          <Icone className="h-3 w-3" />
        </span>
        {!ultimo && <i className="w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-3">
        <b className="text-[12px] font-semibold">
          {TITULO_ACAO[h.acao] ?? h.acao}
          {h.autorEmail ? ` por ${h.autorEmail.split("@")[0]}` : ""}
        </b>
        <small className="mt-0.5 block text-[11px] text-muted-foreground">
          {fmtDataHora(h.ocorridoEm)}
        </small>
        {mudancas.length > 0 && (
          <em className="mt-1.5 block rounded-md bg-secondary px-2 py-1.5 text-[11px] not-italic">
            {mudancas.join(" · ")}
          </em>
        )}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { supabase, isMock } from "@/lib/supabase";
import { mockApiUsuarios, mockApiInterSync } from "@/lib/mock";
import { useEmpresa } from "@/lib/empresa";
import { getEmpresaId } from "@/lib/empresa-ref";
import { getContaIdOrNull } from "@/lib/conta-bancaria-ref";
import { ddMM, diaUtilAnterior, isoDiaDoMes, nthDiaUtil, hojeISO, compAtual, dataCompetencia, type CompetenciaModo } from "@/lib/datas";
import { resolverFlags, paresRenomeacao } from "@/lib/categorias";
import { regraDatasMudou } from "@/lib/recorrentes";
import { norm, type ClienteStatus } from "@/lib/format";
import { normalizarChavePix, type TipoChavePix } from "@/lib/pix";
import type { Papel } from "@/lib/permissoes";
import { lerMapa, type Funcionalidade, type MapaFuncionalidades } from "@/lib/funcionalidades";
import type { CompromissoRH } from "@/lib/lancamentos";
import { ehFonteRH, porCompetencia, valorDaFonte, type FonteRH, type TotaisRH } from "@/lib/fontes-rh";
import { paginarTudo } from "@/lib/paginacao";
import { urlApi, SEM_API_NO_APP } from "@/lib/nativo";

// ─── Clientes ───────────────────────────────────────────────
// Mantém o mesmo formato usado pelas telas (campo `mens`) para
// trocar o mock pelo banco sem reescrever os componentes.
export type Cliente = {
  id: string;
  nome: string;
  status: ClienteStatus;       // legado; o status real do mês vem das cobranças
  mens: number;
  ticket: number;
  atraso: number;
  ativo: boolean;
  diaVencimento: number;       // 1..28
  clienteDesde: string | null; // YYYY-MM-DD (início da cobrança)
  chaveOfx: string;            // palavra-chave p/ casar no OFX ("" = usa o nome)
  criadoEm: string;            // ISO
};

export async function fetchClientes(): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome, status, mensalidade, ticket, atraso, ativo, dia_vencimento, cliente_desde, chave_ofx, criado_em")
    .eq("empresa_id", getEmpresaId())
    .order("nome", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    status: c.status as ClienteStatus,
    mens: Number(c.mensalidade),
    ticket: Number(c.ticket),
    atraso: c.atraso,
    ativo: c.ativo ?? true,
    diaVencimento: c.dia_vencimento ?? 5,
    clienteDesde: c.cliente_desde ?? null,
    chaveOfx: c.chave_ofx ?? "",
    criadoEm: c.criado_em,
  }));
}

export function useClientes() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["clientes", empresaId], queryFn: fetchClientes, enabled: !!empresaId });
}

// Dados de entrada do formulário (sem id) — mapeados para as colunas do banco.
export type ClienteInput = {
  nome: string;
  mens: number;
  ticket: number;
  ativo: boolean;
  diaVencimento: number;
  clienteDesde: string; // "YYYY-MM" (do <input type=month>) ou ""
  chaveOfx: string;
};

const diaValido = (d: number) => Math.min(28, Math.max(1, Math.round(d || 5)));

const toClienteRow = (i: ClienteInput) => ({
  nome: i.nome,
  status: i.ativo ? "Pago" : "Inativo", // legado (só p/ satisfazer o check); status real vem de cobranças
  mensalidade: i.mens,
  ticket: i.ticket,
  atraso: 0,
  ativo: i.ativo,
  dia_vencimento: diaValido(i.diaVencimento),
  cliente_desde: i.clienteDesde ? `${i.clienteDesde.slice(0, 7)}-01` : null,
  chave_ofx: i.chaveOfx.trim() || null,
});

export function useSaveCliente() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    // id presente = update; ausente = insert.
    // porTabela = a migração 52 está no banco: as mensalidades vivem em
    // cliente_mensalidades e clientes.mensalidade é a soma mantida pelo banco
    // — por isso a edição do cliente não grava mais valor nem dia.
    mutationFn: async ({ id, input, porTabela = false }: { id?: string; input: ClienteInput; porTabela?: boolean }) => {
      const row = toClienteRow(input);
      if (id) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { mensalidade: _m, dia_vencimento: _d, ...semMensalidade } = row;
        const { error } = await supabase.from("clientes").update(porTabela ? semMensalidade : row).eq("id", id);
        if (error) throw error;
        return;
      }
      const { data, error } = await supabase.from("clientes")
        .insert({ ...row, empresa_id: getEmpresaId() }).select("id").single();
      if (error) throw error;
      // Cliente novo: o valor digitado no cadastro vira a 1ª mensalidade.
      if (porTabela && input.mens > 0 && data?.id) {
        const { error: e2 } = await supabase.from("cliente_mensalidades").insert({
          empresa_id: getEmpresaId(), cliente_id: data.id, descricao: "Mensalidade", valor: input.mens,
          dia_vencimento: diaValido(input.diaVencimento),
          inicio: row.cliente_desde ?? compAtual(),
        });
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["mensalidades"] });
    },
  });
}

// ─── Mensalidades do cliente (migração 52) ──────────────────
// Um cliente pode ter várias (ex.: "Gestão de tráfego" + "Suporte"), cada uma
// com valor e dia próprios e as suas cobranças. Sem a migração no banco a
// tela cai no modo antigo: uma mensalidade só, lida do próprio cliente.
export type Mensalidade = {
  id: string;
  clienteId: string;
  descricao: string;
  valor: number;
  diaVencimento: number;
  inicio: string;   // YYYY-MM-DD (1º mês cobrado)
  ativo: boolean;
  criadoEm: string;
};

export function useMensalidades() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["mensalidades", empresaId],
    queryFn: async (): Promise<{ disponivel: boolean; itens: Mensalidade[] }> => {
      const { data, error } = await supabase
        .from("cliente_mensalidades")
        .select("id, cliente_id, descricao, valor, dia_vencimento, inicio, ativo, criado_em")
        .eq("empresa_id", getEmpresaId())
        .order("criado_em", { ascending: true })
        .order("id", { ascending: true });
      if (error && (error.code === "PGRST205" || error.code === "42P01")) return { disponivel: false, itens: [] };
      if (error) throw error;
      return {
        disponivel: true,
        itens: (data ?? []).map((m) => ({
          id: m.id,
          clienteId: m.cliente_id,
          descricao: m.descricao ?? "Mensalidade",
          valor: Number(m.valor),
          diaVencimento: m.dia_vencimento ?? 5,
          inicio: m.inicio,
          ativo: m.ativo ?? true,
          criadoEm: m.criado_em,
        })),
      };
    },
    enabled: !!empresaId,
  });
}

export type MensalidadeInput = {
  clienteId: string;
  descricao: string;
  valor: number;
  diaVencimento: number;
  inicio: string; // YYYY-MM
};

// As cobranças em aberto a partir de um mês são refeitas pela mensalidade:
// mudou valor ou dia, a cobrança deste mês e a do próximo acompanham. As já
// pagas (ou conciliadas no extrato) nunca são tocadas.
async function refazerCobrancasAbertas(mensalidadeId: string, aPartirDe: string) {
  const { error } = await supabase.from("cobrancas").delete()
    .eq("mensalidade_id", mensalidadeId)
    .eq("status", "aberto")
    .is("movimentacao_id", null)
    .gte("competencia", aPartirDe);
  if (error) throw error;
}

const mesSeguinteISO = (comp: string) => {
  const [y, m] = comp.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

export function useSalvarMensalidade() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ id, input }: { id?: string; input: MensalidadeInput }) => {
      const row = {
        descricao: input.descricao.trim() || "Mensalidade",
        valor: Math.round(input.valor * 100) / 100,
        dia_vencimento: diaValido(input.diaVencimento),
        inicio: `${input.inicio.slice(0, 7)}-01`,
      };
      if (!(row.valor > 0)) throw new Error("Informe um valor maior que zero.");
      if (id) {
        const { error } = await supabase.from("cliente_mensalidades").update(row).eq("id", id);
        if (error) throw error;
        await refazerCobrancasAbertas(id, compAtual());
      } else {
        const { error } = await supabase.from("cliente_mensalidades")
          .insert({ ...row, empresa_id: getEmpresaId(), cliente_id: input.clienteId });
        if (error) throw error;
      }
      const { error: eg } = await supabase.rpc("fn_gerar_cobrancas", { p_empresa: getEmpresaId() });
      if (eg) throw new Error(eg.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mensalidades"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
    },
  });
}

// Encerrar não apaga a mensalidade nem o histórico: ela para de gerar
// cobranças. A cobrança do mês corrente continua (o serviço foi prestado); as
// dos meses seguintes, ainda em aberto, saem.
export function useEncerrarMensalidade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cliente_mensalidades").update({ ativo: false }).eq("id", id);
      if (error) throw error;
      await refazerCobrancasAbertas(id, mesSeguinteISO(compAtual()));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mensalidades"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
    },
  });
}

export function useReativarMensalidade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cliente_mensalidades").update({ ativo: true }).eq("id", id);
      if (error) throw error;
      const { error: eg } = await supabase.rpc("fn_gerar_cobrancas", { p_empresa: getEmpresaId() });
      if (eg) throw new Error(eg.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mensalidades"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
    },
  });
}

export function useDeleteCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clientes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
    },
  });
}

// ─── Pagamentos de processos (cadastro simples, por empresa) ─
export type PagamentoProcesso = {
  id: string;
  nome: string;
  valor: number;
  diaPagamento: number;   // dia do mês (1..31)
  parcelaAtual: number;   // parcela atual (ex.: 3 de 12)
  parcelasTotal: number;  // total de parcelas
  chavePix: string;
  ativo: boolean;
  criadoEm: string;
};

export async function fetchPagamentosProcessos(): Promise<PagamentoProcesso[]> {
  const { data, error } = await supabase
    .from("pagamentos_processos")
    .select("id, nome, valor, dia_pagamento, parcela_atual, parcelas_total, chave_pix, ativo, criado_em")
    .eq("empresa_id", getEmpresaId())
    .order("nome", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    nome: p.nome,
    valor: Number(p.valor),
    diaPagamento: p.dia_pagamento ?? 5,
    parcelaAtual: p.parcela_atual ?? 1,
    parcelasTotal: p.parcelas_total ?? 1,
    chavePix: p.chave_pix ?? "",
    ativo: p.ativo ?? true,
    criadoEm: p.criado_em,
  }));
}

export function usePagamentosProcessos() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["pagamentos_processos", empresaId], queryFn: fetchPagamentosProcessos, enabled: !!empresaId });
}

export type PagamentoProcessoInput = {
  nome: string;
  valor: number;
  diaPagamento: number;
  parcelaAtual: number;
  parcelasTotal: number;
  chavePix: string;
  ativo: boolean;
};

const toProcessoRow = (i: PagamentoProcessoInput) => ({
  nome: i.nome,
  valor: i.valor,
  dia_pagamento: Math.min(31, Math.max(1, Math.round(i.diaPagamento || 5))),
  parcela_atual: Math.max(1, Math.round(i.parcelaAtual || 1)),
  parcelas_total: Math.max(1, Math.round(i.parcelasTotal || 1)),
  chave_pix: i.chavePix.trim() || null,
  ativo: i.ativo,
});

export function useSavePagamentoProcesso() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: async ({ id, input }: { id?: string; input: PagamentoProcessoInput }) => {
      if (id) {
        const { error } = await supabase.from("pagamentos_processos").update(toProcessoRow(input)).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pagamentos_processos").insert({ ...toProcessoRow(input), empresa_id: getEmpresaId() });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pagamentos_processos"] }),
  });
}

// ─── Parcelas pagas de um processo (histórico + comprovantes) ─────
// Migração 37. Sem ela, "registrar pagamento" ainda avança a parcela no
// processo; só o histórico/comprovantes ficam indisponíveis (o app avisa).
export type ParcelaProcesso = {
  id: string;
  processoId: string;
  numero: number;
  pagoEm: string; // YYYY-MM-DD
  valor: number;
  comprovantePath: string | null;
  comprovanteNome: string | null;
};

const BUCKET_COMPROVANTES = "comprovantes";
export const AVISO_MIGRACAO_37 =
  "Histórico de parcelas e comprovantes precisam da migração supabase/37_processos_parcelas.sql (SQL Editor).";

// Tabela/bucket ainda não criados → orienta em vez de estourar jargão.
const faltaMigracao37 = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /pagamentos_processos_parcelas|Bucket not found/i.test(e.message ?? ""));

export async function fetchParcelasProcesso(processoId: string): Promise<ParcelaProcesso[]> {
  const { data, error } = await supabase
    .from("pagamentos_processos_parcelas")
    .select("id, processo_id, numero, pago_em, valor, comprovante_path, comprovante_nome")
    .eq("empresa_id", getEmpresaId())
    .eq("processo_id", processoId)
    .order("numero", { ascending: false });
  if (error) throw faltaMigracao37(error) ? new Error(AVISO_MIGRACAO_37) : error;
  return (data ?? []).map((r) => ({
    id: r.id,
    processoId: r.processo_id,
    numero: r.numero,
    pagoEm: r.pago_em,
    valor: Number(r.valor),
    comprovantePath: r.comprovante_path ?? null,
    comprovanteNome: r.comprovante_nome ?? null,
  }));
}

export function useParcelasProcesso(processoId: string | null) {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["parcelas_processo", empresaId, processoId],
    queryFn: () => fetchParcelasProcesso(processoId!),
    enabled: !!empresaId && !!processoId,
    retry: false, // erro de migração ausente não melhora tentando de novo
  });
}

// Sobe o arquivo para <empresa>/processos/<processo>/<numero>-<ts>-<nome>.
async function uploadComprovante(processoId: string, numero: number, file: File): Promise<{ path: string; nome: string }> {
  const seguro = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${getEmpresaId()}/processos/${processoId}/${numero}-${Date.now()}-${seguro}`;
  const { error } = await supabase.storage
    .from(BUCKET_COMPROVANTES)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) {
    if (faltaMigracao37(error)) throw new Error(AVISO_MIGRACAO_37);
    throw new Error(`Não consegui enviar o comprovante: ${error.message}`);
  }
  return { path, nome: file.name };
}

// URL temporária (1h) para abrir um comprovante do bucket privado.
export async function urlComprovante(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_COMPROVANTES).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw new Error(`Não consegui abrir o comprovante: ${error?.message ?? "sem URL"}`);
  return data.signedUrl;
}

// Registra o pagamento da parcela atual: avança o processo (encerra na
// última) e grava a parcela no histórico, com comprovante se houver. O
// avanço é a parte essencial e vem PRIMEIRO; o histórico é extra — se a
// migração 37 não rodou, avisa mas não desfaz o pagamento.
export function useRegistrarPagamentoProcesso() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: async (
      { processo, pagoEm, valor, arquivo }: { processo: PagamentoProcesso; pagoEm: string; valor: number; arquivo?: File | null }
    ): Promise<{ numero: number; encerrado: boolean; historicoIndisponivel: boolean }> => {
      const eid = getEmpresaId();
      const numero = processo.parcelaAtual;
      const encerrado = numero >= processo.parcelasTotal;

      const { error } = await supabase
        .from("pagamentos_processos")
        .update(encerrado ? { ativo: false, parcela_atual: processo.parcelasTotal } : { parcela_atual: numero + 1 })
        .eq("id", processo.id)
        .eq("empresa_id", eid);
      if (error) throw error;

      let historicoIndisponivel = false;
      try {
        let comprovante: { path: string; nome: string } | null = null;
        if (arquivo) comprovante = await uploadComprovante(processo.id, numero, arquivo);
        const { error: e2 } = await supabase.from("pagamentos_processos_parcelas").insert({
          empresa_id: eid,
          processo_id: processo.id,
          numero,
          pago_em: pagoEm,
          valor: Math.abs(valor),
          comprovante_path: comprovante?.path ?? null,
          comprovante_nome: comprovante?.nome ?? null,
        });
        if (e2) throw e2;
      } catch (e) {
        if (faltaMigracao37(e as { code?: string; message?: string }) || (e instanceof Error && e.message === AVISO_MIGRACAO_37)) {
          historicoIndisponivel = true;
        } else {
          throw e;
        }
      }
      return { numero, encerrado, historicoIndisponivel };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagamentos_processos"] });
      qc.invalidateQueries({ queryKey: ["parcelas_processo"] });
    },
  });
}

// Anexa (ou troca) o comprovante de uma parcela já registrada.
export function useAnexarComprovante() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ parcela, arquivo }: { parcela: ParcelaProcesso; arquivo: File }) => {
      const novo = await uploadComprovante(parcela.processoId, parcela.numero, arquivo);
      const { error } = await supabase
        .from("pagamentos_processos_parcelas")
        .update({ comprovante_path: novo.path, comprovante_nome: novo.nome })
        .eq("id", parcela.id)
        .eq("empresa_id", getEmpresaId());
      if (error) throw error;
      // Trocou: o arquivo antigo não é mais referenciado — remove (best-effort).
      if (parcela.comprovantePath) await supabase.storage.from(BUCKET_COMPROVANTES).remove([parcela.comprovantePath]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parcelas_processo"] }),
  });
}

export function useRemoverComprovante() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async (parcela: ParcelaProcesso) => {
      if (parcela.comprovantePath) {
        const { error } = await supabase.storage.from(BUCKET_COMPROVANTES).remove([parcela.comprovantePath]);
        if (error) throw new Error(`Não consegui apagar o arquivo: ${error.message}`);
      }
      const { error } = await supabase
        .from("pagamentos_processos_parcelas")
        .update({ comprovante_path: null, comprovante_nome: null })
        .eq("id", parcela.id)
        .eq("empresa_id", getEmpresaId());
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parcelas_processo"] }),
  });
}

// ─── Vendas (controle à parte — NÃO mexe no saldo das contas) ────
// Migração 38. Registro simples: data, cliente, vendedor, forma de
// pagamento, bruto e líquido. O dinheiro entra no caixa pelo extrato.
export type Venda = {
  id: string;
  data: string;           // YYYY-MM-DD
  clienteId: string | null; // cliente do cadastro (migração 50)
  cliente: string;          // nome digitado — só nas vendas antigas
  descricao: string;        // o que foi vendido
  vendedor: string;
  formaPagamento: string; // pix | dinheiro | credito | debito | boleto | transferencia | outro
  valorBruto: number;
  valorLiquido: number;
  observacao: string;
  criadoEm: string;
};
export type VendaInput = Omit<Venda, "id" | "criadoEm">;

export async function fetchVendas(): Promise<Venda[]> {
  const eid = getEmpresaId();
  const data = await paginarTudo((de, ate) =>
    supabase
      .from("vendas")
      .select("id, data, cliente_id, cliente, descricao, vendedor, forma_pagamento, valor_bruto, valor_liquido, observacao, criado_em, criado_por")
      .eq("empresa_id", eid)
      .order("data", { ascending: false })
      .order("id", { ascending: false })
      .range(de, ate)
  );
  return data.map((v) => ({
    id: v.id,
    data: v.data,
    clienteId: v.cliente_id ?? null,
    cliente: v.cliente ?? "",
    descricao: v.descricao ?? "",
    vendedor: v.vendedor ?? "",
    formaPagamento: v.forma_pagamento ?? "outro",
    valorBruto: Number(v.valor_bruto),
    valorLiquido: Number(v.valor_liquido),
    observacao: v.observacao ?? "",
    criadoEm: v.criado_em,
  }));
}

export function useVendas() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["vendas", empresaId], queryFn: fetchVendas, enabled: !!empresaId });
}

const toVendaRow = (i: VendaInput) => ({
  data: i.data,
  cliente_id: i.clienteId,
  cliente: i.cliente.trim(),
  descricao: i.descricao.trim() || null,
  vendedor: i.vendedor.trim(),
  forma_pagamento: i.formaPagamento,
  valor_bruto: Math.abs(i.valorBruto),
  valor_liquido: Math.abs(i.valorLiquido),
  observacao: i.observacao.trim() || null,
});

export function useSaveVenda() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    // Devolve o id: quem acabou de criar a venda precisa dele para gerar as
    // parcelas na mesma ação, sem uma segunda busca.
    mutationFn: async ({ id, input }: { id?: string; input: VendaInput }): Promise<{ id: string }> => {
      if (id) {
        const { error } = await supabase.from("vendas").update(toVendaRow(input)).eq("id", id).eq("empresa_id", getEmpresaId());
        if (error) throw error;
        return { id };
      }
      const { data, error } = await supabase
        .from("vendas")
        .insert({ ...toVendaRow(input), empresa_id: getEmpresaId() })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendas"] }),
  });
}

export function useDeleteVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vendas").delete().eq("id", id).eq("empresa_id", getEmpresaId());
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendas"] }),
  });
}

// ─── Pagamentos diários (lista de Pix do dia) ───────────────
// Migração 39. Controle à parte, como as vendas: NÃO mexe no saldo nem gera
// movimentação. O que o banco garante e a tela só reflete: pagamento PAGO
// não é excluído nem alterado, e tudo que muda cai no histórico do mês.
export type AcaoHistoricoPagamento = "criado" | "alterado" | "pago" | "estornado" | "excluido";

export type PagamentoDiario = {
  id: string;
  data: string;              // YYYY-MM-DD
  titular: string;           // nome do titular recebedor
  chavePix: string;          // já normalizada (ver lib/pix)
  tipoChave: TipoChavePix;
  valor: number;
  descricao: string;
  pago: boolean;
  pagoEm: string | null;     // ISO — carimbado pelo banco
  estornado: boolean;
  estornadoEm: string | null;
  estornoMotivo: string;
  criadoEm: string;
};
export type PagamentoDiarioInput = Pick<
  PagamentoDiario, "data" | "titular" | "chavePix" | "tipoChave" | "valor" | "descricao"
>;

export type HistoricoPagamentoDiario = {
  id: string;
  pagamentoId: string;
  competencia: string;       // 'YYYY-MM' da data do pagamento
  acao: AcaoHistoricoPagamento;
  campos: string[];          // colunas que mudaram (ação 'alterado')
  dadosAntes: Record<string, unknown> | null;
  dadosDepois: Record<string, unknown> | null;
  titular: string;
  chavePix: string;
  valor: number;
  autorEmail: string;
  ocorridoEm: string;
};

export async function fetchPagamentosDiarios(): Promise<PagamentoDiario[]> {
  // A lista de colunas fica literal (e não numa const concatenada): é dela que
  // o supabase-js tira os tipos de cada campo da resposta.
  const eid = getEmpresaId();
  const data = await paginarTudo((de, ate) =>
    supabase
      .from("pagamentos_diarios")
      .select("id, data, titular, chave_pix, tipo_chave, valor, descricao, pago, pago_em, estornado, estornado_em, estorno_motivo, criado_em")
      .eq("empresa_id", eid)
      .order("data", { ascending: false })
      .order("id", { ascending: false })
      .range(de, ate)
  );
  return data.map((p) => ({
    id: p.id,
    data: p.data,
    titular: p.titular ?? "",
    chavePix: p.chave_pix ?? "",
    tipoChave: (p.tipo_chave ?? "outro") as TipoChavePix,
    valor: Number(p.valor),
    descricao: p.descricao ?? "",
    pago: !!p.pago,
    pagoEm: p.pago_em ?? null,
    estornado: !!p.estornado,
    estornadoEm: p.estornado_em ?? null,
    estornoMotivo: p.estorno_motivo ?? "",
    criadoEm: p.criado_em,
  }));
}

export function usePagamentosDiarios() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["pagamentos-diarios", empresaId], queryFn: fetchPagamentosDiarios, enabled: !!empresaId });
}

const toPagDiarioRow = (i: PagamentoDiarioInput) => ({
  data: i.data,
  titular: i.titular.trim(),
  // Normaliza aqui também (e não só no diálogo): a mesma chave colada com ou
  // sem máscara tem que gravar igual, venha de onde vier.
  chave_pix: normalizarChavePix(i.chavePix, i.tipoChave),
  tipo_chave: i.tipoChave,
  valor: Math.abs(i.valor),
  descricao: i.descricao.trim() || null,
});

export function useSavePagamentoDiario() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: async ({ id, input }: { id?: string; input: PagamentoDiarioInput }) => {
      const row = toPagDiarioRow(input);
      if (id) {
        const { error } = await supabase
          .from("pagamentos_diarios").update(row).eq("id", id).eq("empresa_id", getEmpresaId());
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("pagamentos_diarios").insert({ ...row, empresa_id: getEmpresaId() });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-historico"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-autores"] });
    },
  });
}

export function useDeletePagamentoDiario() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // a trava do banco explica o motivo no diálogo
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pagamentos_diarios").delete().eq("id", id).eq("empresa_id", getEmpresaId());
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-historico"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-autores"] });
    },
  });
}

// Marca um ou vários como pagos de uma vez. O `pago = false` no filtro evita
// tocar em quem já está pago (que é imutável). Devolve quantos mudaram.
export function useMarcarPagamentosDiarios() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase
        .from("pagamentos_diarios")
        .update({ pago: true })
        .in("id", ids)
        .eq("empresa_id", getEmpresaId())
        .eq("pago", false)
        .select("id");
      if (error) throw error;
      return (data ?? []).length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-historico"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-autores"] });
    },
  });
}

// Estorno: única saída para um pagamento marcado por engano. Só o master, com
// motivo obrigatório — a linha continua na lista, fora dos totais.
export function useEstornarPagamentoDiario() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await supabase.rpc("fn_estornar_pagamento_diario", { p_id: id, p_motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-historico"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-autores"] });
    },
  });
}

// Histórico do mês (competencia 'YYYY-MM'); vazio = últimos registros de todos
// os meses. Só leitura — quem grava é o gatilho do banco.
export async function fetchHistoricoPagamentosDiarios(competencia: string): Promise<HistoricoPagamentoDiario[]> {
  let q = supabase
    .from("pagamentos_diarios_historico")
    .select("id, pagamento_id, competencia, acao, campos, dados_antes, dados_depois, titular, chave_pix, valor, autor_email, ocorrido_em")
    .eq("empresa_id", getEmpresaId())
    .order("ocorrido_em", { ascending: false })
    .limit(500);
  if (competencia) q = q.eq("competencia", competencia);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((h) => ({
    id: h.id,
    pagamentoId: h.pagamento_id,
    competencia: h.competencia,
    acao: h.acao as AcaoHistoricoPagamento,
    campos: h.campos ?? [],
    dadosAntes: (h.dados_antes ?? null) as Record<string, unknown> | null,
    dadosDepois: (h.dados_depois ?? null) as Record<string, unknown> | null,
    titular: h.titular ?? "",
    chavePix: h.chave_pix ?? "",
    valor: Number(h.valor ?? 0),
    autorEmail: h.autor_email ?? "",
    ocorridoEm: h.ocorrido_em,
  }));
}

export function useHistoricoPagamentosDiarios(competencia: string) {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["pagamentos-diarios-historico", empresaId, competencia],
    queryFn: () => fetchHistoricoPagamentosDiarios(competencia),
    enabled: !!empresaId,
  });
}

// Quem lançou cada Pix. A tabela guarda `criado_por` (uuid), mas o e-mail só
// existe no histórico — que já é legível por quem tem a capacidade e é
// append-only (migração 39). Por isso a autoria vem de lá, e não de um join
// com auth.users (que a API não expõe).
export type AutorPagamento = { email: string; em: string };

export async function fetchAutoresPagamentosDiarios(competencia: string): Promise<Record<string, AutorPagamento>> {
  let q = supabase
    .from("pagamentos_diarios_historico")
    .select("pagamento_id, autor_email, ocorrido_em")
    .eq("empresa_id", getEmpresaId())
    .eq("acao", "criado");
  if (competencia) q = q.eq("competencia", competencia);
  const { data, error } = await q;
  if (error) throw error;
  const out: Record<string, AutorPagamento> = {};
  for (const h of (data ?? []) as { pagamento_id: string; autor_email: string | null; ocorrido_em: string }[]) {
    // Uma linha 'criado' por pagamento; se houver mais de uma, a primeira vale.
    if (!out[h.pagamento_id]) out[h.pagamento_id] = { email: h.autor_email ?? "", em: h.ocorrido_em };
  }
  return out;
}

export function useAutoresPagamentosDiarios(competencia: string) {
  const { empresaId, caps } = useEmpresa();
  return useQuery({
    queryKey: ["pagamentos-diarios-autores", empresaId, competencia],
    queryFn: () => fetchAutoresPagamentosDiarios(competencia),
    enabled: !!empresaId && caps.has("pag_diario_gerir"),
  });
}

// Pagamentos diários lançados no RH, vistos pelo Pix do dia SÓ PARA LEITURA
// (migração 43). Mão única: o RH não enxerga a lista de Pix do Financeiro.
export type PagamentoDiarioRH = {
  id: string;
  data: string;          // YYYY-MM-DD
  pessoa: string;
  chavePix: string;      // como o RH digitou
  forma: string;         // Pix, Dinheiro, Transferência…
  valor: number;
  descricao: string;
  pago: boolean;         // situação no RH
};

export async function fetchPagamentosDiariosRH(de: string, ate: string): Promise<{ disponivel: boolean; itens: PagamentoDiarioRH[] }> {
  const { data, error } = await supabase.rpc("fn_rh_pagamentos_para_pix", {
    p_empresa: getEmpresaId(), p_de: de, p_ate: ate,
  });
  // Função ainda não criada no banco (migração 43): a seção simplesmente não aparece.
  if (error?.code === "PGRST202") return { disponivel: false, itens: [] };
  if (error) throw error;
  const linhas = (data ?? []) as {
    id: string; data: string; pessoa: string | null; chave_pix: string | null; forma: string | null;
    valor: number | string | null; descricao: string | null; pago: boolean | null;
  }[];
  return {
    disponivel: true,
    itens: linhas.map((r) => ({
      id: r.id,
      data: r.data,
      pessoa: r.pessoa ?? "",
      chavePix: r.chave_pix ?? "",
      forma: r.forma || "Pix",
      valor: Number(r.valor ?? 0),
      descricao: r.descricao ?? "",
      pago: !!r.pago,
    })),
  };
}

// ─── Compromissos do RH vistos pelo Financeiro (migração 48) ────────────────
// Adiantamento, salário e pagamento diário do RH, já no vocabulário do caixa
// (data, valor, projetado/realizado). Leitura pura: nada é copiado para o
// Financeiro — quando o RH atualiza o valor real, é esse valor que aparece.
export async function fetchCompromissosRH(de: string, ate: string): Promise<{ disponivel: boolean; itens: CompromissoRH[] }> {
  const { data, error } = await supabase.rpc("fn_rh_compromissos_financeiros", {
    p_empresa: getEmpresaId(), p_de: de, p_ate: ate,
  });
  // Migração não rodada (PGRST202) ou cargo sem direito a ver (42501): a seção
  // simplesmente não aparece, em vez de quebrar o dashboard.
  if (error && (error.code === "PGRST202" || error.code === "42501")) return { disponivel: false, itens: [] };
  if (error) throw error;
  const linhas = (data ?? []) as {
    id: string; origem: string; fonte: string; pessoa: string | null; funcionario_id: string | null;
    competencia: string | null; data: string; valor: number | string | null; status: string;
    descricao: string | null; empresa_rh: string | null;
  }[];
  return {
    disponivel: true,
    itens: linhas.map((r) => ({
      id: r.id,
      origem: (r.origem === "adiantamento" || r.origem === "salario" ? r.origem : "diario") as CompromissoRH["origem"],
      fonte: (r.fonte === "projecao" || r.fonte === "rh_pagamentos_diarios" ? r.fonte : "rh_pagamentos") as CompromissoRH["fonte"],
      pessoa: r.pessoa ?? "",
      funcionarioId: r.funcionario_id ?? null,
      competencia: r.competencia ?? "",
      data: r.data,
      valor: Number(r.valor ?? 0),
      status: r.status === "realizado" ? "realizado" : "projetado",
      descricao: r.descricao ?? "",
      empresaRH: r.empresa_rh ?? "",
    })),
  };
}

// ─── Totais mensais do RH (migração 49) ─────────────────────
// Salários, adiantamento, VT e VR somados por competência — é daqui que a
// recorrência de Folha tira o valor de cada mês.
export async function fetchTotaisRH(de: string, ate: string): Promise<{ disponivel: boolean; itens: TotaisRH[] }> {
  const { data, error } = await supabase.rpc("fn_rh_totais_mensais", {
    p_empresa: getEmpresaId(), p_de: de, p_ate: ate,
  });
  if (error && (error.code === "PGRST202" || error.code === "42501")) return { disponivel: false, itens: [] };
  if (error) throw error;
  const linhas = (data ?? []) as {
    competencia: string; salarios: number | string | null; adiantamento: number | string | null;
    vt: number | string | null; vr: number | string | null; pessoas: number | null; vr_aproximado: boolean | null;
    folha_liquida?: number | string | null;
  }[];
  return {
    disponivel: true,
    itens: linhas.map((r) => ({
      competencia: r.competencia,
      salarios: Number(r.salarios ?? 0),
      adiantamento: Number(r.adiantamento ?? 0),
      vt: Number(r.vt ?? 0),
      vr: Number(r.vr ?? 0),
      pessoas: Number(r.pessoas ?? 0),
      folhaLiquida: r.folha_liquida == null ? null : Number(r.folha_liquida),
      vrAproximado: !!r.vr_aproximado,
    })),
  };
}

export function useTotaisRH(de: string, ate: string) {
  const { empresaId, caps } = useEmpresa();
  const pode = caps.has("ver_dashboard") || caps.has("contas_gerir");
  return useQuery({
    queryKey: ["rh-totais", empresaId, de, ate],
    queryFn: () => fetchTotaisRH(de, ate),
    enabled: !!empresaId && pode && !!de && !!ate,
    staleTime: 60_000,
  });
}

export function useCompromissosRH(de: string, ate: string) {
  const { empresaId, caps } = useEmpresa();
  const pode = caps.has("ver_dashboard") || caps.has("contas_gerir") || caps.has("pag_diario_gerir");
  return useQuery({
    queryKey: ["rh-compromissos", empresaId, de, ate],
    queryFn: () => fetchCompromissosRH(de, ate),
    enabled: !!empresaId && pode && !!de && !!ate,
  });
}

export function usePagamentosDiariosRH(de: string, ate: string) {
  const { empresaId, caps } = useEmpresa();
  return useQuery({
    queryKey: ["pagamentos-diarios-rh", empresaId, de, ate],
    queryFn: () => fetchPagamentosDiariosRH(de, ate),
    enabled: !!empresaId && caps.has("pag_diario_gerir") && !!de && !!ate,
  });
}

export function useDeletePagamentoProcesso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pagamentos_processos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pagamentos_processos"] }),
  });
}

// ─── Cobranças (mensalidade por cliente + conciliação OFX) ──
export type Cobranca = {
  id: string;
  clienteId: string;
  competencia: string; // YYYY-MM-DD (1º do mês)
  vencimento: string;  // YYYY-MM-DD
  valor: number;
  status: "aberto" | "pago" | "cancelado";
  pagoEm: string | null;
  pagoValor: number | null;
  movimentacaoId: string | null; // entrada do OFX conciliada
  // Migração 50: de onde a cobrança veio e como foi combinada.
  vendaId: string | null;        // null = mensalidade do cliente
  mensalidadeId: string | null;  // de qual mensalidade (migração 52); null = anterior a ela
  parcela: number | null;
  parcelasTotal: number | null;
  formaPagamento: string;        // pix | boleto | transferencia | dinheiro | credito | debito | outro
  descricao: string;
  criadoPor: string | null;      // user_id de quem cadastrou
};

// "Vencido" não é coluna: é uma cobrança em aberto cuja data já passou. Manter
// derivado evita um status que envelhece sozinho no banco.
export type StatusCobranca = "pendente" | "pago" | "vencido" | "cancelado";
export function statusCobranca(c: Cobranca, hojeISO: string): StatusCobranca {
  if (c.status === "cancelado") return "cancelado";
  if (c.status === "pago") return "pago";
  return c.vencimento < hojeISO ? "vencido" : "pendente";
}

const COLS_COBRANCA = "id, cliente_id, competencia, vencimento, valor, status, pago_em, pago_valor, movimentacao_id, venda_id, parcela, parcelas_total, forma_pagamento, descricao, criado_por";

export async function fetchCobrancas(): Promise<Cobranca[]> {
  const eid = getEmpresaId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ler = (cols: string) => paginarTudo<any>((de, ate) =>
    supabase
      .from("cobrancas")
      .select(cols)
      .eq("empresa_id", eid)
      .order("competencia", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate)
  );
  // Sem a migração 52 a coluna mensalidade_id não existe: lê sem ela.
  let data;
  try {
    data = await ler(`${COLS_COBRANCA}, mensalidade_id`);
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") throw e;
    data = await ler(COLS_COBRANCA);
  }
  return data.map((c) => ({
    id: c.id,
    clienteId: c.cliente_id,
    competencia: c.competencia,
    vencimento: c.vencimento,
    valor: Number(c.valor),
    status: c.status as Cobranca["status"],
    pagoEm: c.pago_em ?? null,
    pagoValor: c.pago_valor === null || c.pago_valor === undefined ? null : Number(c.pago_valor),
    vendaId: c.venda_id ?? null,
    mensalidadeId: c.mensalidade_id ?? null,
    parcela: c.parcela ?? null,
    parcelasTotal: c.parcelas_total ?? null,
    formaPagamento: c.forma_pagamento ?? "",
    descricao: c.descricao ?? "",
    criadoPor: c.criado_por ?? null,
    movimentacaoId: c.movimentacao_id ?? null,
  }));
}

export function useCobrancas() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["cobrancas", empresaId], queryFn: fetchCobrancas, enabled: !!empresaId });
}

// Gera as cobranças do mês e concilia com o extrato (roda ao abrir a tela).
export function useSincronizarCobrancas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ geradas: number; conciliadas: number }> => {
      const eid = getEmpresaId();
      const { data: g, error: e1 } = await supabase.rpc("fn_gerar_cobrancas", { p_empresa: eid });
      if (e1) throw new Error(e1.message);
      const { data: c, error: e2 } = await supabase.rpc("fn_conciliar_cobrancas", { p_empresa: eid });
      if (e2) throw new Error(e2.message);
      return { geradas: Number(g ?? 0), conciliadas: Number(c ?? 0) };
    },
    onSuccess: ({ geradas, conciliadas }) => {
      if (geradas > 0 || conciliadas > 0) qc.invalidateQueries({ queryKey: ["cobrancas"] });
    },
  });
}

// Gera as cobranças do mês e concilia com o extrato assim que a empresa ativa
// fica resolvida (e de novo ao trocar de empresa). Antes disso getEmpresaId()
// não tem empresa e a mutação falharia sem sincronizar nada.
export function useSincronizarCobrancasAoAbrir() {
  const { empresaId } = useEmpresa();
  const sync = useSincronizarCobrancas();
  const feitoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!empresaId || feitoPara.current === empresaId) return;
    feitoPara.current = empresaId;
    sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);
}

// Marca uma cobrança como paga MANUALMENTE (sem entrada do OFX).
export function useMarcarCobrancaPaga() {
  const qc = useQueryClient();
  return useMutation({
    meta: { successMessage: "Pagamento registrado." },
    mutationFn: async ({ id, valor, pagoEm }: { id: string; valor: number; pagoEm: string }) => {
      const { error } = await supabase
        .from("cobrancas")
        .update({ status: "pago", pago_em: pagoEm, pago_valor: valor, movimentacao_id: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cobrancas"] }),
  });
}

// Cancela uma cobrança (some dos totais e da projeção, mas fica no histórico).
export function useCancelarCobranca() {
  const qc = useQueryClient();
  return useMutation({
    meta: { successMessage: "Cobrança cancelada." },
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cobrancas")
        .update({ status: "cancelado", pago_em: null, pago_valor: null, movimentacao_id: null })
        .eq("id", id)
        .eq("empresa_id", getEmpresaId());
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cobrancas"] }),
  });
}

// Parcelas de uma venda → cobranças (migração 50). O banco confere a soma
// contra o valor da venda e grava tudo de uma vez; parcela já paga é mantida.
export type ParcelaVenda = { valor: number; vencimento: string };

export function useGerarCobrancasDaVenda() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ vendaId, parcelas }: { vendaId: string; parcelas: ParcelaVenda[] }) => {
      const { data, error } = await supabase.rpc("fn_cobrancas_da_venda", {
        p_venda: vendaId,
        p_parcelas: parcelas.map((p) => ({ valor: p.valor, vencimento: p.vencimento })),
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
      qc.invalidateQueries({ queryKey: ["vendas"] });
    },
  });
}

// Quem é quem na empresa (migração 50): resolve o "cadastrado por" das telas
// sem precisar ser master.
export type MembroEmpresa = { userId: string; email: string; nome: string };

export function useMembrosDaEmpresa() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["membros-empresa", empresaId],
    queryFn: async (): Promise<MembroEmpresa[]> => {
      const { data, error } = await supabase.rpc("fn_membros_da_empresa", { p_empresa: getEmpresaId() });
      // Sem a função (migração não rodada) a tela só deixa de mostrar o nome.
      if (error?.code === "PGRST202") return [];
      if (error) throw error;
      return ((data ?? []) as { user_id: string; email: string | null; nome: string | null }[]).map((m) => ({
        userId: m.user_id,
        email: m.email ?? "",
        nome: m.nome ?? "",
      }));
    },
    enabled: !!empresaId,
    staleTime: 5 * 60_000,
  });
}

// Reabre a cobrança (desfaz pagamento / desvincula do OFX).
export function useReabrirCobranca() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cobrancas")
        .update({ status: "aberto", pago_em: null, pago_valor: null, movimentacao_id: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cobrancas"] }),
  });
}

// ─── Movimentações ──────────────────────────────────────────
export type Movimentacao = {
  id: string;
  date: string;    // dd/MM para exibição
  dataISO: string; // YYYY-MM-DD (para edição)
  desc: string;
  ia: string;
  cat: string;
  conf: number;
  valor: number;
  tipo: "in" | "out";
  contaId: string | null; // conta bancária dona da movimentação
  fitid: string | null;   // id único do OFX (quando veio do extrato); null em CSV/manual
};

export async function fetchMovimentacoes(): Promise<Movimentacao[]> {
  // Conta ativa: null = todas (consolidado). Quando há conta selecionada, filtra.
  const contaId = getContaIdOrNull();
  const eid = getEmpresaId();
  const data = await paginarTudo((de, ate) => {
    let q = supabase
      .from("movimentacoes")
      .select("id, data, descricao, descricao_ia, categoria, confianca, valor, tipo, conta_id, fitid")
      .eq("empresa_id", eid)
      // Só transações CONFIRMADAS entram no extrato/relatórios/saldo.
      // As 'pendente' (importadas, aguardando revisão) vivem na tela /revisao.
      .eq("categoria_status", "confirmada");
    if (contaId) q = q.eq("conta_id", contaId);
    return q.order("data", { ascending: false }).order("id", { ascending: false }).range(de, ate);
  });

  return data.map((m) => ({
    id: m.id,
    date: ddMM(m.data),
    dataISO: m.data,
    desc: m.descricao,
    ia: m.descricao_ia ?? m.descricao,
    cat: m.categoria ?? "",
    conf: Number(m.confianca),
    valor: Number(m.valor),
    tipo: m.tipo as "in" | "out",
    contaId: m.conta_id ?? null,
    fitid: m.fitid ?? null,
  }));
}

export function useMovimentacoes() {
  const { empresaId, contaId } = useEmpresa();
  return useQuery({ queryKey: ["movimentacoes", empresaId, contaId], queryFn: fetchMovimentacoes, enabled: !!empresaId });
}

// Movimentação enriquecida para RELATÓRIOS: com a competência resolvida.
// `mesComp` = mês de competência ("YYYY-MM"); `dataComp` = a mesma data no mês
// de competência (para os filtros de período respeitarem a competência).
// `dataISO`/`date` seguem sendo a data REAL do pagamento (para exibição).
export type MovimentacaoRel = Movimentacao & { mesComp: string; dataComp: string };

// Movimentações para RELATÓRIOS: remove as de categorias marcadas "não entra em
// relatórios" e anexa a competência. NÃO use para saldo/extrato: lá valem a
// data real e TODAS as movimentações. As flags vêm do plano de contas.
// `incluirOcultos` liga as categorias marcadas "não entra em relatórios"
// (aplicação/resgate, transferência entre contas próprias) — é o botão
// "Mostrar investimentos" do Dashboard e das Análises financeiras.
export function useMovimentacoesRelatorio(incluirOcultos = false): MovimentacaoRel[] {
  const { data: movimentos = [] } = useMovimentacoes();
  const { data: contas = [] } = usePlanoContas();
  return useMemo(() => {
    const flags = resolverFlags(contas);
    return movimentos
      .filter((m) => incluirOcultos || !flags.ocultoDe(m.cat))
      .map((m) => {
        const r = flags.competenciaDe(m.cat);
        const dataComp = dataCompetencia(m.dataISO, r.modo, r.diaCorte);
        return { ...m, dataComp, mesComp: dataComp.slice(0, 7) };
      });
  }, [movimentos, contas, incluirOcultos]);
}

// Dados do formulário de transação → colunas do banco.
export type MovimentacaoInput = {
  data: string; // YYYY-MM-DD
  descricao: string;
  descricao_ia: string;
  categoria: string;
  valor: number; // sempre positivo
  tipo: "in" | "out";
  confianca: number; // 0..1
  fitid?: string | null; // id único do OFX (dedup); null em CSV/manual
  contaId: string; // conta bancária (obrigatória)
};

const toMovRow = (input: MovimentacaoInput) => ({
  data: input.data,
  descricao: input.descricao,
  descricao_ia: input.descricao_ia || null,
  categoria: input.categoria || null,
  valor: Math.abs(input.valor),
  tipo: input.tipo,
  confianca: input.confianca,
  fitid: input.fitid ?? null,
  conta_id: input.contaId,
});

// Quais FITIDs (de uma lista) já existem NA CONTA — para marcar duplicatas na
// prévia. Escopado por conta: o mesmo FITID pode existir legitimamente em bancos
// diferentes, então não pode ser tratado como duplicata entre contas.
// Os ids vão na URL e a API corta a resposta em 1000 linhas: um extrato de
// centenas de transações precisa ser consultado em fatias, senão a lista de
// "já existe" volta incompleta e o insert bate no índice único.
const FITID_CHUNK = 100;

export async function fetchExistingFitids(fitids: string[], contaId: string): Promise<Set<string>> {
  const ids = [...new Set(fitids.filter(Boolean))];
  const eid = getEmpresaId();
  const achados = new Set<string>();
  for (let i = 0; i < ids.length; i += FITID_CHUNK) {
    const { data, error } = await supabase
      .from("movimentacoes")
      .select("fitid")
      .eq("empresa_id", eid)
      .eq("conta_id", contaId)
      .in("fitid", ids.slice(i, i + FITID_CHUNK));
    if (error) throw error;
    for (const r of data ?? []) if (r.fitid) achados.add(r.fitid as string);
  }
  return achados;
}

// Movimentações de uma conta num intervalo (confirmadas E pendentes), com os
// campos necessários p/ conciliação (dia+valor+tipo+descrição+fitid).
// Usada pela dedup por conteúdo (importar) e pela tela Conferir extrato.
export type MovConta = { id: string; dataISO: string; valor: number; tipo: "in" | "out"; descricao: string; fitid: string | null };
export async function fetchMovimentacoesConta(contaId: string, deISO: string, ateISO: string): Promise<MovConta[]> {
  const eid = getEmpresaId();
  const data = await paginarTudo((de, ate) =>
    supabase
      .from("movimentacoes")
      .select("id, data, descricao, valor, tipo, fitid")
      .eq("empresa_id", eid)
      .eq("conta_id", contaId)
      .gte("data", deISO)
      .lte("data", ateISO)
      .order("data", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate)
  );
  return data.map((m) => ({
    id: m.id,
    dataISO: m.data,
    valor: Number(m.valor),
    tipo: m.tipo as "in" | "out",
    descricao: m.descricao ?? "",
    fitid: m.fitid ?? null,
  }));
}

// Lançamentos parecidos (mesma conta + data + valor + tipo) — p/ o aviso de
// possível duplicata ao lançar à mão. Devolve só o que interessa exibir.
export async function fetchMovimentacoesSimilares(
  contaId: string, dataISO: string, valor: number, tipo: "in" | "out"
): Promise<{ id: string; descricao: string }[]> {
  const { data, error } = await supabase
    .from("movimentacoes")
    .select("id, descricao")
    .eq("empresa_id", getEmpresaId())
    .eq("conta_id", contaId)
    .eq("data", dataISO)
    .eq("valor", Math.abs(valor))
    .eq("tipo", tipo)
    .limit(5);
  if (error) throw error;
  return (data ?? []).map((m) => ({ id: m.id, descricao: m.descricao ?? "" }));
}

export function useSaveMovimentacao() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: async ({ id, input }: { id?: string; input: MovimentacaoInput }) => {
      if (id) {
        const { error } = await supabase.from("movimentacoes").update(toMovRow(input)).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("movimentacoes").insert({ ...toMovRow(input), empresa_id: getEmpresaId() });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimentacoes"] }),
  });
}

export function useDeleteMovimentacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("movimentacoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      // cobre o "descartar" de uma transação ainda pendente (tela de revisão).
      qc.invalidateQueries({ queryKey: ["pendentes"] });
      qc.invalidateQueries({ queryKey: ["pendentes_count"] });
    },
  });
}

// ─── Importação → revisão → aprovação ───────────────────────
// Linha crua de um extrato pronta pra virar um lote pendente. `sugeridaId`
// é opcional: se o Excel já trouxe uma categoria válida, ela entra como
// SUGESTÃO inicial (continua precisando de aprovação).
export type ImportRow = {
  data: string; // YYYY-MM-DD
  descricao: string;
  valor: number; // sempre positivo
  tipo: "in" | "out";
  fitid?: string | null;
  sugeridaId?: string | null; // plano_contas.id pré-sugerido (opcional)
};

// Importa um lote como PENDENTE (sem categoria confirmada) e roda a
// pré-categorização (preenche só categoria_sugerida_id). Devolve o lote_id
// pra tela de revisão focar exatamente o que entrou.
export type ImportResult = {
  loteId: string;
  inserted: number;
  skipped: number;             // tiradas por já existirem na conta (mesmo FITID)
  suggested: number;
  sugestaoErro: string | null; // importou, mas a pré-categorização falhou
};

export function useImportLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contaId, rows }: { contaId: string; rows: ImportRow[] }): Promise<ImportResult> => {
      const vazio = { loteId: "", inserted: 0, skipped: 0, suggested: 0, sugestaoErro: null };
      if (rows.length === 0) return vazio;
      const eid = getEmpresaId();
      const loteId = crypto.randomUUID();

      // Rede de segurança do índice único (empresa, conta, fitid): confere no
      // banco na hora do envio e tira o que já está lá. A prévia já marca as
      // duplicatas, mas o estado dela envelhece — se um envio gravou e falhou
      // depois (ex.: na pré-categorização), reenviar derrubaria o lote inteiro.
      const jaExistem = await fetchExistingFitids(
        rows.map((r) => r.fitid).filter((f): f is string => !!f),
        contaId
      );
      const noLote = new Set<string>();
      const novas = rows.filter((r) => {
        if (!r.fitid) return true; // sem FITID (PDF/planilha) o índice não se aplica
        if (jaExistem.has(r.fitid) || noLote.has(r.fitid)) return false;
        noLote.add(r.fitid);
        return true;
      });
      const skipped = rows.length - novas.length;
      if (novas.length === 0) return { ...vazio, skipped };

      const payload = novas.map((r) => ({
        empresa_id: eid,
        conta_id: contaId,
        data: r.data,
        descricao: r.descricao,
        descricao_ia: null,
        categoria: null, // nada de categoria CONFIRMADA na importação
        valor: Math.abs(r.valor),
        tipo: r.tipo,
        confianca: 1,
        fitid: r.fitid ?? null,
        categoria_status: "pendente" as const,
        categoria_sugerida_id: r.sugeridaId ?? null,
        lote_id: loteId,
      }));

      const { error } = await supabase.from("movimentacoes").insert(payload);
      if (error) {
        if (error.code === "23505") {
          throw new Error(
            "Parte destas transações já existe nesta conta (mesmo código do banco). Recarregue a página e importe de novo — o que já entrou é ignorado."
          );
        }
        throw error;
      }

      // Pré-categorização server-side (preenche só as sugestões que faltam).
      // É um EXTRA: se falhar, o lote já está gravado. Falhar aqui não pode
      // parecer que a importação inteira deu errado — o usuário reenviaria e
      // bateria no índice único, e as transações ficariam sem sugestão.
      let suggested = 0;
      let sugestaoErro: string | null = null;
      const { data: sugeridas, error: e2 } = await supabase.rpc("fn_categorizar_pendentes", {
        p_empresa: eid,
        p_lote: loteId,
      });
      if (e2) sugestaoErro = e2.message || "Falha ao sugerir categorias.";
      else suggested = Number(sugeridas ?? 0);

      return { loteId, inserted: novas.length, skipped, suggested, sugestaoErro };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendentes"] });
      qc.invalidateQueries({ queryKey: ["pendentes_count"] });
    },
  });
}

// Transação aguardando revisão (estado 'pendente').
export type Pendente = {
  id: string;
  dataISO: string;
  descricao: string;
  valor: number;
  tipo: "in" | "out";
  loteId: string | null;
  sugeridaId: string | null; // plano_contas.id sugerido (pode ser null)
};

export async function fetchPendentes(loteId?: string): Promise<Pendente[]> {
  const eid = getEmpresaId();
  const data = await paginarTudo((de, ate) => {
    let q = supabase
      .from("movimentacoes")
      .select("id, data, descricao, valor, tipo, lote_id, categoria_sugerida_id")
      .eq("empresa_id", eid)
      .eq("categoria_status", "pendente");
    if (loteId) q = q.eq("lote_id", loteId);
    return q.order("data", { ascending: false }).order("id", { ascending: false }).range(de, ate);
  });
  return (data ?? []).map((m) => ({
    id: m.id,
    dataISO: m.data,
    descricao: m.descricao,
    valor: Number(m.valor),
    tipo: m.tipo as "in" | "out",
    loteId: m.lote_id ?? null,
    sugeridaId: m.categoria_sugerida_id ?? null,
  }));
}

export function usePendentes(loteId?: string) {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["pendentes", empresaId, loteId ?? "all"],
    queryFn: () => fetchPendentes(loteId),
    enabled: !!empresaId,
  });
}

// Aprova transações: cada uma vira CONFIRMADA (categoria do plano de contas
// escolhido) e dispara o APRENDIZADO da regra. 1 a 1 ou em lote — mesma RPC.
export function useAprovarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (aprovacoes: { id: string; categoria_id: string }[]) => {
      if (aprovacoes.length === 0) return 0;
      const { data, error } = await supabase.rpc("fn_aprovar_lote", {
        p_aprovacoes: aprovacoes,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendentes"] });
      qc.invalidateQueries({ queryKey: ["pendentes_count"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
    },
  });
}

// Roda de novo a pré-categorização nos pendentes que estão sem sugestão, com as
// regras que existem hoje. Serve para o lote que entrou quando a sugestão falhou
// (ou antes de a regra ser criada) — sem precisar reimportar o extrato.
export function useSugerirCategorias() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline (é ele que diz o que há de errado)
    mutationFn: async (loteId?: string): Promise<number> => {
      const { data, error } = await supabase.rpc("fn_categorizar_pendentes", {
        p_empresa: getEmpresaId(),
        p_lote: loteId ?? null,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pendentes"] }),
  });
}

// Aprende regras a partir do histórico já confirmado (cold-start) e, em
// seguida, re-sugere os pendentes com as regras novas. Idempotente no banco.
export function useSemearHistorico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ regras: number; sugeridas: number }> => {
      const eid = getEmpresaId();
      const { data: regras, error } = await supabase.rpc("fn_semear_regras_do_historico", {
        p_empresa: eid,
      });
      if (error) throw error;
      const { data: sugeridas, error: e2 } = await supabase.rpc("fn_categorizar_pendentes", {
        p_empresa: eid,
        p_lote: null,
      });
      if (e2) throw e2;
      return { regras: Number(regras ?? 0), sugeridas: Number(sugeridas ?? 0) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendentes"] });
      qc.invalidateQueries({ queryKey: ["pendentes_count"] });
      // Aprender do histórico grava em regras_categorizacao (não na tabela
      // legada `regras`) — invalida a chave certa p/ a lista de Ajustes atualizar.
      qc.invalidateQueries({ queryKey: ["regras_categorizacao"] });
    },
  });
}

// Contador de pendentes (badge no menu).
export async function fetchPendentesCount(): Promise<number> {
  const { count, error } = await supabase
    .from("movimentacoes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", getEmpresaId())
    .eq("categoria_status", "pendente");
  if (error) throw error;
  return count ?? 0;
}

export function usePendentesCount() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["pendentes_count", empresaId],
    queryFn: fetchPendentesCount,
    enabled: !!empresaId,
  });
}

// Exclusão em lote (várias transações de uma vez). Os ids vão na URL do
// DELETE, então lotes grandes (um extrato de vários meses) são fatiados para
// não estourar o limite de tamanho da requisição.
const DELETE_CHUNK = 100;

export function useDeleteMovimentacoesBatch() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo de lote
    mutationFn: async (ids: string[]) => {
      const eid = getEmpresaId();
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        const fatia = ids.slice(i, i + DELETE_CHUNK);
        const { error } = await supabase.from("movimentacoes").delete().eq("empresa_id", eid).in("id", fatia);
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      // cobre o "excluir todas" da tela de revisão (transações pendentes).
      qc.invalidateQueries({ queryKey: ["pendentes"] });
      qc.invalidateQueries({ queryKey: ["pendentes_count"] });
    },
  });
}

// Recategorização em lote (atribui a mesma categoria a várias transações).
export function useUpdateMovimentacoesCategoria() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo de lote
    mutationFn: async ({ ids, categoria }: { ids: string[]; categoria: string }) => {
      if (ids.length === 0) return 0;
      const { error } = await supabase
        .from("movimentacoes")
        .update({ categoria: categoria || null })
        .eq("empresa_id", getEmpresaId())
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimentacoes"] }),
  });
}


// ─── Regras de categorização ────────────────────────────────
export type Regra = { id: string; when: string; then: string; on: boolean };

export async function fetchRegras(): Promise<Regra[]> {
  const { data, error } = await supabase
    .from("regras")
    .select("id, quando, entao, ativo")
    .eq("empresa_id", getEmpresaId())
    .order("criado_em", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, when: r.quando, then: r.entao, on: r.ativo }));
}

export function useRegras() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["regras", empresaId], queryFn: fetchRegras, enabled: !!empresaId });
}

export function useToggleRegra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { error } = await supabase.from("regras").update({ ativo: on }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["regras"] }),
  });
}

// ─── Regras de AUTO-categorização (regras_categorizacao) ────
// As regras que o sistema aprende nas aprovações (e que dá pra criar/editar à
// mão na aba Ajustes). CRUD direto: a RLS só deixa mexer nas da própria empresa
// e o trigger valida que a categoria é da empresa.
export type RegraCategorizacao = {
  id: string;
  padrao: string;
  tipoMatch: string;
  categoriaId: string;
  origem: "manual" | "aprendida";
  acertos: number;
  ativo: boolean;
};
export type RegraCategorizacaoInput = { padrao: string; categoriaId: string; ativo: boolean };

export async function fetchRegrasCategorizacao(): Promise<RegraCategorizacao[]> {
  const { data, error } = await supabase
    .from("regras_categorizacao")
    .select("id, padrao, tipo_match, categoria_id, origem, acertos, ativo")
    .eq("empresa_id", getEmpresaId())
    .order("acertos", { ascending: false })
    .order("padrao", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    padrao: r.padrao,
    tipoMatch: r.tipo_match,
    categoriaId: r.categoria_id,
    origem: r.origem as "manual" | "aprendida",
    acertos: r.acertos,
    ativo: r.ativo,
  }));
}

export function useRegrasCategorizacao() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["regras_categorizacao", empresaId],
    queryFn: fetchRegrasCategorizacao,
    enabled: !!empresaId,
  });
}

// Normaliza um padrão digitado à mão para casar com a descrição já normalizada
// (sem acento/ruído/dígitos). Cai p/ UPPER(trim) se a normalização zerar.
export async function normalizarPadrao(texto: string): Promise<string> {
  const t = texto.trim();
  if (!t) return "";
  const { data, error } = await supabase.rpc("fn_normaliza_descricao", { p_texto: t });
  if (error) throw error;
  const norm = ((data as string | null) ?? "").trim();
  return norm || t.toUpperCase();
}

function mapRegraError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("Já existe uma regra com esse padrão.");
  return new Error(error.message);
}

export function useSaveRegraCategorizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: RegraCategorizacaoInput }) => {
      const padrao = await normalizarPadrao(input.padrao);
      if (!padrao) throw new Error("Informe um padrão válido.");
      if (!input.categoriaId) throw new Error("Escolha uma categoria.");
      if (id) {
        const { error } = await supabase
          .from("regras_categorizacao")
          .update({ padrao, categoria_id: input.categoriaId, ativo: input.ativo })
          .eq("id", id);
        if (error) throw mapRegraError(error);
      } else {
        const { error } = await supabase.from("regras_categorizacao").insert({
          empresa_id: getEmpresaId(),
          padrao,
          tipo_match: "contem",
          categoria_id: input.categoriaId,
          origem: "manual",
          acertos: 0,
          ativo: input.ativo,
        });
        if (error) throw mapRegraError(error);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["regras_categorizacao"] }),
  });
}

export function useToggleRegraCategorizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("regras_categorizacao").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["regras_categorizacao"] }),
  });
}

export function useDeleteRegraCategorizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("regras_categorizacao").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["regras_categorizacao"] }),
  });
}

// ─── Plano de contas (categorias hierárquicas) ──────────────
export type Conta = {
  id: string;
  nome: string;
  tipo: "receita" | "despesa";
  codigo: string;
  parentId: string | null;
  ocultoRelatorios: boolean;          // lançamentos dela não entram em relatórios
  investimentoAnuncios: boolean;      // é investimento em anúncios (migração 50)
  compensar: boolean;                 // entra compensada no Dashboard (migração 56)
  competenciaModo: CompetenciaModo;   // como decidir o mês de competência
  competenciaDiaCorte: number | null; // dia de corte (só nos modos de corte)
};
export type ContaInput = Omit<Conta, "id">;

export async function fetchPlanoContas(): Promise<Conta[]> {
  const { data, error } = await supabase
    .from("plano_contas")
    .select("id, nome, tipo, codigo, parent_id, oculto_relatorios, competencia_modo, competencia_dia_corte, investimento_anuncios, compensar")
    .eq("empresa_id", getEmpresaId())
    .order("codigo", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo as "receita" | "despesa",
    codigo: c.codigo ?? "",
    parentId: c.parent_id,
    ocultoRelatorios: !!c.oculto_relatorios,
    investimentoAnuncios: !!c.investimento_anuncios,
    compensar: !!c.compensar,
    competenciaModo: (c.competencia_modo ?? "pagamento") as CompetenciaModo,
    competenciaDiaCorte: c.competencia_dia_corte ?? null,
  }));
}

export function usePlanoContas() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["plano_contas", empresaId], queryFn: fetchPlanoContas, enabled: !!empresaId });
}

const toContaRow = (i: ContaInput) => ({
  nome: i.nome,
  tipo: i.tipo,
  codigo: i.codigo || null,
  parent_id: i.parentId,
  oculto_relatorios: i.ocultoRelatorios,
  investimento_anuncios: i.investimentoAnuncios ?? false,
  compensar: i.compensar ?? false,
  competencia_modo: i.competenciaModo,
  competencia_dia_corte: i.competenciaModo.startsWith("corte") ? i.competenciaDiaCorte : null,
});

export function useSaveConta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ContaInput }): Promise<{ movsAtualizadas: number }> => {
      let movsAtualizadas = 0;
      if (id) {
        // Renomear/mover muda o caminho-texto gravado nas movimentações — sem
        // propagar, os lançamentos antigos viram "(sem categoria)" nos
        // relatórios. Movimentações PRIMEIRO, plano depois: se falhar no meio,
        // salvar de novo encontra zero para atualizar e termina o serviço.
        const eid = getEmpresaId();
        const contas = await fetchPlanoContas();
        for (const [antigo, novo] of paresRenomeacao(contas, id, input.nome.trim(), input.parentId)) {
          const { count, error } = await supabase
            .from("movimentacoes")
            .update({ categoria: novo }, { count: "exact" })
            .eq("empresa_id", eid)
            .eq("categoria", antigo);
          if (error) throw error;
          movsAtualizadas += count ?? 0;
        }
        const { error } = await supabase.from("plano_contas").update(toContaRow(input)).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("plano_contas").insert({ ...toContaRow(input), empresa_id: getEmpresaId() });
        if (error) throw error;
      }
      return { movsAtualizadas };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["plano_contas"] });
      if (r.movsAtualizadas > 0) qc.invalidateQueries({ queryKey: ["movimentacoes"] });
    },
  });
}

export function useDeleteConta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("plano_contas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plano_contas"] }),
  });
}

// Copia o plano de contas de uma empresa de ORIGEM para a de DESTINO.
// SÓ MASTER (a RPC valida via is_master); aditivo e idempotente no banco.
export function useCopiarPlanoContas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ origem, destino }: { origem: string; destino: string }) => {
      const { data, error } = await supabase.rpc("copiar_plano_contas", {
        p_origem: origem,
        p_destino: destino,
      });
      // Normaliza p/ Error (erro do PostgREST às vezes vem como objeto simples,
      // o que fazia a tela mostrar só o texto genérico "Erro ao copiar").
      if (error) throw new Error(error.message || "Não consegui copiar o plano de contas.");
      return Number(data ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plano_contas"] }),
  });
}

// ─── Orçamento / Metas por categoria ────────────────────────
// competencia null = meta mensal PADRÃO (recorrente); "YYYY-MM-01" = override.
export type Orcamento = {
  id: string;
  planoContaId: string;
  competencia: string | null; // YYYY-MM-01 ou null (padrão)
  valorMeta: number;
};
export type OrcamentoInput = {
  planoContaId: string;
  competencia: string | null;
  valorMeta: number;
};

export async function fetchOrcamentos(): Promise<Orcamento[]> {
  const { data, error } = await supabase
    .from("orcamentos")
    .select("id, plano_conta_id, competencia, valor_meta")
    .eq("empresa_id", getEmpresaId());
  if (error) throw error;
  return (data ?? []).map((o) => ({
    id: o.id,
    planoContaId: o.plano_conta_id,
    competencia: o.competencia ?? null,
    valorMeta: Number(o.valor_meta),
  }));
}

export function useOrcamentos() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["orcamentos", empresaId], queryFn: fetchOrcamentos, enabled: !!empresaId });
}

const toOrcamentoRow = (i: OrcamentoInput) => ({
  plano_conta_id: i.planoContaId,
  competencia: i.competencia,
  valor_meta: i.valorMeta,
});

export function useSaveOrcamento() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: async ({ id, input }: { id?: string; input: OrcamentoInput }) => {
      if (id) {
        const { error } = await supabase.from("orcamentos").update(toOrcamentoRow(input)).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("orcamentos").insert({ ...toOrcamentoRow(input), empresa_id: getEmpresaId() });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orcamentos"] }),
  });
}

export function useDeleteOrcamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("orcamentos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orcamentos"] }),
  });
}

// ─── Contas bancárias ───────────────────────────────────────
export type ContaBancaria = {
  id: string;
  nome: string;
  banco: string;
  bankId: string | null;
  acctId: string | null;
  acctType: string | null;
  saldoInicial: number;
  saldoInicialData: string; // YYYY-MM-DD
  ativo: boolean;
  ordem: number;
  cor: string | null;
};

// Retorna TODAS as contas (ativas e inativas) da empresa. O seletor filtra as
// ativas; a consolidação de saldo precisa de todas (inativa ainda soma histórico).
export async function fetchContasBancarias(): Promise<ContaBancaria[]> {
  const { data, error } = await supabase
    .from("contas_bancarias")
    .select("id, nome, banco, bank_id, acct_id, acct_type, saldo_inicial, saldo_inicial_data, ativo, ordem, cor")
    .eq("empresa_id", getEmpresaId())
    .order("ordem", { ascending: true })
    .order("criado_em", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    banco: c.banco ?? "",
    bankId: c.bank_id ?? null,
    acctId: c.acct_id ?? null,
    acctType: c.acct_type ?? null,
    saldoInicial: Number(c.saldo_inicial ?? 0),
    saldoInicialData: c.saldo_inicial_data ?? "1970-01-01",
    ativo: !!c.ativo,
    ordem: Number(c.ordem ?? 0),
    cor: c.cor ?? null,
  }));
}

export function useContasBancarias() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["contas_bancarias", empresaId], queryFn: fetchContasBancarias, enabled: !!empresaId });
}

export type ContaBancariaInput = {
  nome: string;
  banco: string;
  saldoInicial: number;
  saldoInicialData: string;
  ativo: boolean;
  ordem?: number;
  cor?: string | null;
  bankId?: string | null;
  acctId?: string | null;
  acctType?: string | null;
};

export function useSaveContaBancaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ContaBancariaInput }): Promise<string> => {
      const row = {
        nome: input.nome.trim(),
        banco: input.banco?.trim() || null,
        saldo_inicial: input.saldoInicial,
        saldo_inicial_data: input.saldoInicialData,
        ativo: input.ativo,
        cor: input.cor ?? null,
        bank_id: input.bankId ?? null,
        acct_id: input.acctId ?? null,
        acct_type: input.acctType ?? null,
        ...(input.ordem !== undefined ? { ordem: input.ordem } : {}),
      };
      if (id) {
        const { error } = await supabase.from("contas_bancarias").update(row).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await supabase
        .from("contas_bancarias")
        .insert({ ...row, empresa_id: getEmpresaId() })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contas_bancarias"] }),
  });
}

// Acerta o saldo INICIAL da conta para bater com o saldo informado pelo banco
// (LEDGERBAL do OFX) numa data. Deriva o saldo inicial a partir do próprio
// extrato do banco: saldo_inicial = saldoDoBanco − (soma de todas as
// movimentações da conta até aquela data). Assim o saldo do app passa a bater
// exatamente com o banco, preservando o histórico do gráfico.
export function useAcertarSaldoExtrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contaId, ledger, asOfISO }: { contaId: string; ledger: number; asOfISO: string }) => {
      // Todas as movimentações da conta até a data do saldo (confirmadas E
      // pendentes — as recém-importadas serão aprovadas e já contam aqui).
      // Paginado: esta soma vira o saldo_inicial da conta. Ler de menos aqui
      // grava um saldo errado no banco, que depois some no meio do gráfico.
      const eid = getEmpresaId();
      const data = await paginarTudo((de, ate) =>
        supabase
          .from("movimentacoes")
          .select("data, valor, tipo")
          .eq("empresa_id", eid)
          .eq("conta_id", contaId)
          .lte("data", asOfISO)
          .order("data", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate)
      );

      let soma = 0;
      let primeira: string | null = null;
      for (const r of data) {
        soma += (r.tipo === "in" ? 1 : -1) * Number(r.valor);
        if (!primeira || r.data < primeira) primeira = r.data;
      }
      soma = Math.round(soma * 100) / 100;

      // Âncora do saldo inicial: o dia anterior ao 1º lançamento (mantém todo o
      // histórico no gráfico). Sem lançamentos, ancora na própria data do saldo.
      const baseISO = primeira ? diaAnteriorISO(primeira) : asOfISO;
      const saldoInicial = Math.round((ledger - soma) * 100) / 100;

      const { error: e2 } = await supabase
        .from("contas_bancarias")
        .update({ saldo_inicial: saldoInicial, saldo_inicial_data: baseISO })
        .eq("id", contaId);
      if (e2) throw e2;
      return { saldoInicial, baseISO };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contas_bancarias"] }),
  });
}

// Data ISO do dia anterior (YYYY-MM-DD), sem depender de fuso.
function diaAnteriorISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// Soft-delete: a conta pode ter movimentações (hard-delete é barrado por FK).
export function useDeleteContaBancaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contas_bancarias").update({ ativo: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contas_bancarias"] }),
  });
}

// ─── Configurações financeiras (saldo inicial — legado, agora por conta) ─────
export type Config = { saldoInicial: number; saldoInicialData: string };

export async function fetchConfig(): Promise<Config> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("saldo_inicial, saldo_inicial_data")
    .eq("empresa_id", getEmpresaId())
    .maybeSingle();
  if (error) throw error;
  return {
    saldoInicial: Number(data?.saldo_inicial ?? 0),
    saldoInicialData: data?.saldo_inicial_data ?? "1970-01-01",
  };
}

export function useConfig() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["configuracoes", empresaId], queryFn: fetchConfig, enabled: !!empresaId });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Config) => {
      // 1 linha por empresa: upsert (a empresa pode ainda não ter config).
      const { error } = await supabase
        .from("configuracoes")
        .upsert(
          {
            empresa_id: getEmpresaId(),
            saldo_inicial: input.saldoInicial,
            saldo_inicial_data: input.saldoInicialData,
            atualizado_em: new Date().toISOString(),
          },
          { onConflict: "empresa_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["configuracoes"] }),
  });
}

// ─── Funcionalidades opcionais (migração 47) ────────────────
// Coluna `configuracoes.funcionalidades` (jsonb), 1 linha por empresa. Enquanto
// a migração não rodar, a leitura devolve o mapa vazio — e o app usa o padrão
// do catálogo, sem erro na tela.
const semColunaFuncionalidades = (code?: string, msg?: string) =>
  code === "42703" || code === "PGRST204" || /funcionalidades/.test(msg ?? "");

export async function fetchFuncionalidades(): Promise<MapaFuncionalidades> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("funcionalidades")
    .eq("empresa_id", getEmpresaId())
    .maybeSingle();
  if (error) {
    if (semColunaFuncionalidades(error.code, error.message)) return {};
    throw error;
  }
  return lerMapa(data?.funcionalidades);
}

export function useFuncionalidades() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["funcionalidades", empresaId],
    queryFn: fetchFuncionalidades,
    enabled: !!empresaId,
    staleTime: 5 * 60_000,
  });
}

export function useSalvarFuncionalidade() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ chave, ligada }: { chave: Funcionalidade; ligada: boolean }) => {
      // Lê o mapa atual e regrava o jsonb inteiro: a coluna guarda um objeto só.
      const atual = await fetchFuncionalidades();
      const { error } = await supabase
        .from("configuracoes")
        .upsert(
          { empresa_id: getEmpresaId(), funcionalidades: { ...atual, [chave]: ligada }, atualizado_em: new Date().toISOString() },
          { onConflict: "empresa_id" }
        );
      if (error) {
        if (semColunaFuncionalidades(error.code, error.message)) {
          throw new Error("Rode supabase/47_funcionalidades.sql no SQL Editor para guardar esta opção.");
        }
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["funcionalidades"] }),
  });
}

// ─── Cartões (migração 51) ──────────────────────────────────
// Cadastro enxuto: a fatura continua chegando pelo extrato. Isto só diz em que
// cartão cada despesa recorrente cai, para a tela somar o comprometido.
export type Cartao = {
  id: string;
  nome: string;
  final: string;
  diaFechamento: number | null;
  diaVencimento: number | null;
  ativo: boolean;
};
export type CartaoInput = Omit<Cartao, "id">;

export function useCartoes() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["cartoes", empresaId],
    queryFn: async (): Promise<Cartao[]> => {
      const { data, error } = await supabase
        .from("cartoes")
        .select("id, nome, final, dia_fechamento, dia_vencimento, ativo")
        .eq("empresa_id", getEmpresaId())
        .order("nome", { ascending: true });
      // Sem a migração 51 a área de cartões simplesmente não tem nada a mostrar.
      if (error && (error.code === "42P01" || error.code === "PGRST205")) return [];
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id,
        nome: c.nome,
        final: c.final ?? "",
        diaFechamento: c.dia_fechamento ?? null,
        diaVencimento: c.dia_vencimento ?? null,
        ativo: !!c.ativo,
      }));
    },
    enabled: !!empresaId,
  });
}

export function useSaveCartao() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ id, input }: { id?: string; input: CartaoInput }): Promise<string> => {
      const row = {
        nome: input.nome.trim(),
        final: input.final.trim() || null,
        dia_fechamento: input.diaFechamento,
        dia_vencimento: input.diaVencimento,
        ativo: input.ativo,
      };
      if (id) {
        const { error } = await supabase.from("cartoes").update(row).eq("id", id).eq("empresa_id", getEmpresaId());
        if (error) throw error;
        return id;
      }
      // Devolve o id: a importação cadastra o cartão e já manda o extrato para ele.
      const { data, error } = await supabase
        .from("cartoes")
        .insert({ ...row, empresa_id: getEmpresaId() })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cartoes"] }),
  });
}

// Desativa em vez de apagar: as despesas já ligadas continuam apontando para
// ele, e o histórico não perde a referência.
export function useDesativarCartao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("cartoes").update({ ativo }).eq("id", id).eq("empresa_id", getEmpresaId());
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cartoes"] }),
  });
}

// ─── Extrato do cartão (migração 53) ────────────────────────
// As compras que o extrato do cartão traz. Ficam FORA de movimentacoes: a
// fatura paga (no extrato do banco) é a saída de caixa; isto é o detalhe dela.
export type CartaoLancamento = {
  id: string;
  cartaoId: string;
  dataISO: string;
  descricao: string;
  valor: number;
  tipo: "in" | "out"; // out = compra; in = estorno/pagamento
  categoria: string;  // caminho "Pai / Filho"; "" = sem categoria
  fitid: string | null;
};

const semTabelaCartao = (code?: string) => code === "42P01" || code === "PGRST205";

export function useCartaoLancamentos() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["cartao_lancamentos", empresaId],
    queryFn: async (): Promise<CartaoLancamento[]> => {
      const eid = getEmpresaId();
      let data: Record<string, unknown>[];
      try {
        data = await paginarTudo((de, ate) =>
          supabase
            .from("cartao_lancamentos")
            .select("id, cartao_id, data, descricao, valor, tipo, categoria, fitid")
            .eq("empresa_id", eid)
            .order("data", { ascending: false })
            .order("id", { ascending: false })
            .range(de, ate),
        );
      } catch (e) {
        // Sem a migração 53 o demonstrativo só não tem compras para mostrar.
        if (semTabelaCartao((e as { code?: string })?.code)) return [];
        throw e;
      }
      return data.map((m) => ({
        id: String(m.id),
        cartaoId: String(m.cartao_id),
        dataISO: String(m.data),
        descricao: String(m.descricao ?? ""),
        valor: Number(m.valor),
        tipo: m.tipo as "in" | "out",
        categoria: (m.categoria as string | null) ?? "",
        fitid: (m.fitid as string | null) ?? null,
      }));
    },
    enabled: !!empresaId,
  });
}

// O que já está gravado no cartão num intervalo — para a importação marcar as
// repetidas (mesmo FITID ou mesmo dia+valor+tipo+descrição) e para sugerir a
// categoria que a mesma descrição já recebeu antes.
export async function fetchCartaoLancamentosIntervalo(cartaoId: string, deISO: string, ateISO: string): Promise<MovConta[]> {
  const data = await paginarTudo((de, ate) =>
    supabase
      .from("cartao_lancamentos")
      .select("id, data, descricao, valor, tipo, fitid")
      .eq("empresa_id", getEmpresaId())
      .eq("cartao_id", cartaoId)
      .gte("data", deISO)
      .lte("data", ateISO)
      .order("data", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate),
  );
  return data.map((m) => ({
    id: m.id,
    dataISO: m.data,
    valor: Number(m.valor),
    tipo: m.tipo as "in" | "out",
    descricao: m.descricao ?? "",
    fitid: m.fitid ?? null,
  }));
}

export type ImportCartaoRow = {
  data: string;
  descricao: string;
  valor: number;
  tipo: "in" | "out";
  fitid?: string | null;
  categoria?: string | null; // caminho "Pai / Filho"
};

export function useImportCartao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cartaoId, rows }: { cartaoId: string; rows: ImportCartaoRow[] }) => {
      if (rows.length === 0) return { inserted: 0, skipped: 0 };
      const eid = getEmpresaId();
      const loteId = crypto.randomUUID();

      // Mesma rede de segurança da importação do banco: tira os FITIDs que já
      // estão no cartão (o índice único derrubaria o lote inteiro).
      const fitids = [...new Set(rows.map((r) => r.fitid).filter((f): f is string => !!f))];
      const jaExistem = new Set<string>();
      for (let i = 0; i < fitids.length; i += FITID_CHUNK) {
        const { data, error } = await supabase
          .from("cartao_lancamentos")
          .select("fitid")
          .eq("empresa_id", eid)
          .eq("cartao_id", cartaoId)
          .in("fitid", fitids.slice(i, i + FITID_CHUNK));
        if (error) throw error;
        for (const r of data ?? []) if (r.fitid) jaExistem.add(r.fitid as string);
      }
      const noLote = new Set<string>();
      const novas = rows.filter((r) => {
        if (!r.fitid) return true;
        if (jaExistem.has(r.fitid) || noLote.has(r.fitid)) return false;
        noLote.add(r.fitid);
        return true;
      });
      if (novas.length === 0) return { inserted: 0, skipped: rows.length };

      const { error } = await supabase.from("cartao_lancamentos").insert(
        novas.map((r) => ({
          empresa_id: eid,
          cartao_id: cartaoId,
          data: r.data,
          descricao: r.descricao,
          valor: Math.abs(r.valor),
          tipo: r.tipo,
          categoria: r.categoria || null,
          fitid: r.fitid ?? null,
          lote_id: loteId,
        })),
      );
      if (error) {
        if (semTabelaCartao(error.code)) {
          throw new Error("A tabela do extrato do cartão ainda não existe: rode supabase/53_cartao_lancamentos.sql no SQL Editor.");
        }
        throw error;
      }
      return { inserted: novas.length, skipped: rows.length - novas.length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cartao_lancamentos"] }),
  });
}

export function useSetCategoriaCartaoLancamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, categoria }: { ids: string[]; categoria: string }) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("cartao_lancamentos")
        .update({ categoria: categoria || null })
        .eq("empresa_id", getEmpresaId())
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cartao_lancamentos"] }),
  });
}

export function useDeleteCartaoLancamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cartao_lancamentos").delete().eq("empresa_id", getEmpresaId()).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cartao_lancamentos"] }),
  });
}

// ─── Previstos (pagamentos previstos) ───────────────────────
// Código de pagamento: boleto (linha digitável) ou PIX (copia-e-cola/chave).
// Um pagamento grande pode ter vários (boleto fracionado em mais de um código).
export type Boleto = { tipo: "boleto" | "pix"; codigo: string };

export type Previsto = {
  id: string;
  data: string; // YYYY-MM-DD
  descricao: string;
  categoria: string;
  valor: number;
  tipo: "in" | "out";
  recorrenteId: string | null; // nulo = avulso; preenchido = gerado por recorrência
  boletos: Boleto[];
  // Status de pagamento (relevante p/ saídas na tela Contas a Pagar).
  pago: boolean;
  pagoEm: string | null;
  pagoValor: number | null;
  cartaoId: string | null;   // em que cartão cai (migração 51)
};

export async function fetchPrevistos(): Promise<Previsto[]> {
  const eid = getEmpresaId();
  const data = await paginarTudo((de, ate) =>
    supabase
      .from("previstos")
      .select("id, data, descricao, categoria, valor, tipo, recorrente_id, boletos, pago, pago_em, pago_valor, cartao_id")
      .eq("empresa_id", eid)
      .order("data", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate)
  );
  return data.map((p) => ({
    id: p.id,
    data: p.data,
    descricao: p.descricao,
    categoria: p.categoria ?? "",
    valor: Number(p.valor),
    tipo: p.tipo as "in" | "out",
    recorrenteId: p.recorrente_id ?? null,
    boletos: (p.boletos as Boleto[] | null) ?? [],
    pago: !!p.pago,
    pagoEm: p.pago_em ?? null,
    pagoValor: p.pago_valor === null || p.pago_valor === undefined ? null : Number(p.pago_valor),
    cartaoId: p.cartao_id ?? null,
  }));
}

// Status derivado de um previsto (usado na tela Contas a Pagar).
export type StatusPrevisto = "pago" | "atrasado" | "aberto";
export function statusPrevisto(p: Previsto, hojeISO: string): StatusPrevisto {
  if (p.pago) return "pago";
  if (p.data < hojeISO) return "atrasado";
  return "aberto";
}

export function usePrevistos() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["previstos", empresaId], queryFn: fetchPrevistos, enabled: !!empresaId });
}

export type PrevistoInput = {
  data: string;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: "in" | "out";
  boletos: Boleto[];
};

const toPrevistoRow = (i: PrevistoInput) => ({
  data: i.data,
  descricao: i.descricao,
  categoria: i.categoria || null,
  valor: Math.abs(i.valor),
  tipo: i.tipo,
  boletos: i.boletos ?? [],
});

export function useSavePrevisto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: PrevistoInput }) => {
      if (id) {
        const { error } = await supabase.from("previstos").update(toPrevistoRow(input)).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("previstos").insert({ ...toPrevistoRow(input), empresa_id: getEmpresaId() });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["previstos"] }),
  });
}

export function useDeletePrevisto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("previstos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["previstos"] }),
  });
}

// Marca um previsto (conta a pagar) como PAGO manualmente. Espelha useMarcarCobrancaPaga.
export function useMarcarPrevistoPago() {
  const qc = useQueryClient();
  return useMutation({
    meta: { successMessage: "Pagamento registrado." },
    mutationFn: async ({ id, pagoEm, pagoValor }: { id: string; pagoEm: string; pagoValor: number }) => {
      const { error } = await supabase
        .from("previstos")
        .update({ pago: true, pago_em: pagoEm, pago_valor: Math.abs(pagoValor) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["previstos"] }),
  });
}

// Marca VÁRIOS previstos como pagos de uma vez, na mesma data, cada um com o
// próprio valor previsto (pago_valor = valor). O PostgREST não copia coluna
// para coluna num update só, então vai um update por conta, em paralelo por
// fatias — dezenas de contas fecham em uma rodada.
const PAGAR_LOTE_CHUNK = 20;

export function useMarcarPrevistosPagosLote() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: async ({ itens, pagoEm }: { itens: { id: string; valor: number }[]; pagoEm: string }): Promise<number> => {
      const eid = getEmpresaId();
      let feitos = 0;
      for (let i = 0; i < itens.length; i += PAGAR_LOTE_CHUNK) {
        const fatia = itens.slice(i, i + PAGAR_LOTE_CHUNK);
        const resultados = await Promise.all(
          fatia.map((p) =>
            supabase
              .from("previstos")
              .update({ pago: true, pago_em: pagoEm, pago_valor: Math.abs(p.valor) })
              .eq("id", p.id)
              .eq("empresa_id", eid)
              .eq("pago", false) // já paga em outra aba: não sobrescreve
          )
        );
        const erro = resultados.find((r) => r.error)?.error;
        if (erro) throw erro;
        feitos += fatia.length;
      }
      return feitos;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["previstos"] }),
  });
}

// Reabre um previsto pago (desfaz o pagamento).
export function useReabrirPrevisto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("previstos")
        .update({ pago: false, pago_em: null, pago_valor: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["previstos"] }),
  });
}

// Limpa os previstos vencidos da empresa atual — limpeza imediata ao abrir a tela.
// Usa a RPC fn_limpar_previstos_vencidos (mesmo predicado do job pg_cron): apaga
// entradas vencidas e saídas pagas de meses anteriores, mas PRESERVA as saídas não
// pagas (viram "atrasadas" em Contas a Pagar) e o mês corrente.
export async function apagarPrevistosVencidos(): Promise<number> {
  const { data, error } = await supabase.rpc("fn_limpar_previstos_vencidos", { p_empresa: getEmpresaId() });
  if (error) {
    // Tolerante: se a migração 27 ainda não rodou, não quebra a abertura da tela.
    console.warn("fn_limpar_previstos_vencidos indisponível:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

export function useApagarPrevistosVencidos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apagarPrevistosVencidos,
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

// ─── Recorrentes (regra mensal que gera previstos) ──────────
// Modo de vencimento: 'fixo' usa `dia` (1..28); 'dia_util' usa `diaUtilN`
// (N-ésimo dia útil, ex.: 5 = salário); 'quinzenal' usa `dia` + `dia2` (2 por mês).
export type ModoDia = "fixo" | "dia_util" | "quinzenal";

export type RecorrenteInput = {
  descricao: string;
  categoria: string;
  valor: number;
  tipo: "in" | "out";
  dia: number; // 1..28 (usado em 'fixo' e como 1º venc. no 'quinzenal')
  modoDia: ModoDia;
  diaUtilN: number | null; // usado só em 'dia_util'
  dia2: number | null; // 2º venc. (1..28), usado só em 'quinzenal'
  inicio: string; // YYYY-MM-DD (usa ano/mês)
  fim: string | null; // YYYY-MM-DD ou null = sem prazo (contínua)
  boletos: Boleto[];
  // Valor vindo do RH (migração 49): null = valor fixo digitado.
  fonteRH?: FonteRH | null;
  // Cartão em que a despesa cai (migração 51). Os pagamentos gerados herdam.
  cartaoId?: string | null;
  // Como aplicar os boletos nos previstos gerados:
  // 'todos' = mesmos códigos em todo mês; 'carne' = um por mês (na ordem).
  modoBoletos: "todos" | "carne";
};
export type Recorrente = Omit<RecorrenteInput, "modoBoletos"> & { id: string };

export async function fetchRecorrentes(): Promise<Recorrente[]> {
  const { data, error } = await supabase
    .from("recorrentes")
    .select("id, descricao, categoria, valor, tipo, dia, modo_dia, dia_util_n, dia2, inicio, fim, boletos, fonte_rh, cartao_id")
    .eq("empresa_id", getEmpresaId())
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    descricao: r.descricao,
    categoria: r.categoria ?? "",
    valor: Number(r.valor),
    tipo: r.tipo as "in" | "out",
    dia: r.dia,
    modoDia: (r.modo_dia ?? "fixo") as ModoDia,
    diaUtilN: r.dia_util_n ?? null,
    dia2: r.dia2 ?? null,
    inicio: r.inicio,
    fim: r.fim ?? null,
    boletos: (r.boletos as Boleto[] | null) ?? [],
    fonteRH: ehFonteRH(r.fonte_rh) ? r.fonte_rh : null,
    cartaoId: r.cartao_id ?? null,
  }));
}

export function useRecorrentes() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["recorrentes", empresaId], queryFn: fetchRecorrentes, enabled: !!empresaId });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// Lista de [ano, mês] do início ao fim (inclusive), por mês.
export function mesesEntre(inicio: string, fim: string): [number, number][] {
  const [iy, im] = inicio.split("-").map(Number);
  const [fy, fm] = fim.split("-").map(Number);
  const out: [number, number][] = [];
  let y = iy, m = im;
  while (y < fy || (y === fy && m <= fm)) {
    out.push([y, m]);
    m++;
    if (m > 12) { m = 1; y++; }
    if (out.length > 240) break; // trava de segurança (20 anos)
  }
  return out;
}

// Horizonte (meses à frente) que mantemos materializado para recorrências sem prazo.
const HORIZONTE_MESES = 24;
const ymHoje = (): [number, number] => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1];
};
const addMeses = ([y, m]: [number, number], n: number): [number, number] => {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
};
const cmpYM = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
const ymDeISO = (iso: string): [number, number] => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
// Dia do vencimento como o usuário escolheu (1..31). O mês curto é resolvido
// na hora de gerar a data (isoDiaDoMes), não aqui: gravar 28 no lugar de 31
// perderia a intenção "todo dia 31 / último dia do mês".
const clampDia31 = (n: number) => Math.min(31, Math.max(1, Math.round(n)));
// Último dia do mês em ISO (usado como limite superior ao buscar feriados, para
// cobrir vencimentos que caem depois do dia 1 no último mês materializado).
const fimDoMesISO = (y: number, m: number) => `${y}-${pad2(m)}-${pad2(new Date(y, m, 0).getDate())}`;

// Datas (já ajustadas ao dia útil) que uma recorrência gera NAQUELE mês (y, m):
// 1 data em 'fixo'/'dia_util'; até 2 em 'quinzenal'. Usa nthDiaUtil (conta p/ FRENTE)
// no modo dia útil, e diaUtilAnterior (antecipa) nos demais. Deduplica datas iguais
// (ex.: quinzenal cujos dois dias colapsam no mesmo dia útil).
type RegraDia = { modoDia: ModoDia; dia: number; dia2: number | null; diaUtilN: number | null };
function datasDoMes(r: RegraDia, y: number, m: number, feriados: Set<string>): string[] {
  if (r.modoDia === "dia_util") {
    return [nthDiaUtil(y, m, r.diaUtilN ?? 1, feriados)];
  }
  if (r.modoDia === "quinzenal") {
    const d1 = diaUtilAnterior(isoDiaDoMes(y, m, r.dia), feriados);
    const d2 = diaUtilAnterior(isoDiaDoMes(y, m, r.dia2 ?? 28), feriados);
    return [...new Set([d1, d2])];
  }
  return [diaUtilAnterior(isoDiaDoMes(y, m, r.dia), feriados)];
}

// Conjunto de feriados (nacionais + da empresa) no intervalo [de, ate], em
// "YYYY-MM-DD". Uma única chamada; o cálculo dos nacionais mora no banco.
// Tolerante a falha: se a função ainda não existir (frontend publicado antes da
// migração 26), volta vazio — sem ajuste, como era antes — em vez de quebrar a
// criação de recorrências / a extensão dos previstos.
export async function fetchFeriadosEfetivos(de: string, ate: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("fn_feriados_efetivos", {
    p_empresa: getEmpresaId(),
    p_de: de,
    p_ate: ate,
  });
  if (error) {
    console.warn("fn_feriados_efetivos indisponível — seguindo sem ajuste de dia útil:", error.message);
    return new Set();
  }
  return new Set((data as string[] | null) ?? []);
}

export function useCreateRecorrente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecorrenteInput) => {
      const eid = getEmpresaId();
      const dia = clampDia31(input.dia);
      const { data: rec, error } = await supabase
        .from("recorrentes")
        .insert({
          empresa_id: eid,
          descricao: input.descricao,
          categoria: input.categoria || null,
          valor: Math.abs(input.valor),
          tipo: input.tipo,
          dia,
          modo_dia: input.modoDia,
          dia_util_n: input.modoDia === "dia_util" ? (input.diaUtilN ?? 1) : null,
          dia2: input.modoDia === "quinzenal" ? clampDia31(input.dia2 ?? 28) : null,
          inicio: input.inicio,
          fim: input.fim,
          boletos: input.boletos ?? [],
          fonte_rh: input.fonteRH ?? null,
          cartao_id: input.cartaoId ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Fim efetivo da materialização: data informada, ou o horizonte (sem prazo).
      const inicioYM = ymDeISO(input.inicio);
      const horizonte = addMeses(ymHoje(), HORIZONTE_MESES);
      const fimYM = input.fim
        ? ymDeISO(input.fim)
        : cmpYM(inicioYM, horizonte) > 0 ? inicioYM : horizonte;
      const fimISO = `${fimYM[0]}-${pad2(fimYM[1])}-01`;

      // Feriados do período p/ antecipar vencimentos que caem em dia não útil.
      const feriados = await fetchFeriadosEfetivos(input.inicio, fimDoMesISO(fimYM[0], fimYM[1]));

      // Materializa os previstos do período (1 ou 2 por mês, conforme o modo), com os
      // boletos: 'carne' = um boleto por mês (na ordem); 'todos' = mesmos em todo mês.
      // Quinzenal (2/mês) não casa com 'carne' → força 'todos'.
      const regra: RegraDia = { modoDia: input.modoDia, dia, dia2: input.dia2, diaUtilN: input.diaUtilN };
      const todosBoletos = input.boletos ?? [];
      const modoBoletos = input.modoDia === "quinzenal" ? "todos" : input.modoBoletos;
      const rows = mesesEntre(input.inicio, fimISO).flatMap(([y, m], i) =>
        datasDoMes(regra, y, m, feriados).map((data) => ({
          empresa_id: eid,
          data,
          descricao: input.descricao,
          categoria: input.categoria || null,
          valor: Math.abs(input.valor),
          tipo: input.tipo,
          recorrente_id: rec.id as string,
          boletos: modoBoletos === "carne" ? (todosBoletos[i] ? [todosBoletos[i]] : []) : todosBoletos,
          cartao_id: input.cartaoId ?? null,
        }))
      );
      if (rows.length) {
        const { error: e2 } = await supabase.from("previstos").insert(rows);
        if (e2) {
          // Evita recorrência órfã: desfaz a recorrência se a geração dos previstos falhar.
          await supabase.from("recorrentes").delete().eq("id", rec.id as string);
          throw e2;
        }
      }
      return rows.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recorrentes"] });
      qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

// Edita uma recorrência e propaga para os pagamentos EM ABERTO (os já pagos
// são histórico e não mudam):
//   • valor/descrição/categoria/tipo → atualizados em lugar;
//   • dia/período (ou boletos em modo carnê) → os em aberto são apagados e
//     regerados, pulando meses que já têm pagamento feito.
export function useUpdateRecorrente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      { id, input }: { id: string; input: RecorrenteInput }
    ): Promise<{ atualizados: number; regerados: number }> => {
      const eid = getEmpresaId();
      const { data: atualRow, error: e0 } = await supabase
        .from("recorrentes")
        .select("dia, modo_dia, dia_util_n, dia2, inicio, fim, boletos")
        .eq("id", id)
        .eq("empresa_id", eid)
        .single();
      if (e0) throw e0;
      const atual = {
        dia: atualRow.dia as number,
        modoDia: (atualRow.modo_dia ?? "fixo") as ModoDia,
        diaUtilN: (atualRow.dia_util_n ?? null) as number | null,
        dia2: (atualRow.dia2 ?? null) as number | null,
        inicio: atualRow.inicio as string,
        fim: (atualRow.fim ?? null) as string | null,
        boletos: ((atualRow.boletos as Boleto[] | null) ?? []),
      };

      const dia = clampDia31(input.dia);
      const { error } = await supabase
        .from("recorrentes")
        .update({
          descricao: input.descricao,
          categoria: input.categoria || null,
          valor: Math.abs(input.valor),
          tipo: input.tipo,
          dia,
          modo_dia: input.modoDia,
          dia_util_n: input.modoDia === "dia_util" ? (input.diaUtilN ?? 1) : null,
          dia2: input.modoDia === "quinzenal" ? clampDia31(input.dia2 ?? 28) : null,
          inicio: input.inicio,
          fim: input.fim,
          boletos: input.boletos ?? [],
          fonte_rh: input.fonteRH ?? null,
          cartao_id: input.cartaoId ?? null,
        })
        .eq("id", id)
        .eq("empresa_id", eid);
      if (error) throw error;

      const boletosMudaram = JSON.stringify(input.boletos ?? []) !== JSON.stringify(atual.boletos);
      const modoBoletos = input.modoDia === "quinzenal" ? "todos" : input.modoBoletos;
      const regerar = regraDatasMudou(atual, { ...input, dia }) || (boletosMudaram && modoBoletos === "carne");

      if (!regerar) {
        // Só campos: atualiza em lugar, preservando datas e boletos de cada mês.
        const patch: Record<string, unknown> = {
          descricao: input.descricao,
          categoria: input.categoria || null,
          valor: Math.abs(input.valor),
          tipo: input.tipo,
        };
        if (boletosMudaram) patch.boletos = input.boletos ?? [];
        const { count, error: e1 } = await supabase
          .from("previstos")
          .update(patch, { count: "exact" })
          .eq("empresa_id", eid)
          .eq("recorrente_id", id)
          .eq("pago", false);
        if (e1) throw e1;
        return { atualizados: count ?? 0, regerados: 0 };
      }

      // Regera: apaga os em aberto e materializa de novo, pulando meses pagos.
      const { data: pagos, error: e2 } = await supabase
        .from("previstos")
        .select("data")
        .eq("empresa_id", eid)
        .eq("recorrente_id", id)
        .eq("pago", true);
      if (e2) throw e2;
      const mesesPagos = new Set((pagos ?? []).map((p) => String(p.data).slice(0, 7)));

      const { error: e3 } = await supabase
        .from("previstos")
        .delete()
        .eq("empresa_id", eid)
        .eq("recorrente_id", id)
        .eq("pago", false);
      if (e3) throw e3;

      const inicioYM = ymDeISO(input.inicio);
      const horizonte = addMeses(ymHoje(), HORIZONTE_MESES);
      const fimYM = input.fim
        ? ymDeISO(input.fim)
        : cmpYM(inicioYM, horizonte) > 0 ? inicioYM : horizonte;
      const fimISO = `${fimYM[0]}-${pad2(fimYM[1])}-01`;
      const feriados = await fetchFeriadosEfetivos(input.inicio, fimDoMesISO(fimYM[0], fimYM[1]));
      const regra: RegraDia = { modoDia: input.modoDia, dia, dia2: input.dia2, diaUtilN: input.diaUtilN };
      const todosBoletos = input.boletos ?? [];
      const rows = mesesEntre(input.inicio, fimISO).flatMap(([y, m], i) => {
        if (mesesPagos.has(`${y}-${pad2(m)}`)) return []; // mês já pago: não mexe
        return datasDoMes(regra, y, m, feriados).map((data) => ({
          empresa_id: eid,
          data,
          descricao: input.descricao,
          categoria: input.categoria || null,
          valor: Math.abs(input.valor),
          tipo: input.tipo,
          recorrente_id: id,
          boletos: modoBoletos === "carne" ? (todosBoletos[i] ? [todosBoletos[i]] : []) : todosBoletos,
          cartao_id: input.cartaoId ?? null,
        }));
      });
      if (rows.length) {
        const { error: e4 } = await supabase.from("previstos").insert(rows);
        if (e4) throw e4;
      }
      return { atualizados: 0, regerados: rows.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recorrentes"] });
      qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

export function useDeleteRecorrente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // ON DELETE CASCADE remove os previstos gerados por esta recorrência.
      const { error } = await supabase.from("recorrentes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recorrentes"] });
      qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

// Reconcilia os previstos FUTUROS de TODAS as recorrências com a regra atual:
// mantém as SEM PRAZO com ~HORIZONTE_MESES à frente e corrige as COM PRAZO
// quando a regra de data muda (ex.: a contagem do N-ésimo dia útil passou a
// incluir sábado). Idempotente: só insere o que falta e só apaga o que a regra
// não gera mais. Pagos e vencidos (< hoje) nunca são tocados.
export async function reconciliarRecorrentes(): Promise<number> {
  const eid = getEmpresaId();
  const { data: recs, error } = await supabase
    .from("recorrentes")
    .select("id, descricao, categoria, valor, tipo, dia, modo_dia, dia_util_n, dia2, inicio, fim, boletos, fonte_rh, cartao_id")
    .eq("empresa_id", eid);
  if (error) throw error;
  if (!recs || recs.length === 0) return 0;

  const ids = recs.map((r) => r.id);
  // Paginado: cortar aqui faria a reconciliação achar que faltam previstos
  // que já existem, e reinserir duplicata em cima do que estava certo.
  const prev = await paginarTudo((de, ate) =>
    supabase
      .from("previstos")
      .select("id, recorrente_id, data, pago, valor")
      .eq("empresa_id", eid)
      .in("recorrente_id", ids)
      .order("data", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate)
  );

  const horizonte = addMeses(ymHoje(), HORIZONTE_MESES);
  const hoje = hojeISO();

  // Até onde materializar cada recorrência: as COM PRAZO vão até `fim` (foram
  // geradas inteiras na criação, então reconciliamos todo o resto da vida
  // delas); as SEM PRAZO, até o horizonte móvel. O teto de 240 meses espelha a
  // trava de mesesEntre() usada na criação — sem ele uma recorrência com `fim`
  // muito distante geraria aqui mais previstos do que a criação materializou.
  const tetoLongo = addMeses(ymHoje(), 240);
  const limites = new Map<string, [number, number]>();
  for (const r of recs) {
    const fimYM = r.fim ? ymDeISO(r.fim as string) : null;
    limites.set(r.id as string, fimYM ? (cmpYM(fimYM, tetoLongo) > 0 ? tetoLongo : fimYM) : horizonte);
  }
  // Feriados de TODO o intervalo gerado — 1 chamada. Vai até o maior limite (não
  // só o horizonte): com um `fim` distante, buscar de menos deixaria os meses
  // finais sem feriado e produziria datas diferentes das já materializadas.
  const maxLimite = [...limites.values()].reduce((a, b) => (cmpYM(a, b) > 0 ? a : b), horizonte);
  const feriados = await fetchFeriadosEfetivos(
    `${ymHoje()[0]}-${pad2(ymHoje()[1])}-01`,
    fimDoMesISO(maxLimite[0], maxLimite[1]),
  );

  // Reconciliação por regra: a partir de HOJE, o conjunto de datas geradas pela
  // recorrência é a "verdade". Insere as que faltam e APAGA previstos futuros
  // (>= hoje) NÃO pagos que não são mais gerados pela regra — necessário porque
  // uma mudança de convenção de dia útil muda a data, e senão duplicaria.
  // Pagos e vencidos (< hoje) são sempre preservados.
  const existentesPorRec = new Map<string, Map<string, { id: string; pago: boolean; valor: number }>>();
  for (const p of prev ?? []) {
    const m = existentesPorRec.get(p.recorrente_id) ?? new Map<string, { id: string; pago: boolean; valor: number }>();
    m.set(p.data, { id: p.id as string, pago: !!p.pago, valor: Number(p.valor ?? 0) });
    existentesPorRec.set(p.recorrente_id, m);
  }

  // Recorrências que tiram o valor do RH (migração 49): busca os totais de todo
  // o intervalo de uma vez. Sem os totais (RH fora do ar, migração não rodada,
  // cargo sem direito), o valor que já está gravado é mantido — nunca zerado.
  const comFonteRH = recs.filter((r) => ehFonteRH(r.fonte_rh));
  const totaisRH = comFonteRH.length
    ? porCompetencia(
        (await fetchTotaisRH(`${ymHoje()[0]}-${pad2(ymHoje()[1])}-01`, fimDoMesISO(maxLimite[0], maxLimite[1]))).itens,
      )
    : new Map<string, TotaisRH>();
  // Valor de uma recorrência numa data: o do RH quando ela é ligada, senão o dela.
  const valorNaData = (r: { valor: unknown; fonte_rh?: unknown }, data: string): number => {
    const fixo = Math.abs(Number(r.valor));
    if (!ehFonteRH(r.fonte_rh)) return fixo;
    const doRH = valorDaFonte(totaisRH.get(data.slice(0, 7)), r.fonte_rh);
    return doRH == null ? fixo : Math.abs(doRH);
  };
  // Previstos em aberto de recorrência ligada ao RH que estão com valor velho.
  const aAtualizar: { id: string; valor: number }[] = [];

  const idsApagar: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  for (const r of recs) {
    const regra: RegraDia = {
      modoDia: (r.modo_dia ?? "fixo") as ModoDia,
      dia: clampDia31(r.dia),
      dia2: r.dia2 ?? null,
      diaUtilN: r.dia_util_n ?? null,
    };
    const limite = limites.get(r.id as string) ?? horizonte;
    const fimJanelaISO = fimDoMesISO(limite[0], limite[1]);

    // Datas esperadas (>= hoje), do mês corrente (ou início) até o limite.
    const esperadas = new Set<string>();
    let cur = ymHoje();
    const inicioYM = ymDeISO(r.inicio);
    if (cmpYM(inicioYM, cur) > 0) cur = inicioYM;
    while (cmpYM(cur, limite) <= 0) {
      for (const data of datasDoMes(regra, cur[0], cur[1], feriados)) {
        if (data >= hoje) esperadas.add(data);
      }
      cur = addMeses(cur, 1);
      if (esperadas.size > 5000) break; // trava de segurança
    }

    const existentes = existentesPorRec.get(r.id) ?? new Map<string, { id: string; pago: boolean; valor: number }>();
    // Apaga futuras não pagas fora do esperado (convenção antiga / órfãs).
    // Só DENTRO da janela reconciliada: fora dela não recalculamos nada, e
    // apagar seria perder previstos legítimos já materializados.
    for (const [data, info] of existentes) {
      if (data >= hoje && data <= fimJanelaISO && !info.pago && !esperadas.has(data)) idsApagar.push(info.id);
    }
    // Insere as esperadas que ainda não existem.
    for (const data of esperadas) {
      const existente = existentes.get(data);
      if (!existente) {
        rows.push({
          empresa_id: eid,
          data,
          descricao: r.descricao,
          categoria: r.categoria ?? null,
          valor: valorNaData(r, data),
          tipo: r.tipo,
          recorrente_id: r.id,
          boletos: (r.boletos as Boleto[] | null) ?? [],
          cartao_id: r.cartao_id ?? null,
        });
      } else if (ehFonteRH(r.fonte_rh) && !existente.pago) {
        // O valor vem do RH: a conta em aberto acompanha. Conta PAGA nunca é
        // tocada — o que foi pago, foi pago.
        const novo = valorNaData(r, data);
        if (Math.abs(novo - existente.valor) > 0.005) aAtualizar.push({ id: existente.id, valor: novo });
      }
    }
  }

  for (const { id, valor } of aAtualizar) {
    const { error: eUp } = await supabase.from("previstos").update({ valor }).eq("id", id).eq("pago", false);
    if (eUp) throw eUp;
  }

  if (idsApagar.length) {
    const { error: eDel } = await supabase.from("previstos").delete().in("id", idsApagar);
    if (eDel) throw eDel;
  }
  if (rows.length) {
    const { error: e3 } = await supabase.from("previstos").insert(rows);
    if (e3) throw e3;
  }
  return rows.length + aAtualizar.length;
}

export function useReconciliarRecorrentes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reconciliarRecorrentes,
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

// Remove recorrências DUPLICADAS (mesma descrição + valor + tipo) mantendo uma de
// cada. Segurança: nunca apaga uma recorrência que já tenha algum previsto PAGO
// (preserva o histórico de pagamento); entre as sem pagamento, mantém a mais antiga
// e apaga o resto (cascade remove os previstos delas). Retorna quantas apagou.
export async function limparRecorrentesDuplicadas(): Promise<number> {
  const eid = getEmpresaId();
  const { data: recs, error } = await supabase
    .from("recorrentes")
    .select("id, descricao, valor, tipo, criado_em")
    .eq("empresa_id", eid);
  if (error) throw error;
  if (!recs || recs.length < 2) return 0;

  // Quais recorrências têm ao menos um previsto pago (não podem ser apagadas).
  const ids = recs.map((r) => r.id);
  const { data: pagos, error: e2 } = await supabase
    .from("previstos")
    .select("recorrente_id")
    .eq("empresa_id", eid)
    .eq("pago", true)
    .in("recorrente_id", ids);
  if (e2) throw e2;
  const temPago = new Set((pagos ?? []).map((p) => p.recorrente_id as string));

  // Agrupa por identidade da conta (descrição normalizada + valor + tipo).
  const grupos = new Map<string, typeof recs>();
  for (const r of recs) {
    const chave = `${norm(r.descricao ?? "")}|${Number(r.valor).toFixed(2)}|${r.tipo}`;
    const arr = grupos.get(chave);
    if (arr) arr.push(r);
    else grupos.set(chave, [r]);
  }

  const idsApagar: string[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const semPago = grupo
      .filter((r) => !temPago.has(r.id))
      .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
    const comPago = grupo.filter((r) => temPago.has(r.id));
    // Se nenhuma tem pagamento, mantém a mais antiga; senão as com pagamento são
    // as "canônicas" e todas as sem pagamento (puras duplicatas) podem sair.
    const manterUmaSemPago = comPago.length === 0;
    const apagaveis = manterUmaSemPago ? semPago.slice(1) : semPago;
    idsApagar.push(...apagaveis.map((r) => r.id as string));
  }

  if (idsApagar.length) {
    const { error: eDel } = await supabase.from("recorrentes").delete().in("id", idsApagar);
    if (eDel) throw eDel;
  }
  return idsApagar.length;
}

export function useLimparRecorrentesDuplicadas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: limparRecorrentesDuplicadas,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recorrentes"] });
      qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

// Exclusão em massa em Contas a Pagar: apaga recorrências inteiras (cascade nos
// previstos) e/ou ocorrências avulsas, conforme a seleção.
export function useExcluirEmMassa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recorrenteIds = [], previstoIds = [] }: { recorrenteIds?: string[]; previstoIds?: string[] }) => {
      const eid = getEmpresaId();
      if (recorrenteIds.length) {
        const { error } = await supabase.from("recorrentes").delete().eq("empresa_id", eid).in("id", recorrenteIds);
        if (error) throw error;
      }
      if (previstoIds.length) {
        const { error } = await supabase.from("previstos").delete().eq("empresa_id", eid).in("id", previstoIds);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recorrentes"] });
      qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

// Cria VÁRIAS recorrências de uma vez (importação de planilha de Contas a Pagar) e
// materializa os previstos de todas. IDs gerados no cliente (crypto.randomUUID) p/ não
// depender da ordem de retorno do insert. Rollback best-effort: se a inserção dos
// previstos falhar, apaga as recorrências recém-criadas. Retorna quantas regras criou.
export function useCreateRecorrentesLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inputs: RecorrenteInput[]): Promise<number> => {
      const eid = getEmpresaId();
      if (inputs.length === 0) return 0;

      // 1) IDs no cliente + insert em massa das regras.
      const recRows = inputs.map((input) => ({
        id: crypto.randomUUID(),
        empresa_id: eid,
        descricao: input.descricao,
        categoria: input.categoria || null,
        valor: Math.abs(input.valor),
        tipo: input.tipo,
        dia: clampDia31(input.dia),
        modo_dia: input.modoDia,
        dia_util_n: input.modoDia === "dia_util" ? (input.diaUtilN ?? 1) : null,
        dia2: input.modoDia === "quinzenal" ? clampDia31(input.dia2 ?? 28) : null,
        inicio: input.inicio,
        fim: input.fim,
        boletos: input.boletos ?? [],
      }));
      const { error } = await supabase.from("recorrentes").insert(recRows);
      if (error) throw error;
      const ids = recRows.map((r) => r.id);

      // 2) Feriados de todo o span [min inicio .. max fim||horizonte] — 1 chamada.
      const horizonte = addMeses(ymHoje(), HORIZONTE_MESES);
      let deMin = inputs[0].inicio;
      let ateMaxYM = horizonte;
      for (const input of inputs) {
        if (input.inicio < deMin) deMin = input.inicio;
        const fimYM = input.fim ? ymDeISO(input.fim) : horizonte;
        if (cmpYM(fimYM, ateMaxYM) > 0) ateMaxYM = fimYM;
      }
      const feriados = await fetchFeriadosEfetivos(deMin, fimDoMesISO(ateMaxYM[0], ateMaxYM[1]));

      // 3) Materializa os previstos de cada regra (1 ou 2 por mês, conforme o modo).
      const prevRows: Array<Record<string, unknown>> = [];
      inputs.forEach((input, idx) => {
        const recId = ids[idx];
        const inicioYM = ymDeISO(input.inicio);
        const fimYM = input.fim ? ymDeISO(input.fim) : cmpYM(inicioYM, horizonte) > 0 ? inicioYM : horizonte;
        const fimISO = `${fimYM[0]}-${pad2(fimYM[1])}-01`;
        const regra: RegraDia = { modoDia: input.modoDia, dia: clampDia31(input.dia), dia2: input.dia2, diaUtilN: input.diaUtilN };
        const todosBoletos = input.boletos ?? [];
        const modoBoletos = input.modoDia === "quinzenal" ? "todos" : input.modoBoletos;
        mesesEntre(input.inicio, fimISO).forEach(([y, m], i) => {
          for (const data of datasDoMes(regra, y, m, feriados)) {
            prevRows.push({
              empresa_id: eid,
              data,
              descricao: input.descricao,
              categoria: input.categoria || null,
              valor: Math.abs(input.valor),
              tipo: input.tipo,
              recorrente_id: recId,
              boletos: modoBoletos === "carne" ? (todosBoletos[i] ? [todosBoletos[i]] : []) : todosBoletos,
          cartao_id: input.cartaoId ?? null,
            });
          }
        });
      });

      // 4) Insert em massa dos previstos; rollback das regras se falhar.
      if (prevRows.length) {
        const { error: e2 } = await supabase.from("previstos").insert(prevRows);
        if (e2) {
          await supabase.from("recorrentes").delete().in("id", ids);
          throw e2;
        }
      }
      return ids.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recorrentes"] });
      qc.invalidateQueries({ queryKey: ["previstos"] });
    },
  });
}

// ─── Feriados da empresa (calendário de dias úteis) ─────────
// Complementam os feriados nacionais (calculados no banco) para o ajuste
// automático de vencimentos ao dia útil anterior.
export type Feriado = { id: string; data: string; nome: string };

export async function fetchFeriados(): Promise<Feriado[]> {
  const { data, error } = await supabase
    .from("feriados")
    .select("id, data, nome")
    .eq("empresa_id", getEmpresaId())
    .order("data", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((f) => ({ id: f.id, data: f.data, nome: f.nome ?? "" }));
}

export function useFeriados() {
  const { empresaId } = useEmpresa();
  return useQuery({ queryKey: ["feriados", empresaId], queryFn: fetchFeriados, enabled: !!empresaId });
}

export function useAddFeriado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data, nome }: { data: string; nome: string }) => {
      const { error } = await supabase
        .from("feriados")
        .insert({ empresa_id: getEmpresaId(), data, nome: nome.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feriados"] }),
  });
}

export function useDeleteFeriado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("feriados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feriados"] }),
  });
}

// Reaplica o ajuste de dia útil aos previstos/cobranças FUTUROS já gravados.
// Útil depois de cadastrar/remover um feriado. Retorna quantos registros mudaram.
export function useReajustarDiaUtil() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("fn_ajustar_dia_util", { p_empresa: getEmpresaId() });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["previstos"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
    },
  });
}


// ─── Usuários (cadastro dos logins) ─────────────────────────
// Migração 40 + função server-side /api/usuarios. A LISTA vem de uma RPC
// (dá para ler no navegador); CRIAR e ALTERAR passam pela função na Vercel,
// porque e-mail e senha vivem em auth.users e só a Admin API do Supabase
// mexe neles — ela exige a service role, que nunca desce para o browser.
export type VinculoUsuario = { empresaId: string; empresa: string; papel: string };

export type Usuario = {
  userId: string;
  email: string;
  nome: string;
  isMaster: boolean;
  criadoEm: string;
  ultimoLogin: string | null;
  vinculos: VinculoUsuario[];
};

export async function fetchUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase.rpc("listar_usuarios_gerenciaveis");
  if (error) {
    if (error.code === "PGRST202" || /listar_usuarios_gerenciaveis/.test(error.message ?? ""))
      throw new Error("Função não instalada. Rode supabase/40_usuarios.sql no SQL Editor e recarregue.");
    throw error;
  }
  type Row = {
    user_id: string; email: string; nome: string | null; is_master: boolean;
    criado_em: string; ultimo_login: string | null; vinculos: VinculoUsuario[] | null;
  };
  return ((data ?? []) as Row[]).map((u) => ({
    userId: u.user_id,
    email: u.email,
    nome: u.nome ?? "",
    isMaster: !!u.is_master,
    criadoEm: u.criado_em,
    ultimoLogin: u.ultimo_login,
    vinculos: u.vinculos ?? [],
  }));
}

// `habilitado` vem da tela (master ou admin): sem isso a RPC devolveria lista
// vazia para todo mundo e a tela pareceria quebrada em vez de restrita.
export function useUsuarios(habilitado: boolean) {
  return useQuery({ queryKey: ["usuarios"], queryFn: fetchUsuarios, enabled: habilitado });
}

// Quem entra no RH (tabela rh_acessos, migração 42). Só o master lê a lista
// inteira e altera; cada pessoa lê a própria linha (EmpresaProvider).
// empresas: null = todas as empresas do RH.
export type AcessoRHUsuario = { userId: string; perfil: string | null; empresas: string[] | null };

export async function fetchAcessosRH(): Promise<{ disponivel: boolean; itens: AcessoRHUsuario[] }> {
  const { data, error } = await supabase.from("rh_acessos").select("*");
  // Tabela ainda não criada: o acesso ao RH simplesmente não aparece.
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return { disponivel: false, itens: [] };
  if (error) throw error;
  type Linha = { user_id: string; perfil: string | null; empresas?: string[] | null; empresa?: string | null };
  return {
    disponivel: true,
    itens: ((data ?? []) as Linha[]).map((r) => ({
      userId: r.user_id,
      perfil: r.perfil,
      // Aceita a coluna antiga (uma empresa só), de antes da migração 44.
      empresas: Array.isArray(r.empresas) && r.empresas.length > 0 ? r.empresas : r.empresa ? [r.empresa] : null,
    })),
  };
}

export function useAcessosRH(habilitado: boolean) {
  return useQuery({ queryKey: ["rh-acessos"], queryFn: fetchAcessosRH, enabled: habilitado });
}

// Quem foi liberado para a Gestão sem ser Administrador (tabela gestao_acessos,
// migração 54). Mesmo desenho do RH: só o master lê a lista e altera.
export async function fetchAcessosGestao(): Promise<{ disponivel: boolean; ids: Set<string> }> {
  const { data, error } = await supabase.from("gestao_acessos").select("user_id");
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return { disponivel: false, ids: new Set() };
  if (error) throw error;
  return { disponivel: true, ids: new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id)) };
}

export function useAcessosGestao(habilitado: boolean) {
  return useQuery({ queryKey: ["gestao-acessos"], queryFn: fetchAcessosGestao, enabled: habilitado });
}

// Acessos de uma pessoa, de uma vez (Configurações › Usuários › Acessos; só o master):
//   financeiro: empresa → cargo (null = sem acesso), só empresas com o Financeiro;
//   rh: null = sem RH; empresas null = todas;
//   gestao: liberado para a Gestão sem ser Administrador (migração 54);
//   admin: administração (Empresas e cargos) = master (migração 45).
export type AcessosUsuarioInput = {
  usuario: Usuario;
  financeiro: Record<string, string | null>;
  rhAntes: AcessoRHUsuario | null;
  rh: { perfil: string | null; empresas: string[] | null } | null;
  gestaoAntes?: boolean;
  gestao?: boolean; // undefined = não mexe (tabela ainda não existe)
  admin: boolean;
};

export function useSalvarAcessosUsuario() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true, successMessage: "Acessos atualizados." },
    mutationFn: async ({ usuario, financeiro, rhAntes, rh, gestaoAntes, gestao, admin }: AcessosUsuarioInput) => {
      const conferir = (etapa: string, error: { message?: string; code?: string } | null) => {
        if (!error) return;
        if (error.code === "PGRST202") throw new Error(`${etapa}: função não instalada no banco (rode as migrações 44 e 45).`);
        throw new Error(`${etapa}: ${error.message ?? "erro ao salvar"}`);
      };

      for (const [empresaId, papel] of Object.entries(financeiro)) {
        const antes = usuario.vinculos.find((v) => v.empresaId === empresaId)?.papel ?? null;
        if (antes === papel) continue;
        if (!papel) {
          const { error } = await supabase.from("empresa_membros").delete()
            .eq("empresa_id", empresaId).eq("user_id", usuario.userId);
          conferir("Financeiro", error);
        } else if (!antes) {
          const { error } = await supabase.rpc("vincular_membro_por_email", {
            p_empresa: empresaId, p_email: usuario.email, p_papel: papel,
          });
          conferir("Financeiro", error);
        } else {
          const { error } = await supabase.rpc("definir_papel_membro", {
            p_empresa: empresaId, p_user: usuario.userId, p_papel: papel,
          });
          conferir("Financeiro", error);
        }
      }

      const mesmaLista = (a: string[] | null, b: string[] | null) => JSON.stringify(a) === JSON.stringify(b);
      if (!rh && rhAntes) {
        const { error } = await supabase.from("rh_acessos").delete().eq("user_id", usuario.userId);
        conferir("RH", error);
      } else if (rh && (!rhAntes || rhAntes.perfil !== rh.perfil || !mesmaLista(rhAntes.empresas, rh.empresas))) {
        const { error } = await supabase
          .from("rh_acessos")
          .upsert({ user_id: usuario.userId, perfil: rh.perfil, empresas: rh.empresas }, { onConflict: "user_id" });
        conferir("RH", error);
      }

      if (gestao !== undefined && gestao !== !!gestaoAntes) {
        const { error } = gestao
          ? await supabase.from("gestao_acessos").insert({ user_id: usuario.userId })
          : await supabase.from("gestao_acessos").delete().eq("user_id", usuario.userId);
        conferir("Gestão", error);
      }

      if (admin !== usuario.isMaster) {
        const { error } = await supabase.rpc("fn_definir_master", { p_user: usuario.userId, p_master: admin });
        conferir("Administração", error);
      }
    },
    // Mesmo se uma etapa falhar, as anteriores já valeram: recarrega tudo.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["rh-acessos"] });
      qc.invalidateQueries({ queryKey: ["gestao-acessos"] });
      qc.invalidateQueries({ queryKey: ["membros"] });
      qc.invalidateQueries({ queryKey: ["usuarios-historico"] });
    },
  });
}

// Chamada autenticada à função server-side. Traduz os dois modos de falhar
// que não são erro de negócio: função não publicada (responde HTML do app) e
// variáveis de ambiente ausentes na Vercel.
async function chamarApiUsuarios(
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>
): Promise<{ ok: true; userId?: string; reautenticar?: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre novamente.");

  // Protótipo: não há servidor — a versão simulada aplica as mesmas regras.
  if (isMock) {
    const r = await mockApiUsuarios(method, body);
    if (!r.ok) throw new Error(r.error || "Falha na operação.");
    return { ok: true, userId: r.userId, reautenticar: r.reautenticar };
  }

  const res = await fetch(urlApi("/api/usuarios"), {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let json: { ok?: boolean; error?: string; userId?: string; reautenticar?: boolean };
  try {
    json = await res.json();
  } catch {
    throw new Error(
      SEM_API_NO_APP
        ? "Este app foi gerado sem o endereço do site (VITE_API_BASE), e o cadastro de logins só funciona pela função na Vercel. Faça esta operação pelo site."
        : "A função /api/usuarios não respondeu. Ela só existe no site publicado na Vercel — em desenvolvimento local, use `vercel dev`."
    );
  }
  // A mensagem do servidor passa inteira: quando é problema de configuração,
  // ela já diz qual variável falta, em que ambiente a função rodou e o que
  // chegou até lá. Reescrever aqui só apagaria o diagnóstico.
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Falha na operação (HTTP ${res.status}).`);
  }
  return { ok: true, userId: json.userId, reautenticar: json.reautenticar };
}

export type NovoUsuarioInput = {
  email: string;
  senha: string;
  nome: string;
  empresaId: string | null; // null: login sem empresa no Financeiro (só o master)
  papel: string | null;
};

export function useCriarUsuario() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: (input: NovoUsuarioInput) => chamarApiUsuarios("POST", { ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["membros"] });
      qc.invalidateQueries({ queryKey: ["usuarios-historico"] });
    },
  });
}

export type EditarUsuarioInput = {
  userId: string;
  nome?: string;
  email?: string;
  senha?: string;   // ausente/vazia = mantém a senha atual
};

export function useAtualizarUsuario() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: (input: EditarUsuarioInput) => chamarApiUsuarios("PATCH", { ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["membros"] });
      qc.invalidateQueries({ queryKey: ["usuarios-historico"] });
    },
  });
}

// Exclui um login (só o master). O servidor grava antes, no registro de
// alterações, o que a pessoa tinha — e só então tira os acessos e o login.
export function useExcluirUsuario() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: ({ userId, motivo }: { userId: string; motivo: string }) =>
      chamarApiUsuarios("DELETE", { userId, motivo }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["rh-acessos"] });
      qc.invalidateQueries({ queryKey: ["membros"] });
      qc.invalidateQueries({ queryKey: ["usuarios-historico"] });
    },
  });
}

// Registro de alterações de usuários (migração 46). Só o master lê.
export type AcaoHistoricoUsuario =
  | "criado" | "alterado" | "acesso_financeiro" | "acesso_rh" | "acesso_gestao" | "administracao" | "excluido";

export type HistoricoUsuario = {
  id: string;
  userId: string;
  email: string;
  nome: string;
  acao: AcaoHistoricoUsuario;
  detalhes: Record<string, unknown>;
  autorEmail: string;
  ocorridoEm: string;
};

export async function fetchHistoricoUsuarios(): Promise<{ disponivel: boolean; itens: HistoricoUsuario[] }> {
  const { data, error } = await supabase
    .from("usuarios_historico")
    .select("id, user_id, email, nome, acao, detalhes, autor_email, ocorrido_em")
    .order("ocorrido_em", { ascending: false })
    .limit(1000);
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return { disponivel: false, itens: [] };
  if (error) throw error;
  type Linha = {
    id: string; user_id: string; email: string | null; nome: string | null; acao: AcaoHistoricoUsuario;
    detalhes: Record<string, unknown> | null; autor_email: string | null; ocorrido_em: string;
  };
  return {
    disponivel: true,
    itens: ((data ?? []) as Linha[]).map((h) => ({
      id: h.id,
      userId: h.user_id,
      email: h.email ?? "",
      nome: h.nome ?? "",
      acao: h.acao,
      detalhes: h.detalhes ?? {},
      autorEmail: h.autor_email ?? "",
      ocorridoEm: h.ocorrido_em,
    })),
  };
}

export function useHistoricoUsuarios(habilitado: boolean) {
  return useQuery({ queryKey: ["usuarios-historico"], queryFn: fetchHistoricoUsuarios, enabled: habilitado });
}

// ─── Ajuste do saldo inicial (só master) ────────────────────
// Migração 41. Encosta o saldo do app no saldo real do banco quando sobra
// diferença, sem depender de importar um OFX com LEDGERBAL. Mexe no
// saldo_inicial da conta — não cria lançamento —, por isso a RPC exige
// motivo e carimba quem/quando. A trava de master vive no banco: a tela
// esconder o botão não seria garantia nenhuma.
export type AjusteSaldoInput = {
  contaId: string;
  modo: "saldo" | "ajuste";  // 'saldo' = saldo real do banco; 'ajuste' = delta
  valor: number;
  dataISO: string | null;    // só no modo 'saldo'
  motivo: string;
};

export type AjusteSaldoResultado = {
  conta: string;
  antes: number;
  depois: number;
  diferenca: number;
  dataInicial: string;
};

export function useAjustarSaldoInicial() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo
    mutationFn: async (input: AjusteSaldoInput): Promise<AjusteSaldoResultado> => {
      const { data, error } = await supabase.rpc("fn_ajustar_saldo_inicial", {
        p_conta: input.contaId,
        p_modo: input.modo,
        p_valor: input.valor,
        p_data: input.modo === "saldo" ? input.dataISO : null,
        p_motivo: input.motivo,
      });
      if (error) {
        if (error.code === "PGRST202" || /fn_ajustar_saldo_inicial/.test(error.message ?? ""))
          throw new Error("Função não instalada. Rode supabase/41_ajuste_saldo_master.sql no SQL Editor.");
        throw error;
      }
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        conta: String(r.conta ?? ""),
        antes: Number(r.saldo_inicial_antes ?? 0),
        depois: Number(r.saldo_inicial_depois ?? 0),
        diferenca: Number(r.diferenca ?? 0),
        dataInicial: String(r.saldo_inicial_data ?? ""),
      };
    },
    // O saldo alimenta praticamente todas as telas: invalida tudo.
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ─── Administração de empresas (somente master) ─────────────
// modulos: "financeiro", "rh" ou os dois (migração 44).
export type EmpresaAdmin = { id: string; nome: string; criadoEm: string; modulos: string[] };
export type Membro = { userId: string; email: string; isMaster: boolean; papel: Papel };

export async function fetchEmpresasAdmin(): Promise<EmpresaAdmin[]> {
  const { data, error } = await supabase
    .from("empresas")
    .select("id, nome, criado_em, modulos")
    .order("nome", { ascending: true });
  if (!error) {
    return ((data ?? []) as { id: string; nome: string; criado_em: string; modulos: string[] | null }[]).map((e) => ({
      id: e.id, nome: e.nome, criadoEm: e.criado_em, modulos: e.modulos ?? ["financeiro", "rh"],
    }));
  }
  // Banco sem a migração 44: toda empresa vale para os dois módulos.
  const antigo = await supabase.from("empresas").select("id, nome, criado_em").order("nome", { ascending: true });
  if (antigo.error) throw antigo.error;
  return (antigo.data ?? []).map((e) => ({ id: e.id, nome: e.nome, criadoEm: e.criado_em, modulos: ["financeiro", "rh"] }));
}

export function useEmpresasAdmin() {
  return useQuery({ queryKey: ["empresas_admin"], queryFn: fetchEmpresasAdmin });
}

export function useCriarEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado no diálogo
    mutationFn: async ({ nome, modulos }: { nome: string; modulos: string[] }) => {
      const { data, error } = await supabase.rpc("criar_empresa", { p_nome: nome, p_modulos: modulos });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["empresas_admin"] }),
  });
}

// Liga/desliga Financeiro e RH numa empresa (só master; o banco não deixa
// desligar um módulo que já tem dados).
export function useDefinirModulosEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ id, modulos }: { id: string; modulos: string[] }) => {
      const { error } = await supabase.rpc("fn_definir_modulos_empresa", { p_empresa: id, p_modulos: modulos });
      if (error) {
        if (error.code === "PGRST202") throw new Error("Função não instalada. Rode supabase/44_empresas_por_modulo.sql.");
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["empresas_admin"] }),
  });
}

export function useRenomearEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await supabase.from("empresas").update({ nome }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["empresas_admin"] }),
  });
}

// Exclui a empresa INTEIRA (movimentações, clientes, plano de contas, contas
// bancárias, tudo) numa transação só, via RPC master-only. Devolve as
// contagens por tabela + total.
export function useExcluirEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro mostrado inline no diálogo de confirmação
    mutationFn: async (empresaId: string): Promise<{ total: number }> => {
      const { data, error } = await supabase.rpc("fn_excluir_empresa", { p_empresa: empresaId });
      if (error) {
        // RPC ainda não criada no banco → orienta em vez de estourar jargão.
        if (error.code === "PGRST202" || /fn_excluir_empresa/.test(error.message ?? ""))
          throw new Error("Função de exclusão não instalada. Rode supabase/36_excluir_empresa.sql no SQL Editor e tente de novo.");
        throw error;
      }
      return { total: Number((data as Record<string, unknown>)?.total ?? 0) };
    },
    // Some uma empresa inteira: invalida tudo que está em cache.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export async function fetchMembros(empresaId: string): Promise<Membro[]> {
  const { data, error } = await supabase.rpc("listar_membros", { p_empresa: empresaId });
  if (error) throw error;
  return (data ?? []).map((m: { user_id: string; email: string; is_master: boolean; papel: string }) => ({
    userId: m.user_id,
    email: m.email,
    isMaster: m.is_master,
    papel: (m.papel ?? "visualizador") as Papel,
  }));
}

export function useMembros(empresaId: string | null) {
  return useQuery({
    queryKey: ["membros", empresaId],
    queryFn: () => fetchMembros(empresaId as string),
    enabled: !!empresaId,
  });
}

export function useVincularMembro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ empresaId, email, papel }: { empresaId: string; email: string; papel: Papel }) => {
      const { error } = await supabase.rpc("vincular_membro_por_email", {
        p_empresa: empresaId,
        p_email: email,
        p_papel: papel,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["membros", vars.empresaId] }),
  });
}

// Troca o papel de um membro já vinculado (só master; a RPC valida).
export function useDefinirPapel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ empresaId, userId, papel }: { empresaId: string; userId: string; papel: Papel }) => {
      const { error } = await supabase.rpc("definir_papel_membro", {
        p_empresa: empresaId,
        p_user: userId,
        p_papel: papel,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["membros", vars.empresaId] }),
  });
}

export function useDesvincularMembro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ empresaId, userId }: { empresaId: string; userId: string }) => {
      const { error } = await supabase
        .from("empresa_membros")
        .delete()
        .eq("empresa_id", empresaId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["membros", vars.empresaId] }),
  });
}

// ─── Cargos (RBAC configurável — só master gerencia) ────────
export type Cargo = { chave: string; nome: string; isSistema: boolean; ordem: number; caps: string[] };

export async function fetchCargos(): Promise<Cargo[]> {
  const [{ data: cs, error: e1 }, { data: caps, error: e2 }] = await Promise.all([
    supabase.from("cargos").select("chave, nome, is_sistema, ordem").order("ordem", { ascending: true }),
    supabase.from("cargo_capacidades").select("cargo_chave, capacidade"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const porChave = new Map<string, Cargo>();
  for (const c of cs ?? []) porChave.set(c.chave, { chave: c.chave, nome: c.nome, isSistema: c.is_sistema, ordem: c.ordem, caps: [] });
  for (const r of caps ?? []) porChave.get(r.cargo_chave)?.caps.push(r.capacidade);
  return [...porChave.values()];
}

export function useCargos() {
  return useQuery({ queryKey: ["cargos"], queryFn: fetchCargos });
}

export function useSalvarCargo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ chave, nome, caps }: { chave: string | null; nome: string; caps: string[] }) => {
      const { error } = await supabase.rpc("salvar_cargo", { p_chave: chave, p_nome: nome, p_caps: caps });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cargos"] }),
  });
}

export function useExcluirCargo() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true }, // erro (motivo da RPC) mostrado pelo componente
    mutationFn: async (chave: string) => {
      const { error } = await supabase.rpc("excluir_cargo", { p_chave: chave });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cargos"] }),
  });
}

// ─── Integração Banco Inter (saldo + extrato via API) ───────
// Os SEGREDOS (client_secret, certificado, chave) nunca chegam ao browser:
// gravação via RPC só-master; leitura só de STATUS via fn_inter_status;
// a sincronização em si roda numa função server-side (/api/inter/sync).

export type InterStatus = {
  contaId: string;
  ativo: boolean;
  ultimoSaldo: number | null;
  ultimoSaldoEm: string | null;
  ultimaSync: string | null;
  ultimoErro: string | null;
  clientIdMask: string | null; // só o master recebe (mascarado)
};

export async function fetchInterStatus(): Promise<InterStatus[]> {
  const { data, error } = await supabase.rpc("fn_inter_status", { p_empresa: getEmpresaId() });
  if (error) throw error;
  type Row = {
    conta_id: string; ativo: boolean; ultimo_saldo: number | null; ultimo_saldo_em: string | null;
    ultima_sync: string | null; ultimo_erro: string | null; client_id_mask: string | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    contaId: r.conta_id,
    ativo: r.ativo,
    ultimoSaldo: r.ultimo_saldo,
    ultimoSaldoEm: r.ultimo_saldo_em,
    ultimaSync: r.ultima_sync,
    ultimoErro: r.ultimo_erro,
    clientIdMask: r.client_id_mask,
  }));
}

export function useInterStatus() {
  const { empresaId } = useEmpresa();
  return useQuery({
    queryKey: ["inter_status", empresaId],
    queryFn: fetchInterStatus,
    enabled: !!empresaId,
  });
}

export function useSalvarInter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      contaId: string; clientId: string; clientSecret: string;
      certPem: string; keyPem: string; contaCorrente?: string;
    }) => {
      const { error } = await supabase.rpc("fn_inter_salvar", {
        p_conta: p.contaId,
        p_client_id: p.clientId,
        p_client_secret: p.clientSecret,
        p_cert_pem: p.certPem,
        p_key_pem: p.keyPem,
        p_conta_corrente: p.contaCorrente ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inter_status"] }),
  });
}

export function useToggleInter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contaId, ativo }: { contaId: string; ativo: boolean }) => {
      const { error } = await supabase.rpc("fn_inter_toggle", { p_conta: contaId, p_ativo: ativo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inter_status"] }),
  });
}

export function useRemoverInter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contaId: string) => {
      const { error } = await supabase.rpc("fn_inter_remover", { p_conta: contaId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inter_status"] }),
  });
}

export type InterSyncResult = {
  ok: boolean;
  loteId?: string;
  inserted: number;
  skipped: number;
  saldo?: number;
  error?: string;
};

// Dispara a sincronização manual na função server-side (Vercel).
export function useInterSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contaId }: { contaId: string }): Promise<InterSyncResult> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada. Entre novamente.");
      if (isMock) {
        const r = await mockApiInterSync();
        if (!r.ok) throw new Error(r.error || "Falha na sincronização.");
        return r;
      }
      const res = await fetch(urlApi("/api/inter/sync"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contaId }),
      });
      let json: InterSyncResult;
      try {
        json = await res.json();
      } catch {
        throw new Error(`Falha na sincronização (HTTP ${res.status}).`);
      }
      if (!res.ok || !json.ok) throw new Error(json.error || `Falha na sincronização (HTTP ${res.status}).`);
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendentes"] });
      qc.invalidateQueries({ queryKey: ["pendentes_count"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["inter_status"] });
    },
  });
}


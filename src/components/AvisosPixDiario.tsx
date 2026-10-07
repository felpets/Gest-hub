import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, isMock } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";
import {
  contaComoNovo, destravarAudioNoPrimeiroGesto, foraDeVista, lerPrefsAvisos, notificarSistema,
  ouvirToqueNotificacao, resumirEventos, somarPixNaoVisto, tocarAlerta, type AcaoPix, type EventoPix,
} from "@/lib/avisos-pix";

// ─── Pix do dia em tempo real ──────────────────────────────────────────────
// Montado UMA vez na raiz do app (ver routes/__root.tsx), não na tela do Pix:
// o pedido era justamente avisar quem está em outra tela. Enquanto estiver
// montado:
//
//   1. a lista do Pix se atualiza sozinha em todos os navegadores abertos
//      (invalida as queries; quem estiver com a tela aberta vê a linha nova);
//   2. quem NÃO fez a ação recebe o aviso — toast, som, notificação do
//      sistema (no APK, a do Android) e o contador no menu, conforme as
//      preferências do aparelho.
//
// Escuta TODAS as empresas em que o cargo da pessoa tem o Pix do dia, não só
// a selecionada: quem cuida de várias empresas precisa saber do Pix lançado
// na outra sem ter que trocar de empresa para descobrir. O aviso leva o nome
// da empresa quando a pessoa cuida de mais de uma, e "Ver" troca para ela.
//
// Quem conta o que aconteceu é `pagamentos_diarios_historico`: é a única
// tabela que sabe o AUTOR (autor_email, gravado pelo gatilho da migração 39).
// Sem isso o sistema avisaria a pessoa sobre o próprio clique.
//
// Precisa da migração 58 (as tabelas na publicação supabase_realtime). Sem
// ela nada quebra — o canal simplesmente não recebe evento nenhum e a tela
// volta ao comportamento antigo, de atualizar só quem faz a ação.

// Janela de agrupamento: marcar 12 pagamentos como pagos é UMA ação da
// pessoa, e tem que virar UM aviso — não doze.
const JANELA_MS = 800;

type LinhaHistorico = {
  empresa_id?: string | null;
  acao?: string;
  titular?: string | null;
  valor?: number | string | null;
  autor_email?: string | null;
};

const ACOES: AcaoPix[] = ["criado", "alterado", "pago", "estornado", "excluido"];
const ehAcao = (v: unknown): v is AcaoPix => ACOES.includes(v as AcaoPix);

export function AvisosPixDiario() {
  const { empresaId, empresas, empresasComCapacidade, trocarEmpresa } = useEmpresa();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Só quem enxerga a lista recebe aviso dela, empresa por empresa. O RLS já
  // barraria no servidor (policies da migração 39); filtrar aqui evita abrir
  // inscrição à toa.
  const idsPix = useMemo(() => empresasComCapacidade("pag_diario_gerir"), [empresasComCapacidade]);
  const chaveIds = idsPix.join(",");
  const meuEmail = (user?.email ?? "").toLowerCase();

  // Em refs para não recriar a inscrição a cada render: derrubar e reabrir o
  // canal do Realtime a cada toque de estado (inclusive trocar de empresa)
  // perde eventos no meio.
  const meuEmailRef = useRef(meuEmail);
  meuEmailRef.current = meuEmail;
  const empresaAtivaRef = useRef(empresaId);
  empresaAtivaRef.current = empresaId;
  const nomesRef = useRef(new Map<string, string>());
  nomesRef.current = new Map(empresas.map((e) => [e.id, e.nome]));
  const variasRef = useRef(false);
  variasRef.current = idsPix.length > 1;

  // Abre o Pix do dia da empresa do aviso, trocando de empresa se precisar.
  const abrirPixRef = useRef((_empresa: string) => {});
  abrirPixRef.current = (empresaDoAviso: string) => {
    if (empresaDoAviso && empresaDoAviso !== empresaId) trocarEmpresa(empresaDoAviso);
    navigate({ to: "/financeiro/pagamentos", search: { aba: "pix" } });
  };

  // O som do aviso precisa de um clique prévio na aba (política do navegador).
  useEffect(() => destravarAudioNoPrimeiroGesto(), []);
  // Tocar na notificação do sistema (Windows ou Android) abre o Pix certo.
  useEffect(() => ouvirToqueNotificacao((id) => abrirPixRef.current(id)), []);

  useEffect(() => {
    // No protótipo não existe "outro usuário": tudo que muda é desta aba, e as
    // próprias mutações já atualizam a lista.
    const ids = chaveIds ? chaveIds.split(",") : [];
    if (isMock || ids.length === 0) return;

    let vivo = true;
    const fila: { empresaId: string; evento: EventoPix }[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const invalidar = () => {
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-historico"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-diarios-autores"] });
    };

    const despejar = () => {
      timer = null;
      const lote = fila.splice(0, fila.length);
      if (!vivo || lote.length === 0) return;

      somarPixNaoVisto(lote.filter((x) => contaComoNovo(x.evento.acao)).length);
      const prefs = lerPrefsAvisos();

      // Um aviso por empresa: juntar Pix de empresas diferentes num texto só
      // esconderia de qual delas é cada pagamento.
      const porEmpresa = new Map<string, EventoPix[]>();
      for (const x of lote) porEmpresa.set(x.empresaId, [...(porEmpresa.get(x.empresaId) ?? []), x.evento]);

      let algumUrgente = false;
      for (const [eid, eventos] of porEmpresa) {
        const aviso = resumirEventos(eventos);
        algumUrgente ||= aviso.urgente;
        // O nome da empresa entra quando a pessoa cuida de mais de uma — ou
        // quando o aviso é de outra que não a aberta na tela.
        const nome = nomesRef.current.get(eid);
        const titulo = nome && (variasRef.current || eid !== empresaAtivaRef.current)
          ? `${aviso.titulo} · ${nome}`
          : aviso.titulo;

        if (prefs.toast) {
          const mostrar = aviso.urgente ? toast.warning : toast.info;
          mostrar(titulo, {
            description: aviso.detalhe,
            duration: aviso.urgente ? 12000 : 7000,
            action: { label: "Ver", onClick: () => abrirPixRef.current(eid) },
          });
        }
        // Notificação do sistema só quando a pessoa não está olhando o sistema
        // (aba escondida, outra janela na frente, app em segundo plano): com a
        // tela em foco o toast já resolveu, e o pop-up por cima seria estorvo.
        if (prefs.sistema && foraDeVista()) notificarSistema(titulo, aviso.detalhe, eid);
      }
      // Um bipe por rajada, não um por empresa.
      if (prefs.som) tocarAlerta(algumUrgente);
    };

    const enfileirar = (eid: string, linha: LinhaHistorico) => {
      const autor = (linha.autor_email ?? "").toLowerCase();
      // O próprio clique não vira alarme: quem fez já viu a confirmação.
      if (autor && autor === meuEmailRef.current) return;
      if (!ehAcao(linha.acao)) return;

      fila.push({
        empresaId: linha.empresa_id ?? eid,
        evento: {
          acao: linha.acao,
          titular: linha.titular ?? "",
          valor: Number(linha.valor ?? 0),
          autorEmail: linha.autor_email ?? "",
        },
      });
      if (!timer) timer = setTimeout(despejar, JANELA_MS);
    };

    // Um canal só, com um par de inscrições por empresa.
    const canal = supabase.channel(`pix-diario:${chaveIds}`);
    for (const eid of ids) {
      canal
        // A lista viva: qualquer mudança na tabela redesenha a tela de quem
        // estiver com ela aberta, inclusive quando o autor não veio no evento.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pagamentos_diarios", filter: `empresa_id=eq.${eid}` },
          invalidar
        )
        // O aviso: o histórico é append-only, então basta escutar INSERT.
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "pagamentos_diarios_historico", filter: `empresa_id=eq.${eid}` },
          (payload) => {
            invalidar();
            enfileirar(eid, (payload.new ?? {}) as LinhaHistorico);
          }
        );
    }
    canal.subscribe();

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(canal);
    };
  }, [chaveIds, qc]);

  return null;
}

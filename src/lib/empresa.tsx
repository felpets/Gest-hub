import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, isMock } from "@/lib/supabase";
import { E1 as EMPRESA_PADRAO_DEMO } from "@/lib/mock/demo";
import { useAuth } from "@/lib/auth";
import { setQueryEmpresaId } from "@/lib/empresa-ref";
import { setQueryContaId } from "@/lib/conta-bancaria-ref";
import { TODAS_CAPACIDADES, podeVerGestao, type Papel } from "@/lib/permissoes";
import {
  EMPRESAS_RH, empresaRHDoFinanceiro, empresasDoRH, escolherEmpresaRH, semRepetir, TODAS_EMPRESAS_RH,
} from "@/modulos/rh/empresas";

export type Empresa = { id: string; nome: string };

// Acesso ao módulo RH (tabela rh_acessos): por usuário, não por cargo.
// empresas: null = todas as empresas do RH; senão, só as da lista.
export type AcessoRHBanco = { liberado: boolean; perfil: string; empresas: string[] | null };
const SEM_RH: AcessoRHBanco = { liberado: false, perfil: "", empresas: null };
const RH_TOTAL: AcessoRHBanco = { liberado: true, perfil: "", empresas: null };

type EmpresaContextValue = {
  loading: boolean;
  empresas: Empresa[];          // empresas com o módulo Financeiro que a pessoa acessa
  empresaId: string | null;
  isMaster: boolean;
  papel: Papel;                 // chave do cargo do usuário na empresa ATIVA
  papelNome: string;            // nome exibível do cargo ativo
  caps: Set<string>;            // capacidades do cargo na empresa ATIVA (+ rh_acessar, gestao_acessar)
  // Ids das empresas (do Financeiro) em que o cargo da pessoa tem esta
  // capacidade — para o que vale em todas, não só na ativa (avisos do Pix).
  empresasComCapacidade: (cap: string) => string[];
  rh: AcessoRHBanco;            // acesso ao módulo RH (não depende da empresa ativa)
  gestaoLiberada: boolean;      // liberado para a Gestão em Usuários (gestao_acessos)
  empresasRH: string[];         // empresas que a pessoa pode escolher no RH
  rhPodeTodas: boolean;         // pode ver "Todas as empresas" no RH
  empresaRH: string;            // empresa ativa no RH ("" = todas as empresas)
  trocarEmpresaRH: (nome: string) => void;
  semEmpresa: boolean;          // logado mas sem empresa no Financeiro e sem RH
  trocarEmpresa: (id: string) => void;
  refetchEmpresas: () => Promise<void>;
  contaId: string | null;       // conta bancária ativa; null = Todas (consolidado)
  trocarConta: (id: string | null) => void;
};

const EmpresaContext = createContext<EmpresaContextValue | undefined>(undefined);

const storageKey = (userId: string) => `zaytan.empresaId.${userId}`;
const storageKeyRH = (userId: string) => `zaytan.empresaRH.${userId}`;

// ─── Leitura do banco ────────────────────────────────────────
type LinhaEmpresa = { id: string; nome: string; modulos: string[] | null };

// Empresas que a pessoa acessa, com os módulos (migração 44). Sem a coluna,
// todas valem para os dois módulos.
async function lerEmpresas(): Promise<LinhaEmpresa[]> {
  const r = await supabase.from("empresas").select("id, nome, modulos").order("nome", { ascending: true });
  if (!r.error) return (r.data ?? []) as LinhaEmpresa[];
  const r2 = await supabase.from("empresas").select("id, nome").order("nome", { ascending: true });
  return ((r2.data ?? []) as { id: string; nome: string }[]).map((e) => ({ ...e, modulos: null }));
}

const temModulo = (e: LinhaEmpresa, modulo: string) => !e.modulos || e.modulos.includes(modulo);

// Acesso ao RH. Aceita a coluna antiga `empresa` (uma só), de antes da migração 44.
async function lerAcessoRH(userId: string): Promise<AcessoRHBanco> {
  const { data, error } = await supabase.from("rh_acessos").select("*").eq("user_id", userId).maybeSingle();
  if (error || !data) return SEM_RH;
  const linha = data as { perfil?: string | null; empresas?: string[] | null; empresa?: string | null };
  const empresas = Array.isArray(linha.empresas) && linha.empresas.length > 0
    ? linha.empresas
    : linha.empresa ? [linha.empresa] : null;
  return { liberado: true, perfil: linha.perfil ?? "", empresas };
}

// Liberado para a Gestão sem ser Administrador (migração 54). Sem a tabela,
// só o master e o cargo Administrador veem a Gestão.
async function lerAcessoGestao(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("gestao_acessos").select("user_id").eq("user_id", userId).maybeSingle();
  return !error && !!data;
}

// Empresas com o módulo RH que a pessoa enxerga (fn_empresas_rh, migração 44).
// Sem a função: a lista padrão do RH mais as empresas que a pessoa vê no cadastro.
async function lerCadastroRH(linhas: LinhaEmpresa[]): Promise<string[]> {
  const { data, error } = await supabase.rpc("fn_empresas_rh");
  if (!error) return ((data ?? []) as { nome: string }[]).map((e) => e.nome);
  return semRepetir([...EMPRESAS_RH, ...linhas.filter((e) => temModulo(e, "rh")).map((e) => e.nome)]);
}

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaIdState] = useState<string | null>(null);
  const [isMaster, setIsMaster] = useState(false);
  // Papel do usuário em cada empresa que acessa (empresa_id → chave do cargo).
  const [papeis, setPapeis] = useState<Record<string, Papel>>({});
  // Definição dos cargos (globais): chave → { nome, capacidades }.
  const [cargos, setCargos] = useState<Record<string, { nome: string; caps: string[] }>>({});
  const [contaId, setContaIdState] = useState<string | null>(null);
  const [rhAcesso, setRhAcesso] = useState<AcessoRHBanco>(SEM_RH);
  const [gestaoLiberada, setGestaoLiberada] = useState(false);
  const [cadastroRH, setCadastroRH] = useState<string[]>([]);
  const [empresaRH, setEmpresaRHState] = useState<string>(TODAS_EMPRESAS_RH);

  // Atualiza o estado React e a referência de módulo (lida pelas queries) juntos.
  const aplicarEmpresa = useCallback((id: string | null) => {
    setEmpresaIdState(id);
    setQueryEmpresaId(id);
  }, []);

  const aplicarConta = useCallback((id: string | null) => {
    setContaIdState(id);
    setQueryContaId(id);
  }, []);

  const aplicarEmpresaRH = useCallback((nome: string, userId?: string) => {
    setEmpresaRHState(nome);
    if (userId && typeof localStorage !== "undefined") localStorage.setItem(storageKeyRH(userId), nome);
  }, []);

  const carregar = useCallback(
    async (userId: string, silent = false) => {
      if (!silent) setLoading(true);
      // É master?
      const { data: perfil } = await supabase
        .from("perfis")
        .select("is_master")
        .eq("user_id", userId)
        .maybeSingle();
      const master = !!perfil?.is_master;
      setIsMaster(master);

      // Acesso ao RH: o master sempre entra (como administrador do RH, todas as
      // empresas); os demais só com uma linha em rh_acessos. Sem a tabela
      // (migração 42 ainda não aplicada) ninguém além do master vê o RH.
      const acessoRH = master ? RH_TOTAL : await lerAcessoRH(userId);
      setRhAcesso(acessoRH);
      setGestaoLiberada(master ? true : await lerAcessoGestao(userId));

      // Empresas acessíveis (a RLS já restringe; master recebe todas). O
      // Financeiro só lista as que têm o módulo Financeiro.
      const linhas = await lerEmpresas();
      const lista: Empresa[] = linhas
        .filter((e) => temModulo(e, "financeiro"))
        .map((e) => ({ id: e.id, nome: e.nome }));
      setEmpresas(lista);

      const doRH = acessoRH.liberado ? await lerCadastroRH(linhas) : [];
      setCadastroRH(doRH);

      // Papel por empresa (a RLS de empresa_membros já libera as próprias linhas).
      const { data: vinculos } = await supabase
        .from("empresa_membros")
        .select("empresa_id, papel")
        .eq("user_id", userId);
      const mapa: Record<string, Papel> = {};
      for (const v of vinculos ?? []) mapa[v.empresa_id] = (v.papel ?? "visualizador") as Papel;
      setPapeis(mapa);

      // Catálogo global de cargos + suas capacidades (RLS libera leitura).
      const [{ data: cs }, { data: caps }] = await Promise.all([
        supabase.from("cargos").select("chave, nome"),
        supabase.from("cargo_capacidades").select("cargo_chave, capacidade"),
      ]);
      const defs: Record<string, { nome: string; caps: string[] }> = {};
      for (const c of cs ?? []) defs[c.chave] = { nome: c.nome, caps: [] };
      for (const r of caps ?? []) (defs[r.cargo_chave] ??= { nome: r.cargo_chave, caps: [] }).caps.push(r.capacidade);
      setCargos(defs);

      // Resolve a empresa ativa: salva (se ainda válida) → padrão da demonstração
      // (protótipo) → primeira → nenhuma.
      const salvo =
        typeof localStorage !== "undefined" ? localStorage.getItem(storageKey(userId)) : null;
      const padraoDemo = isMock && lista.some((e) => e.id === EMPRESA_PADRAO_DEMO) ? EMPRESA_PADRAO_DEMO : null;
      const escolhida =
        salvo && lista.some((e) => e.id === salvo) ? salvo : padraoDemo ?? lista[0]?.id ?? null;
      aplicarEmpresa(escolhida);
      if (escolhida && typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey(userId), escolhida);
      }

      // Empresa ativa no RH: a última escolhida → a que casa com a do Financeiro → a primeira.
      const salvaRH = typeof localStorage !== "undefined" ? localStorage.getItem(storageKeyRH(userId)) : null;
      aplicarEmpresaRH(
        escolherEmpresaRH({
          lista: empresasDoRH(acessoRH, doRH),
          podeTodas: acessoRH.liberado && acessoRH.empresas === null,
          salva: salvaRH,
          nomeFinanceiro: lista.find((e) => e.id === escolhida)?.nome,
        })
      );
      if (!silent) setLoading(false);
    },
    [aplicarEmpresa, aplicarEmpresaRH]
  );

  useEffect(() => {
    if (authLoading) return; // espera a sessão resolver
    if (!user) {
      // logout / sem sessão: zera tudo e limpa o cache da empresa anterior
      setEmpresas([]);
      setIsMaster(false);
      setRhAcesso(SEM_RH);
      setGestaoLiberada(false);
      setCadastroRH([]);
      setEmpresaRHState(TODAS_EMPRESAS_RH);
      setPapeis({});
      setCargos({});
      aplicarEmpresa(null);
      aplicarConta(null);
      setLoading(false);
      qc.clear();
      return;
    }
    void carregar(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  const empresasRH = useMemo(() => empresasDoRH(rhAcesso, cadastroRH), [rhAcesso, cadastroRH]);
  const rhPodeTodas = rhAcesso.liberado && rhAcesso.empresas === null;
  const rhPermite = useCallback(
    (nome: string) => (nome === TODAS_EMPRESAS_RH ? rhPodeTodas : empresasRH.includes(nome)),
    [rhPodeTodas, empresasRH]
  );

  const trocarEmpresa = useCallback(
    (id: string) => {
      if (id === empresaId) return;
      aplicarEmpresa(id);
      aplicarConta(null); // ao trocar de empresa, volta p/ "Todas as contas"
      if (user && typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey(user.id), id);
      }
      // A empresa do topo vale para os dois pilares: o RH acompanha, se a pessoa tiver acesso a ela.
      const doRH = empresaRHDoFinanceiro(empresas.find((e) => e.id === id)?.nome, empresasRH);
      if (doRH) aplicarEmpresaRH(doRH, user?.id);
      qc.clear(); // descarta o cache da empresa anterior (evita vazamento visual)
    },
    [empresaId, user, qc, aplicarEmpresa, aplicarConta, aplicarEmpresaRH, empresas, empresasRH]
  );

  // Troca a empresa no RH ("" = todas, só para quem tem o RH sem restrição). Se a
  // pessoa também acessa essa empresa no Financeiro, o Financeiro acompanha.
  const trocarEmpresaRH = useCallback(
    (nome: string) => {
      if (!rhAcesso.liberado || !rhPermite(nome)) return;
      aplicarEmpresaRH(nome, user?.id);
      if (!nome) return;
      const fin = empresas.find((e) => empresaRHDoFinanceiro(e.nome, [nome]));
      if (fin && fin.id !== empresaId) trocarEmpresa(fin.id);
    },
    [rhAcesso.liberado, rhPermite, empresas, empresaId, user, aplicarEmpresaRH, trocarEmpresa]
  );

  // Troca a conta ativa (null = Todas). Sem qc.clear: a queryKey de
  // movimentações inclui contaId, então o refetch acontece naturalmente.
  const trocarConta = useCallback(
    (id: string | null) => {
      if (id === contaId) return;
      aplicarConta(id);
    },
    [contaId, aplicarConta]
  );

  const refetchEmpresas = useCallback(async () => {
    if (user) await carregar(user.id, true);
  }, [user, carregar]);

  // Quem só usa o RH não precisa de empresa no Financeiro.
  const semEmpresa = !loading && !!user && empresas.length === 0 && !rhAcesso.liberado;

  // Empresa do RH em uso: a escolhida, se ainda for permitida; senão a primeira.
  const empresaRHEfetiva = rhPermite(empresaRH) ? empresaRH : empresasRH[0] ?? TODAS_EMPRESAS_RH;

  // Papel na empresa ativa: master é sempre admin; sem vínculo → visualizador (fail-safe).
  const papel: Papel = isMaster ? "admin" : (empresaId ? papeis[empresaId] ?? "visualizador" : "visualizador");
  const papelNome = cargos[papel]?.nome ?? papel;
  // Capacidades efetivas: o master tem tudo; sem empresa no Financeiro, nenhuma do
  // Financeiro; senão, as do cargo ativo. O RH não é capacidade de cargo:
  // rh_acessar só existe para quem tem acesso liberado.
  const caps = new Set<string>(isMaster ? TODAS_CAPACIDADES : empresaId ? cargos[papel]?.caps ?? [] : []);
  caps.delete("rh_acessar");
  if (rhAcesso.liberado) caps.add("rh_acessar");
  // Gestão: master, Administrador da empresa ativa ou liberado pessoa a pessoa
  // (só em empresa em que a pessoa já tem acesso ao Financeiro).
  caps.delete("gestao_acessar");
  if (podeVerGestao(isMaster, papel, gestaoLiberada) && (isMaster || !!empresaId)) caps.add("gestao_acessar");

  const empresasComCapacidade = useCallback(
    (cap: string) =>
      empresas
        .filter((e) => isMaster || (cargos[papeis[e.id] ?? "visualizador"]?.caps ?? []).includes(cap))
        .map((e) => e.id),
    [empresas, isMaster, cargos, papeis]
  );

  return (
    <EmpresaContext.Provider
      value={{
        loading, empresas, empresaId, isMaster, papel, papelNome, caps, empresasComCapacidade, rh: rhAcesso, gestaoLiberada,
        empresasRH, rhPodeTodas, empresaRH: empresaRHEfetiva, trocarEmpresaRH,
        semEmpresa, trocarEmpresa, refetchEmpresas, contaId, trocarConta,
      }}
    >
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresa() {
  const ctx = useContext(EmpresaContext);
  if (!ctx) throw new Error("useEmpresa deve ser usado dentro de <EmpresaProvider>");
  return ctx;
}

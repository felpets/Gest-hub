// ─── O miolo do formulário de Pix ───────────────────────────────────────────
// Lançar um Pix tem duas telas — o diálogo do computador (pagamentos-diarios.tsx)
// e a tela do celular (pix-celular-form.tsx) — e UMA lógica só, que mora aqui:
// o estado do formulário, a ordem em que os erros aparecem, o que o QR code
// preenche e o que o Pix copia e cola faz com o tipo da chave.
//
// Duplicar isso seria a receita para as duas telas discordarem sobre o que é um
// lançamento válido — e quem descobriria seria quem paga, no fim do dia.
//
// Aqui não há nenhum JSX de propósito: cada tela desenha do seu jeito.
import { useEffect, useState } from "react";
import {
  detectarTipoChave,
  ehPixCopiaECola,
  erroChavePix,
  formatarChavePix,
  lerPixCopiaECola,
  normalizarChavePix,
  resumirChavePix,
  type PixLido,
  type TipoChavePix,
} from "@/lib/pix";
import { lerQrDaImagem } from "@/lib/qr-imagem";
import {
  useSavePagamentoDiario,
  type PagamentoDiario,
  type PagamentoDiarioInput,
} from "@/lib/queries";

export const formularioVazio = (data: string): PagamentoDiarioInput => ({
  data,
  titular: "",
  chavePix: "",
  tipoChave: "outro",
  valor: 0,
  descricao: "",
});

// Traduz o erro cru do Postgres. As mensagens da trava (migração 39) já vêm
// prontas em português — o que sobra é o caso "migração ainda não rodou".
const semMigracao = (msg: string) =>
  /pagamentos_diarios/.test(msg) && /not find|does not exist|schema cache/i.test(msg);

export const msgErroPagamento = (e: unknown, fallback: string): string => {
  const msg = e instanceof Error ? e.message : "";
  if (!msg) return fallback;
  return semMigracao(msg)
    ? "A tabela ainda não existe: rode supabase/39_pagamentos_diarios.sql no SQL Editor."
    : msg;
};

// ─── O formulário inteiro ───────────────────────────────────
export function useFormularioPagamento({
  aberto,
  pagamento,
  dataPadrao,
  aoSalvar,
}: {
  aberto: boolean;
  pagamento: PagamentoDiario | null;
  dataPadrao: string;
  aoSalvar: () => void;
}) {
  const save = useSavePagamentoDiario();
  const [form, setForm] = useState<PagamentoDiarioInput>(formularioVazio(dataPadrao));
  const [erro, setErro] = useState<string | null>(null);
  const [qrLido, setQrLido] = useState<PixLido | null>(null);

  // QR estático: grava a chave que está dentro dele. Dinâmico (cobrança de
  // banco): não tem chave, então o código inteiro fica gravado para colar no app
  // do banco. Valor, nome e descrição do QR só preenchem o que ainda está vazio.
  const aplicarPix = (lido: PixLido) => {
    setQrLido(lido);
    setForm((f) => ({
      ...f,
      chavePix: lido.chave ?? lido.codigo,
      tipoChave: lido.chave ? detectarTipoChave(lido.chave) : "copia_cola",
      valor: lido.valor && !(f.valor > 0) ? lido.valor : f.valor,
      titular: f.titular.trim() ? f.titular : lido.nome,
      descricao: f.descricao.trim() ? f.descricao : lido.descricao,
    }));
  };

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setQrLido(null);
    save.reset();
    setForm(
      pagamento
        ? {
            data: pagamento.data,
            titular: pagamento.titular,
            chavePix: formatarChavePix(pagamento.chavePix, pagamento.tipoChave),
            tipoChave: pagamento.tipoChave,
            valor: pagamento.valor,
            descricao: pagamento.descricao,
          }
        : formularioVazio(dataPadrao),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, pagamento, dataPadrao]);

  // A ordem importa: é a ordem de leitura do formulário, para o erro apontar
  // sempre o primeiro campo que está faltando.
  const salvar = async () => {
    if (!form.data) {
      setErro("Informe a data do pagamento.");
      return;
    }
    if (!form.titular.trim()) {
      setErro("Informe o nome do titular recebedor.");
      return;
    }
    const erroChave = erroChavePix(form.chavePix, form.tipoChave);
    if (erroChave) {
      setErro(erroChave);
      return;
    }
    if (!(form.valor > 0)) {
      setErro("Informe um valor maior que zero.");
      return;
    }
    setErro(null);
    try {
      await save.mutateAsync({ id: pagamento?.id, input: form });
      aoSalvar();
    } catch (e) {
      setErro(msgErroPagamento(e, "Erro ao salvar o pagamento."));
    }
  };

  return {
    form,
    setForm,
    erro,
    setErro,
    qrLido,
    aplicarPix,
    salvar,
    /** Esquece o QR lido — quem digita a chave à mão desfaz a leitura. */
    limparQr: () => setQrLido(null),
    salvando: save.isPending,
    editando: pagamento !== null,
  };
}

// ─── O campo da chave (e o QR) ──────────────────────────────
export function useCampoChavePix({
  chave,
  tipo,
  onChange,
  onPixLido,
}: {
  chave: string;
  tipo: TipoChavePix;
  onChange: (chave: string, tipo: TipoChavePix) => void;
  onPixLido: (lido: PixLido) => void;
}) {
  // Enquanto a pessoa não escolhe o tipo à mão, ele acompanha o que foi digitado.
  const [tipoManual, setTipoManual] = useState(false);
  const [lendoQr, setLendoQr] = useState(false);
  const [erroQr, setErroQr] = useState<string | null>(null);

  const erro = chave.trim() ? erroChavePix(chave, tipo) : null;
  const normalizada = chave.trim() ? normalizarChavePix(chave, tipo) : "";
  const previa = normalizada ? resumirChavePix(normalizada, tipo) : "";

  const receberTexto = (v: string) => {
    setErroQr(null);
    if (ehPixCopiaECola(v)) {
      const lido = lerPixCopiaECola(v);
      if (lido?.crcOk) {
        setTipoManual(false);
        onPixLido(lido);
        return;
      }
      onChange(v, "copia_cola"); // mostra o erro do código cortado/alterado
      return;
    }
    onChange(v, tipoManual ? tipo : detectarTipoChave(v));
  };

  const escolherTipo = (novo: TipoChavePix) => {
    setTipoManual(true);
    onChange(chave, novo);
  };

  const lerImagem = async (arquivo: Blob) => {
    setErroQr(null);
    setLendoQr(true);
    try {
      const texto = await lerQrDaImagem(arquivo);
      if (!texto)
        setErroQr("Não achei um QR code nesta imagem. Tente um print mais nítido, só do QR.");
      else if (!ehPixCopiaECola(texto)) setErroQr("O QR code desta imagem não é um Pix.");
      else receberTexto(texto);
    } catch {
      setErroQr("Não consegui ler a imagem.");
    } finally {
      setLendoQr(false);
    }
  };

  return { erro, erroQr, previa, lendoQr, receberTexto, escolherTipo, lerImagem };
}

// ─── Entregar um arquivo gerado no cliente (PDF, Excel) ─────────────────────
// No navegador: link com `download` + blob URL, o caminho de sempre.
//
// No APK: o WebView do Android ignora download de blob — não há gerenciador de
// downloads para a origem local, e o clique em "Exportar" simplesmente não
// fazia nada, sem erro nenhum na tela. Aqui o arquivo é gravado no cache do app
// e entregue ao Android pelo compartilhar, onde a pessoa escolhe o que fazer:
// abrir no leitor de PDF, salvar no Drive, mandar no WhatsApp do escritório.
//
// Cache (e não Documentos) porque o arquivo é descartável — o relatório sai do
// banco de novo a qualquer momento — e porque gravar ali não pede permissão
// nenhuma ao usuário. O Android limpa sozinho quando precisa de espaço.
import { NO_APP } from "@/lib/nativo";

export async function entregarArquivo(nome: string, blob: Blob): Promise<void> {
  if (!NO_APP) {
    baixarNoNavegador(nome, blob);
    return;
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  const { uri } = await Filesystem.writeFile({
    path: nomeSeguro(nome),
    data: await blobParaBase64(blob),
    directory: Directory.Cache,
  });

  try {
    await Share.share({ title: nome, url: uri });
  } catch (e) {
    // Fechar a folha de compartilhamento sem escolher nada vira erro no plugin.
    // Não é falha: o arquivo está gravado e a pessoa só mudou de ideia.
    if (!cancelou(e)) throw e;
  }
}

function baixarNoNavegador(nome: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois do clique: revogar na hora cancela o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// O Filesystem grava binário quando `data` vem em base64 e sem `encoding`.
function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo gerado."));
    leitor.onload = () => {
      const dataUrl = String(leitor.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    leitor.readAsDataURL(blob);
  });
}

// Nome de arquivo do Android: sem barras nem os caracteres que o sistema recusa.
const nomeSeguro = (nome: string) => nome.replace(/[\\/:*?"<>|]/g, "-");

const cancelou = (e: unknown) => /cancel/i.test(e instanceof Error ? e.message : String(e));

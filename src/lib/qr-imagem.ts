// Lê o texto de um QR code numa imagem (print, foto, arquivo). Só no navegador.
// A leitura é feita aqui mesmo — a imagem não sai do computador.

const LADO_MAXIMO = 1600; // foto de celular é enorme: reduz antes de procurar o QR

async function carregarImagem(arquivo: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Devolve o texto do QR, ou null se não achar nenhum na imagem.
export async function lerQrDaImagem(arquivo: Blob): Promise<string | null> {
  const { default: jsQR } = await import("jsqr");
  const img = await carregarImagem(arquivo);
  // Tenta no tamanho reduzido e, se não achar, num menor (QR pequeno numa foto
  // grande às vezes só aparece com menos ruído).
  for (const escala of [1, 0.5]) {
    const fator = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight)) * escala;
    const w = Math.max(1, Math.round(img.naturalWidth * fator));
    const h = Math.max(1, Math.round(img.naturalHeight * fator));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const achado = jsQR(data, w, h, { inversionAttempts: "attemptBoth" });
    if (achado?.data) return achado.data;
  }
  return null;
}

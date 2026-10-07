// Linha do tempo do vídeo: quando cada bloco, cada tela, cada trecho de voz e
// cada legenda começa. Sai do roteiro.json + o que o narrar.mjs mediu de cada
// fala (saida/voz/falas.json). Quem usa: render.mjs (para o vídeo e o áudio) e,
// por /linha.json, o video.js (para desenhar os quadros).
//
// O tempo de cada tela é o tempo da sua fala, com um mínimo para dar tempo de
// ler: mude a fala e a tela acompanha, sem acertar segundos à mão.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const TEMPOS = {
  capitulo: 2.6,      // cartão "01 · Gestão"
  entrada: 0.5,       // o navegador/celular entra antes da primeira fala
  respiro: 0.35,      // da troca de tela até a voz começar
  sobra: 0.3,         // depois que a voz termina, antes da próxima tela
  minWeb: 2.8,        // tela web com fala: mínimo para ler
  minCelular: 1.6,    // tela do celular
  semFala: 1.8,       // tela sem fala própria (ex.: o toque seguinte no celular)
  abertura: { voz: 1.0, minimo: 5.5, depois: 0.9 },
  fim: { voz: 1.2, minimo: 10, depois: 3.5 },
};

export function lerRoteiro(raiz) {
  return JSON.parse(readFileSync(path.join(raiz, "roteiro.json"), "utf8"));
}
export function lerFalas(raiz) {
  const arq = path.join(raiz, "saida", "voz", "falas.json");
  return existsSync(arq) ? JSON.parse(readFileSync(arq, "utf8")) : {};
}

// As falas de um bloco, na ordem: abertura/fim têm uma; web/celular, uma por tela (ou nenhuma).
export const falasDoBloco = (b) => (b.telas ? b.telas.map((t) => t.fala || null) : [b.fala || null]);

export function montarLinha(roteiro, falas) {
  const T = TEMPOS;
  const linha = { blocos: [], audios: [], legendas: [], duracao: 0 };
  let t = 0;
  const voz = (clipe, ini) => {
    if (!clipe) return;
    linha.audios.push({ arquivo: clipe.arquivo, ini });
    for (const l of clipe.legendas) linha.legendas.push({ texto: l.texto, ini: ini + l.ini, fim: ini + l.fim });
  };

  roteiro.blocos.forEach((b, n) => {
    const clipes = falas[n]?.clipes ?? [];
    const bloco = { ...b, n, ini: t };
    if (b.tipo === "capitulo") {
      bloco.dur = T.capitulo;
    } else if (b.tipo === "abertura" || b.tipo === "fim") {
      const c = clipes[0], cfg = T[b.tipo];
      voz(c, t + cfg.voz);
      bloco.dur = Math.max(cfg.minimo, cfg.voz + (c?.dur ?? 3) + cfg.depois);
    } else {
      const minimo = b.tipo === "web" ? T.minWeb : T.minCelular;
      let cursor = t + T.entrada;
      bloco.telas = b.telas.map((tela, i) => {
        const c = clipes[i];
        const ini = i === 0 ? t : cursor;
        const dur = c ? Math.max(minimo, T.respiro + c.dur + T.sobra) : T.semFala;
        voz(c, cursor + T.respiro);
        cursor += dur;
        return { ...tela, ini, fim: cursor };
      });
      bloco.dur = cursor - t;
    }
    t += bloco.dur;
    linha.blocos.push(bloco);
  });
  linha.duracao = Math.ceil(t * 10) / 10;
  return linha;
}

// Duração de um .wav PCM, lendo só o cabeçalho.
export function duracaoWav(arquivo) {
  if (!existsSync(arquivo)) return 0;
  const b = readFileSync(arquivo);
  let taxa = 0, pos = 12;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4), tam = b.readUInt32LE(pos + 4);
    if (id === "fmt ") taxa = b.readUInt32LE(pos + 16); // bytes por segundo
    if (id === "data") return taxa ? Math.min(tam, b.length - pos - 8) / taxa : 0;
    pos += 8 + tam + (tam % 2);
  }
  return 0;
}

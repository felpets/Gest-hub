// Gera a narração com voz neural (edge-tts) a partir do roteiro.json.
//
//   node narrar.mjs            → saida/voz/*.wav + saida/voz/falas.json
//   node narrar.mjs --tudo     → refaz todas as falas, mesmo as que não mudaram
//
// Cada bloco (ex.: "Receitas") é falado de uma vez só, para a entonação correr
// natural de uma frase para a outra. Depois o áudio é cortado em um clipe por
// tela, no começo da primeira palavra de cada fala — o instante de cada palavra
// vem da própria síntese. Assim cada tela troca exatamente quando a voz chega
// nela, e a legenda acompanha palavra por palavra.
//
// Precisa de Python com o edge-tts (pip install edge-tts) e de internet: a voz
// é sintetizada pelo serviço de leitura em voz alta do Microsoft Edge.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";
import { duracaoWav, falasDoBloco, lerFalas, lerRoteiro } from "./linha.mjs";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const VOZ = path.join(RAIZ, "saida", "voz");
mkdirSync(VOZ, { recursive: true });
const roteiro = lerRoteiro(RAIZ);
const anteriores = process.argv.includes("--tudo") ? {} : lerFalas(RAIZ);
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const MAX_LINHA = 46; // caracteres por legenda

function rodar(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} falhou:\n${r.stderr || r.error}`);
}
const palavrasDe = (texto) => texto.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));

const saida = {};
for (const [n, bloco] of roteiro.blocos.entries()) {
  const falas = falasDoBloco(bloco);
  if (!falas.some(Boolean)) continue;
  const texto = falas.filter(Boolean).join(" ");
  const hash = createHash("sha1").update(`${roteiro.voz}|${roteiro.ritmo}|${JSON.stringify(falas)}`).digest("hex").slice(0, 12);
  const ant = anteriores[n];
  if (ant?.hash === hash && ant.clipes.every((c) => !c || existsSync(path.join(RAIZ, c.arquivo)))) {
    saida[n] = ant;
    continue;
  }

  const nome = `b${String(n).padStart(2, "0")}`;
  const em = (ext) => path.join(VOZ, `${nome}${ext}`);
  writeFileSync(em(".txt"), texto, "utf8");
  rodar(PYTHON, [path.join(RAIZ, "tts.py"), roteiro.voz, roteiro.ritmo, em(".txt"), em(".mp3"), em("-palavras.json")]);
  rodar(ffmpeg, ["-y", "-loglevel", "error", "-i", em(".mp3"), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", em(".wav")]);
  const total = duracaoWav(em(".wav"));
  const marcas = JSON.parse(readFileSync(em("-palavras.json"), "utf8"));

  // Palavra do roteiro ↔ palavra falada. Normalmente batem uma a uma; se a voz
  // juntar ou separar alguma, cai na proporção (a troca de tela fica a um ou
  // dois décimos do ponto exato, o que ninguém percebe).
  const fichas = falas.flatMap((f, i) => (f ? palavrasDe(f).map((p) => ({ p, i })) : []));
  const marca = (j) => marcas[fichas.length === marcas.length ? j : Math.round((j * (marcas.length - 1)) / Math.max(1, fichas.length - 1))];
  if (fichas.length !== marcas.length) console.warn(`! ${nome}: ${fichas.length} palavras no roteiro, ${marcas.length} faladas — sincronia aproximada`);

  // Onde cada fala começa (um pouco antes da primeira palavra) e termina (onde começa a seguinte).
  const inicios = falas.map((f, i) => (f ? Math.max(0, marca(fichas.findIndex((x) => x.i === i)).ini - 0.06) : null));
  const ordem = inicios.map((v, i) => (v === null ? null : i)).filter((i) => i !== null);
  const clipes = falas.map(() => null);
  ordem.forEach((i, k) => {
    const ini = k === 0 ? 0 : inicios[i];
    const fim = k + 1 < ordem.length ? inicios[ordem[k + 1]] : total;
    const arquivo = path.join("saida", "voz", `${nome}-t${String(i).padStart(2, "0")}.wav`);
    rodar(ffmpeg, ["-y", "-loglevel", "error", "-i", em(".wav"), "-ss", ini.toFixed(3), "-to", fim.toFixed(3), "-c:a", "pcm_s16le", path.join(RAIZ, arquivo)]);

    // Legendas desta fala: primeiro em trechos que terminam em pontuação; trecho
    // longo demais vira linhas de tamanho parecido (nada de "sistema." sozinho).
    const pals = fichas.map((f, j) => ({ ...f, m: marca(j) })).filter((f) => f.i === i);
    const trechos = [[]];
    pals.forEach((f) => { trechos[trechos.length - 1].push(f); if (/[.,:;!?]$/.test(f.p)) trechos.push([]); });
    const tamanho = (ps) => ps.reduce((s, f) => s + f.p.length + 1, -1);
    const linhas = [];
    for (const tr of trechos.filter((t) => t.length)) {
      const ant = linhas[linhas.length - 1];
      if (ant && tamanho(ant) < 22 && tamanho(ant) + 1 + tamanho(tr) <= MAX_LINHA) { ant.push(...tr); continue; }
      const partes = Math.ceil(tamanho(tr) / MAX_LINHA), alvo = tamanho(tr) / partes;
      let linha = [];
      for (const f of tr) {
        if (linha.length && tamanho([...linha, f]) > alvo + 6 && tamanho(linha) >= alvo - 10) { linhas.push(linha); linha = []; }
        linha.push(f);
      }
      linhas.push(linha);
    }
    const legendas = linhas.map((ps) => ({ texto: ps.map((f) => f.p).join(" "), ini: ps[0].m.ini - ini, fim: ps[ps.length - 1].m.fim - ini }));
    // Cada legenda fica até a próxima começar (sem piscar nas pausas curtas).
    legendas.forEach((l, k) => { l.fim = legendas[k + 1] ? Math.max(l.fim, legendas[k + 1].ini - 0.02) : l.fim + 0.3; });

    clipes[i] = { arquivo: arquivo.split(path.sep).join("/"), dur: fim - ini, legendas };
  });
  saida[n] = { hash, clipes };
  console.log(`${nome}  ${total.toFixed(1)}s  ${texto.slice(0, 60)}${texto.length > 60 ? "…" : ""}`);
}
writeFileSync(path.join(VOZ, "falas.json"), JSON.stringify(saida, null, 1), "utf8");
console.log(`Voz: ${roteiro.voz} (${roteiro.ritmo})`);

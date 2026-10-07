// Vídeo demonstrativo do Finance HUB — tour por todos os módulos, 1920x1080.
//
// As telas são CAPTURAS REAIS do protótipo (dados fictícios), feitas por
// capturar.mjs e guardadas em capturas/. Aqui elas só ganham moldura e
// movimento: troca de tela, rolagem e cartões de capítulo.
//
// O roteiro (o que aparece e o que se fala) está em roteiro.json; os tempos
// vêm de /linha.json, que o render.mjs monta a partir da duração de cada fala.
//
// Tudo o que se move sai de render(t), com t em segundos. Não há relógio
// escondido (nem transition, nem animation), então o mesmo t desenha sempre o
// mesmo quadro: é o que deixa o render.mjs capturar quadro a quadro, e é o que
// faz o preview no navegador mostrar exatamente o que vai para o .mp4.
(() => {
  // ─── Matemática de animação ───────────────────────────────
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const p = (t, ini, dur) => clamp((t - ini) / dur); // progresso linear 0..1
  const sai = (x) => 1 - Math.pow(1 - x, 3); // desacelera no fim
  const vai = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const e = (t, ini, dur) => sai(p(t, ini, dur));
  const mix = (a, b, x) => a + (b - a) * x;
  const $ = (id) => document.getElementById(id);
  // Entra subindo: opacidade e deslocamento saem do mesmo progresso.
  const sobe = (el, t, ini, dur = 0.6, dy = 26) => {
    const x = e(t, ini, dur);
    el.style.opacity = x;
    el.style.transform = `translateY(${(1 - x) * dy}px)`;
  };
  const mostra = (el, sim) => { el.style.display = sim ? "" : "none"; };

  const LOGO = `<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1f1d1d"/><path d="M8 20.5l5.2-5.2 3.6 3.6L24 11.7" fill="none" stroke="#FF4D1C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 11.5h5.2v5.2" fill="none" stroke="#FF4D1C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Navegador: as capturas têm 1440 px CSS (2880 px reais) e aparecem com
  // 1620 px de largura. O menu (256 px) e a barra do topo (64 px) ficam
  // parados; só o conteúdo rola, como no app.
  const K = 1620 / 1440, AREA = 818, MENU = 256, TOPO = 64;
  const MAX_ROLAGEM = 760; // px na tela: rolar mais que isso numa tela de 3 s cansa

  let L = null; // a linha do tempo
  const el = {};

  function montar(linha) {
    L = linha;
    const web = L.blocos.filter((b) => b.tipo === "web").flatMap((b) => b.telas);
    const cel = L.blocos.find((b) => b.tipo === "celular");
    const abertura = L.blocos.find((b) => b.tipo === "abertura");
    const fim = L.blocos.find((b) => b.tipo === "fim");
    const capitulos = L.blocos.filter((b) => b.tipo === "capitulo");

    $("palco").innerHTML = `
    <div class="web" id="web">
      <div class="barra"><i></i><i></i><i></i><div class="url"><b>Finance HUB</b><span id="rotulo"></span></div></div>
      <div class="app">${web.map((s) => `<div class="tela">
        <img src="capturas/web/${s.arq}.png">
        <div class="rolo"><img src="capturas/web/${s.arq}.png"></div>
      </div>`).join("")}</div>
    </div>

    ${cel ? `<div class="mob" id="mob">
      <div class="halo" id="halo"></div>
      <div class="texto">
        <span class="olho" id="olho">APP ANDROID</span>
        <h2 id="titMob">${cel.titulo || ""}</h2>
      </div>
      <div class="fone" id="fone"><div class="visor">
        <div class="camera"></div>
        <div class="status"><span>9:41</span><span>5G ▮▮▮</span></div>
        <div class="telas">${cel.telas.map((s) => `<img src="capturas/celular/${s.arq}.png">`).join("")}</div>
      </div></div>
    </div>` : ""}

    ${capitulos.map((c) => `<div class="capitulo">
      <span class="num">${c.numero}</span>
      <h2>${c.titulo}</h2>
      <p>${c.sub || ""}</p>
    </div>`).join("")}

    ${abertura ? `<div class="escuro" id="abertura">
      <div class="brilho"></div>
      <div class="logo">${LOGO}<h2>Finance HUB</h2></div>
      <p class="lema">${abertura.titulo || ""}</p>
    </div>` : ""}

    ${fim ? `<div class="escuro" id="fim">
      <div class="brilho"></div>
      <div class="logo">${LOGO}<h2>Finance HUB</h2></div>
      <p class="lema">${fim.lema || ""}</p>
      <div class="pilulas">${(fim.pilulas || []).map((s) => `<span>${s}</span>`).join("")}</div>
      <div class="cta">${fim.botao || ""}</div>
      <p class="contato">${fim.contato || ""}</p>
    </div>` : ""}

    <div class="legenda" id="legenda"><span></span></div>
    <div class="avanco" id="avanco"></div>`;

    Object.assign(el, {
      web: $("web"), rotulo: $("rotulo"), telasWeb: [...document.querySelectorAll(".web .tela")], web_: web,
      mob: $("mob"), halo: $("halo"), olho: $("olho"), titMob: $("titMob"), fone: $("fone"),
      telasCel: [...document.querySelectorAll(".telas img")], cel,
      capitulos: [...document.querySelectorAll(".capitulo")].map((n, i) => ({ n, b: capitulos[i] })),
      abertura: $("abertura"), abertura_: abertura, fim: $("fim"), fim_: fim,
      legenda: $("legenda"), avanco: $("avanco"),
    });
  }

  // Cena escura (abertura e encerramento): logo cresce, o resto sobe em sequência.
  function cenaEscura(no, b, t) {
    const dentro = t >= b.ini - 0.1 && t < b.ini + b.dur + 0.1;
    mostra(no, dentro);
    if (!dentro) return;
    const fimDo = b.ini + b.dur;
    // A abertura sai esmaecendo para o 1º capítulo; o encerramento fica até o último quadro.
    no.style.opacity = no === el.abertura ? 1 - p(t, fimDo - 0.45, 0.45) : e(t, b.ini, 0.7);
    const tl = t - b.ini;
    no.querySelector(".brilho").style.transform = `scale(${1 + Math.sin(tl * 0.9) * 0.06})`;
    const lg = e(t, b.ini + 0.3, 0.9), logo = no.querySelector(".logo");
    logo.style.opacity = lg;
    logo.style.transform = `scale(${mix(0.86, 1, lg)})`;
    sobe(no.querySelector(".lema"), t, b.ini + 1.0, 0.7);
    no.querySelectorAll(".pilulas span").forEach((s, i) => sobe(s, t, b.ini + 2.6 + i * 0.25, 0.5, 20));
    const cta = no.querySelector(".cta");
    if (cta) {
      const ct = e(t, b.ini + 4.4, 0.6), tp = b.ini + 5.0;
      const pulso = t > tp ? Math.sin((t - tp) * 3.2) : 0;
      cta.style.opacity = ct;
      cta.style.transform = `translateY(${(1 - ct) * 26}px) scale(${1 + pulso * 0.018})`;
      cta.style.boxShadow = `0 ${18 + pulso * 4}px ${60 + pulso * 16}px -12px rgb(255 77 28 / ${0.55 + pulso * 0.15})`;
      sobe(no.querySelector(".contato"), t, b.ini + 5.4, 0.6, 16);
    }
  }

  // ─── O quadro no instante t ───────────────────────────────
  function render(t) {
    t = Math.min(L.duracao, Math.max(0, t));

    // Navegador: visível durante os blocos web; entra e sai por baixo dos capítulos.
    const blocosWeb = L.blocos.filter((b) => b.tipo === "web");
    const naWeb = blocosWeb.some((b) => t >= b.ini - 0.6 && t < b.ini + b.dur + 0.6);
    mostra(el.web, naWeb);
    if (naWeb) {
      const atual = [...el.web_.keys()].filter((i) => el.web_[i].ini <= t + 0.001).pop() ?? 0;
      el.web_.forEach((s, i) => {
        // Só a tela atual e a anterior (que ela cobre ao entrar) ficam no DOM visível.
        const tela = el.telasWeb[i];
        const ativa = i === atual || (i === atual - 1 && t < el.web_[atual].ini + 0.4);
        mostra(tela, ativa);
        if (!ativa) return;
        tela.style.opacity = i === atual ? e(t, s.ini, 0.35) : 1;
        tela.style.zIndex = i === atual ? 2 : 1;
        // Rolagem: parada no começo, desce devagar e para antes da próxima tela.
        const img = tela.lastElementChild.firstElementChild;
        const sobra = Math.min(MAX_ROLAGEM, Math.max(0, (img.naturalHeight / 2) * K - AREA - 0));
        const dur = s.fim - s.ini;
        const r = sobra ? vai(p(t, s.ini + Math.min(1.2, dur * 0.3), Math.max(0.8, dur * 0.6))) : 0;
        img.style.transform = `translateY(${-r * sobra}px)`;
      });
      const rot = el.web_[atual].rotulo || "";
      if (el.rotulo.textContent !== rot) el.rotulo.textContent = rot;
      // Um leve zoom contínuo dá vida às telas paradas.
      const bloco = blocosWeb.find((b) => t < b.ini + b.dur + 0.6) ?? blocosWeb[blocosWeb.length - 1];
      const vem = e(t, bloco.ini - 0.1, 0.8);
      el.web.style.opacity = vem;
      el.web.style.transform = `translateY(${(1 - vem) * 50}px) scale(${mix(0.97, 1, vem)})`;
    }

    // Celular: sobe girando, telas trocam esmaecendo.
    if (el.mob) {
      const b = el.cel, dentro = t >= b.ini - 0.1 && t < b.ini + b.dur + 0.1;
      mostra(el.mob, dentro);
      if (dentro) {
        const sobeFone = e(t, b.ini, 1.1);
        el.fone.style.opacity = sobeFone;
        el.fone.style.transform = `translateY(${(1 - sobeFone) * 260 + Math.sin(t * 1.3) * 5}px) rotate(${mix(5, 0, sobeFone)}deg)`;
        el.halo.style.opacity = e(t, b.ini + 0.2, 1.2) * 0.9;
        sobe(el.olho, t, b.ini + 0.3, 0.5);
        sobe(el.titMob, t, b.ini + 0.55, 0.7, 34);
        b.telas.forEach((s, i) => { el.telasCel[i].style.opacity = i === 0 ? 1 : e(t, s.ini, 0.3); });
      }
    }

    // Capítulos: cartão claro que cobre a troca de módulo.
    for (const { n, b } of el.capitulos) {
      const dentro = t >= b.ini - 0.4 && t < b.ini + b.dur + 0.5;
      mostra(n, dentro);
      if (!dentro) continue;
      n.style.opacity = e(t, b.ini - 0.35, 0.4) * (1 - p(t, b.ini + b.dur - 0.05, 0.45));
      sobe(n.querySelector(".num"), t, b.ini, 0.5, 30);
      sobe(n.querySelector("h2"), t, b.ini + 0.15, 0.6, 40);
      sobe(n.querySelector("p"), t, b.ini + 0.45, 0.6, 24);
    }

    if (el.abertura) cenaEscura(el.abertura, el.abertura_, t);
    if (el.fim) cenaEscura(el.fim, el.fim_, t);

    // Legenda acompanha a narração palavra a palavra; some nas pausas longas.
    const lg = L.legendas.find((l) => t >= l.ini && t < l.fim);
    if (lg && el.legenda.firstChild.textContent !== lg.texto) el.legenda.firstChild.textContent = lg.texto;
    el.legenda.style.opacity = lg ? Math.min(p(t, lg.ini, 0.12), 1 - p(t, lg.fim - 0.12, 0.12)) : 0;
    const escuro = [el.abertura_, el.fim_].some((b) => b && t >= b.ini && t < b.ini + b.dur);
    el.legenda.classList.toggle("sobre-escuro", escuro);
    el.avanco.style.width = `${(t / L.duracao) * 100}%`;
  }

  // ─── Preview no navegador (o render.mjs não usa esta parte) ─
  const emRender = new URLSearchParams(location.search).has("render");
  function preview() {
    const moldura = $("moldura"), botao = $("play"), barra = $("tempo"), relogio = $("relogio");
    barra.max = L.duracao;
    const ajusta = () => {
      const k = Math.min(innerWidth / 1920, (innerHeight - 56) / 1080);
      moldura.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, 0) scale(${k})`;
    };
    addEventListener("resize", ajusta);
    ajusta();

    // Narração: os mesmos .wav que vão para o .mp4.
    const audios = L.audios.map((a) => ({ ...a, el: Object.assign(new Audio(a.arquivo), { preload: "auto" }) }));
    let t = 0, tocando = false, base = 0;
    const calar = () => audios.forEach((a) => a.el.pause());
    const narrar = () => audios.forEach((a) => {
      const dentro = t >= a.ini && t < a.ini + (a.el.duration || 0);
      if (dentro && a.el.paused) { a.el.currentTime = t - a.ini; a.el.play().catch(() => {}); }
      if (!dentro && !a.el.paused) a.el.pause();
    });
    const relogioDe = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const desenha = () => {
      render(t);
      barra.value = t;
      relogio.textContent = `${relogioDe(t)} / ${relogioDe(L.duracao)}`;
    };
    const passo = (agora) => {
      if (!tocando) return;
      t = (agora - base) / 1000;
      if (t >= L.duracao) { t = L.duracao; tocando = false; botao.textContent = "▶ Reproduzir"; calar(); }
      else narrar();
      desenha();
      if (tocando) requestAnimationFrame(passo);
    };
    botao.onclick = () => {
      tocando = !tocando;
      botao.textContent = tocando ? "❚❚ Pausar" : "▶ Reproduzir";
      if (!tocando) return calar();
      if (t >= L.duracao) t = 0;
      base = performance.now() - t * 1000;
      requestAnimationFrame(passo);
    };
    barra.oninput = () => { t = +barra.value; base = performance.now() - t * 1000; calar(); desenha(); };
    desenha();
  }

  async function iniciar() {
    const linha = await fetch("linha.json").then((r) => r.json());
    montar(linha);
    await document.fonts.ready;
    // Sem as capturas o vídeo sairia com telas em branco: melhor parar e dizer.
    const imgs = [...document.querySelectorAll("#palco img")];
    const faltando = (await Promise.all(imgs.map((img) => img.decode().then(() => null, () => img.getAttribute("src"))))).filter(Boolean);
    if (faltando.length) {
      window.__erro = `Capturas faltando: ${[...new Set(faltando)].join(", ")}. Rode node capturar.mjs.`;
      document.body.insertAdjacentHTML("beforeend", `<p class="erro">${window.__erro}</p>`);
    }
    if (emRender) document.body.classList.add("render");
    else preview();
    render(0);
    window.__render = render;
    window.__duracao = L.duracao;
    window.__pronto = true;
  }
  iniciar();
})();

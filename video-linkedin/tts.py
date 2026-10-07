# Voz neural (Microsoft Edge, via edge-tts): gera o .mp3 de um texto e o
# instante de cada palavra falada. Quem chama é o narrar.mjs.
#
#   python tts.py <voz> <ritmo> <texto.txt> <saida.mp3> <palavras.json>
#
# Instale uma vez:  pip install edge-tts
import asyncio, json, sys
import edge_tts

voz, ritmo, entrada, mp3, palavras = sys.argv[1:6]

async def main():
    texto = open(entrada, encoding="utf-8").read()
    fala = edge_tts.Communicate(texto, voz, rate=ritmo, boundary="WordBoundary")
    marcas = []
    with open(mp3, "wb") as f:
        async for parte in fala.stream():
            if parte["type"] == "audio":
                f.write(parte["data"])
            elif parte["type"] == "WordBoundary":
                # offset/duration vêm em unidades de 100 ns
                marcas.append({"ini": parte["offset"] / 1e7, "fim": (parte["offset"] + parte["duration"]) / 1e7, "texto": parte["text"]})
    with open(palavras, "w", encoding="utf-8") as f:
        json.dump(marcas, f, ensure_ascii=False)

asyncio.run(main())

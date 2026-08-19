# Login HTTP no servidor Ozi (mesmo endpoint /api/auth/login que a pagina
# web, o app Android e o fake-device.js usam) - devolve o token JWT que o
# WebSocket vai usar pra autenticar. Escrito com socket cru (via
# asyncio.open_connection) em vez de alguma lib tipo "requests" pra nao
# precisar instalar mais nada no firmware so pra uma chamada.

import asyncio
import ujson as json

AUTH_PATH = "device_auth.json"


def carregar_config():
    try:
        with open(AUTH_PATH) as f:
            return json.load(f)
    except OSError:
        return None


def salvar_config(servidor, email, senha):
    with open(AUTH_PATH, "w") as f:
        json.dump({"servidor": servidor, "email": email, "senha": senha}, f)


async def _post_json(servidor_https, caminho, corpo, timeout_s=15):
    seguro = servidor_https.startswith("https://")
    resto = servidor_https[8:] if seguro else servidor_https[7:]
    if ":" in resto:
        host, porta = resto.split(":", 1)
        porta = int(porta)
    else:
        host = resto
        porta = 443 if seguro else 80

    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(host, porta, ssl=seguro, server_hostname=host if seguro else None),
        timeout_s,
    )

    payload = json.dumps(corpo).encode()
    writer.write(b"POST %s HTTP/1.1\r\n" % caminho.encode())
    writer.write(b"Host: %s\r\n" % host.encode())
    writer.write(b"Content-Type: application/json\r\n")
    writer.write(b"Content-Length: %d\r\n" % len(payload))
    writer.write(b"Connection: close\r\n\r\n")
    writer.write(payload)
    await writer.drain()

    linha_status = await asyncio.wait_for(reader.readline(), timeout_s)

    cabecalhos = {}
    while True:
        linha = await asyncio.wait_for(reader.readline(), timeout_s)
        if linha in (b"\r\n", b"\n", b""):
            break
        if b":" in linha:
            chave, valor = linha.split(b":", 1)
            cabecalhos[chave.strip().lower()] = valor.strip()

    # O servidor (Node.js) manda a resposta em "chunked transfer-encoding"
    # quando nao sabe o tamanho final de antemao (o caso normal pra JSON
    # gerado na hora) - sem decodificar isso, o corpo vem com marcadores de
    # tamanho de pedaco (tipo "30\r\n...\r\n0\r\n\r\n") misturados no meio
    # do JSON, quebrando o parse.
    if cabecalhos.get(b"transfer-encoding", b"").lower() == b"chunked":
        pedacos = []
        while True:
            linha_tamanho = await asyncio.wait_for(reader.readline(), timeout_s)
            tamanho = int(linha_tamanho.strip(), 16)
            if tamanho == 0:
                break
            pedacos.append(await asyncio.wait_for(reader.readexactly(tamanho), timeout_s))
            await asyncio.wait_for(reader.readexactly(2), timeout_s)  # \r\n depois do pedaco
        corpo_resposta = b"".join(pedacos)
    elif b"content-length" in cabecalhos:
        tamanho = int(cabecalhos[b"content-length"])
        corpo_resposta = await asyncio.wait_for(reader.readexactly(tamanho), timeout_s)
    else:
        corpo_resposta = await asyncio.wait_for(reader.read(), timeout_s)

    writer.close()

    if b"200" not in linha_status and b"201" not in linha_status:
        raise OSError("login falhou (%s): %s" % (linha_status, corpo_resposta))

    return json.loads(corpo_resposta)


async def login(servidor_https, email, senha):
    resposta = await _post_json(servidor_https, "/api/auth/login", {"email": email, "senha": senha})
    if not resposta.get("ok"):
        raise OSError(resposta.get("erro", "login falhou"))
    return resposta["token"]

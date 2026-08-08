# Deploy no EasyPanel

## Antes de comecar

O projeto virou multiusuario nesta etapa - qualquer pessoa com o link pode
criar conta e usar o proprio Ozi (dados isolados por usuario). Isso muda um
pouco o que precisa configurar comparado a Fase 1 local.

## 1. Variaveis de ambiente

No EasyPanel, cada "app" tem uma aba de Environment Variables. Copie o
conteudo do seu `.env` local (NUNCA comite esse arquivo no git) - as
chaves obrigatorias sao:

```
ANTHROPIC_API_KEY=...
JWT_SECRET=...              (gere um NOVO, diferente do local: openssl rand -hex 32)
FISH_AUDIO_API_KEY=...
FISH_AUDIO_VOICE_ID=...
TUYA_CLIENT_ID=...
TUYA_CLIENT_SECRET=...
TUYA_PROJECT_CODE=...
TUYA_ENDPOINT=...
TUYA_UID=...
GOOGLE_CLIENT_ID=...        (depois que configurar o Firebase)
```

`JARVIS_WS_PORT`/`JARVIS_WEB_PORT` nao precisam ser definidas - o EasyPanel
controla a porta externa; o container sempre escuta 8787/8788 internamente
(ver Dockerfile).

## 2. Criar os dois apps

Este projeto sobe **dois processos separados** a partir da MESMA imagem
Docker (ver comentario no topo do `Dockerfile`):

1. **App "ozi-cerebro"**: build a partir deste repositorio (Dockerfile na
   raiz), Start Command = `node src/server.js`, porta interna 8787,
   protocolo **WebSocket** - o dominio dele e o que voce coloca em
   "Servidor" nas Configuracoes do app Android/pagina web, como
   `wss://ws.seudominio.com` (o EasyPanel/Traefik cuida do TLS - use
   `wss://`, nunca `ws://`, em producao).

2. **App "ozi-web"**: mesma imagem, Start Command = `node src/webServer.js`,
   porta interna 8788, protocolo HTTP - o dominio dele e onde fica o painel
   (`https://app.seudominio.com/admin.html`) e a API REST de login
   (`/api/auth/login`, `/api/auth/registrar`).

**Os dois APPS PRECISAM DO MESMO VOLUME** apontando pra `/app/data` -
e onde fica o banco SQLite com usuarios, conversas e memoria. Se cada um
tiver seu proprio volume, os usuarios cadastrados via "ozi-web" nao vao
existir pro "ozi-cerebro" (mesmo banco, tem que ser o mesmo arquivo).
No EasyPanel isso normalmente se configura criando um "Volume" compartilhado
e montando ele nos dois apps no mesmo caminho.

## 3. DNS / dominios

Aponte dois subdominios pros dois apps (o EasyPanel cuida do certificado
TLS automatico via Let's Encrypt quando voce adiciona o dominio no app):

- `ws.seudominio.com` -> app ozi-cerebro (porta 8787)
- `app.seudominio.com` -> app ozi-web (porta 8788)

## 4. Depois do primeiro deploy

- Abra `https://app.seudominio.com/admin.html`, crie sua conta
- No app Android (Configuracoes), coloque `wss://ws.seudominio.com` como
  URL do servidor
- Teste uma conversa completa antes de considerar "no ar" de verdade

## 5. O que ainda fica pendente (fora do escopo deste deploy)

- **Backup do banco**: o SQLite fica so no volume - configure backup
  periodico do volume no EasyPanel (ou exporte `data/jarvis.db`
  manualmente de vez em quando).
- **Google Sign-In**: so funciona depois de criar o projeto Firebase e
  preencher `GOOGLE_CLIENT_ID` (servidor) + `google_web_client_id`
  (app Android, `res/values/strings.xml`).
- **Notificacoes push**: idem, depende do Firebase (google-services.json).

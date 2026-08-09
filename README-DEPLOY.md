# Deploy no EasyPanel

## Antes de comecar

O projeto virou multiusuario nesta etapa - qualquer pessoa com o link pode
criar conta e usar o proprio Ozi (dados isolados por usuario). Isso muda um
pouco o que precisa configurar comparado a Fase 1 local.

Desde esta versao, o servidor roda como **UM SO processo numa unica porta**
(`src/app.js`) - a mesma porta serve as paginas, a API REST de login e o
WebSocket da conversa. Isso existe porque a maioria dos PaaS (EasyPanel
incluso) so mapeia uma porta por app, e ter dois processos separados so
gerava confusao (dominio apontando pra porta errada, processo errado
subindo, etc).

## 1. Variaveis de ambiente

No EasyPanel, o app tem uma aba de Environment Variables. Copie o conteudo
do seu `.env` local (NUNCA comite esse arquivo no git) - as chaves
obrigatorias sao:

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
FIREBASE_SERVICE_ACCOUNT=...
```

Nao e obrigatorio definir `PORT` - o padrao e `8787`. Se o EasyPanel exigir
uma porta especifica, defina `PORT` com esse valor.

## 2. Criar o app

Um unico app a partir deste repositorio (Dockerfile na raiz):

- **Fonte**: este repositorio Git, build via Dockerfile
- **Start Command**: nao precisa sobrescrever - o `CMD` do Dockerfile ja e
  `node src/app.js`
- **Porta interna**: `8787` (a que o container escuta - ver `EXPOSE` no
  Dockerfile e a variavel `PORT`)
- **Dominio**: aponte o dominio/subdominio do EasyPanel pra essa mesma
  porta interna (8787). E nele que ficam TUDO: a pagina inicial (`/`), o
  painel (`/admin.html`), a API REST (`/api/...`) e o WebSocket (mesmo
  host/porta, so troca `https://` por `wss://`).

**Volume**: monte um volume persistente em `/app/data` - e onde fica o
banco SQLite (usuarios, conversas, memoria). Sem isso, cada novo deploy
apaga os usuarios cadastrados.

## 3. DNS / dominio

Aponte um subdominio pro app (o EasyPanel cuida do certificado TLS
automatico via Let's Encrypt quando voce adiciona o dominio):

- `app.seudominio.com` -> este app (porta interna 8787)

## 4. Depois do primeiro deploy

- Abra `https://app.seudominio.com/`, crie sua conta
- No app Android (tela de login, campo "Servidor"), coloque
  `wss://app.seudominio.com` como URL do servidor
- Teste uma conversa completa antes de considerar "no ar" de verdade

## 5. O que ainda fica pendente (fora do escopo deste deploy)

- **Backup do banco**: o SQLite fica so no volume - configure backup
  periodico do volume no EasyPanel (ou exporte `data/jarvis.db`
  manualmente de vez em quando).
- **Google Sign-In**: so funciona depois de criar o projeto Firebase e
  preencher `GOOGLE_CLIENT_ID` (servidor) + `google_web_client_id`
  (app Android, `res/values/strings.xml`).
- **Notificacoes push**: idem, depende do Firebase (google-services.json).

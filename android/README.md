# Ozi - App Android

App nativo que conecta no mesmo servidor Node.js do Ozi (`../src/server.js`)
pelo WebSocket, com ativacao por voz ("Ozi") em segundo plano.

## Como abrir e rodar

1. Abra a pasta `android/` no Android Studio (File -> Open)
2. Deixe o Gradle sincronizar (primeira vez baixa as dependencias, pode
   demorar alguns minutos)
3. Conecte seu celular por USB com "Depuracao USB" ativada (Configuracoes
   -> Sobre o telefone -> toque 7x em "Numero da versao" pra liberar
   opcoes de desenvolvedor -> ativa "Depuracao USB"), ou use um emulador
4. Clique em Run (▶)

## Configuracao na primeira vez que abrir o app

Vai pedir permissao de microfone e notificacoes - aceite (sem microfone o
app so funciona digitando texto, sem voz).

Depois, va em Configuracoes (engrenagem no topo) e preencha:

- **Servidor**: o endereco do seu servidor Jarvis/Ozi. Se o celular estiver
  na mesma rede Wi-Fi que o PC rodando `npm run server`, use o IP local do
  PC, tipo `ws://192.168.0.10:8787` (descubra o IP com `ipconfig` no
  PowerShell). **Nao** funciona com `localhost` - isso apontaria pro
  proprio celular, nao pro seu PC.
- **Nome deste dispositivo**: aparece no painel administrativo
  (`localhost:8788/admin.html`) igual aos outros dispositivos.
- **Chave da Picovoice**: opcional por enquanto (ver secao abaixo).

Depois de salvar, o app tenta conectar e o Android vai perguntar se pode
ignorar a otimizacao de bateria pro app - aceite, senao o wake word para de
funcionar depois de um tempo com a tela apagada.

## Ativar o "Ozi" por voz (wake word)

Sem isso configurado, o app funciona 100% normal com o botao "Falar" na
tela - so a ativacao em segundo plano/tela bloqueada que fica desligada.

1. Crie conta gratis em **console.picovoice.ai**
2. Pegue sua **AccessKey** (painel principal) e cole em
   Configuracoes -> "Chave da Picovoice"
3. Na aba **Porcupine** do console, clique em criar wake word customizada,
   digite "Ozi", escolha a plataforma **Android**, treine e baixe o
   arquivo `.ppn` gerado
4. Renomeie esse arquivo pra `ozi_android.ppn` e coloque em
   `android/app/src/main/assets/ozi_android.ppn`
5. Recompile e reinstale o app (Run de novo no Android Studio)

## Seguranca

- Config do servidor e a chave da Picovoice ficam em
  `EncryptedSharedPreferences` (criptografadas no disco do celular), nao em
  texto puro - ver `data/SecurePrefs.kt`.
- Builds de **release** so aceitam `wss://` (conexao criptografada) - o
  `ws://` sem criptografia so e permitido em builds de **debug**, pra testar
  contra o servidor local sem HTTPS ainda (ver
  `network_security_config.xml` vs `src/debug/.../network_security_config.xml`).
- Antes de gerar uma versao pra instalar no celular de outra pessoa,
  configure assinatura de release de verdade (hoje so tem build debug,
  assinado com uma chave de teste automatica do Android Studio).

## O que falta pra "virar produto" (fora do escopo de hoje)

- **Assistente padrao do sistema**: pra funcionar exatamente como o Google
  Assistente (segurar o botao home, etc), precisa implementar
  `VoiceInteractionService` e o app ser escolhido em Configuracoes ->
  Apps padrao -> Assistente digital. E um passo bem mais avancado que fica
  pra depois de validar essa primeira versao.
- **Multiplos usuarios/contas**: hoje o backend (`server.js`) e single-user
  - nao tem sistema de login. O app ja guarda tudo de forma segura e nao
  assume nada hardcoded sobre "so existe um usuario", entao quando o
  backend ganhar contas de verdade, a tela de Configuracoes e o
  `SecurePrefs` sao os lugares certos pra adicionar um campo de
  login/token, sem precisar reescrever o resto do app.
- **Renomear pra Ozi no backend tambem**: o `server.js` ainda chama o
  assistente de "Jarvis" no system prompt - vale trocar pra "Ozi" pra ficar
  consistente com o nome do app.


// Ponto de entrada UNICO do Ozi: um so processo, uma so porta, servindo
// paginas/API HTTP e WebSocket ao mesmo tempo (o WebSocket "pega carona"
// no mesmo servidor HTTP via upgrade automatico da biblioteca `ws`).
//
// Antes disso existiam dois arquivos/processos separados (server.js na
// porta 8787 pro WebSocket, webServer.js na porta 8788 pro HTTP) - unificado
// porque a maioria dos PaaS/paineis (EasyPanel incluso) so mapeia UMA porta
// por app, e ter dois processos tambem exigia lembrar de subir os dois
// toda vez em desenvolvimento local (fonte de bugs bobos).
import { config } from './config.js';
import { criarServidorHttp } from './webServer.js';
import { iniciarServidor } from './server.js';

const httpServer = criarServidorHttp();
iniciarServidor(httpServer);

httpServer.listen(config.port, () => {
  console.log(`[app] Ozi ouvindo em http://localhost:${config.port} (paginas, API e WebSocket, tudo na mesma porta)`);
  console.log(`[app] painel administrativo em http://localhost:${config.port}/admin.html`);
});

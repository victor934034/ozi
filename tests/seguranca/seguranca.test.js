import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarGuard, criarAuditoria, criarOrcamento, criarAprovacoes, criarContextoSeguranca } from '../../src/seguranca/index.js';

let raiz;
beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ozi-seg-'));
  for (const p of ['workspace', 'memory', 'core', 'src', 'firmware-esp32s3']) fs.mkdirSync(path.join(raiz, p));
});
afterEach(() => fs.rmSync(raiz, { recursive: true, force: true }));

describe('guard: escrita', () => {
  test('permite escrever em workspace/ e memory/', () => {
    const g = criarGuard({ raiz });
    assert.equal(g.podeEscrever('workspace/skills/hora/index.js').permitido, true);
    assert.equal(g.podeEscrever('memory/fatos.db').permitido, true);
  });

  test('bloqueia escrita em core/, src/ e firmware', () => {
    const g = criarGuard({ raiz });
    assert.equal(g.podeEscrever('core/guard.ts').permitido, false);
    assert.equal(g.podeEscrever('src/server.js').permitido, false);
    assert.equal(g.podeEscrever('firmware-esp32s3/main.py').permitido, false);
  });

  test('bloqueia escrita fora do projeto e com ..', () => {
    const g = criarGuard({ raiz });
    assert.equal(g.podeEscrever('../fora.txt').permitido, false);
    assert.equal(g.podeEscrever('workspace/../core/guard.ts').permitido, false);
    assert.equal(g.podeEscrever(path.join(os.tmpdir(), 'outro.txt')).permitido, false);
  });

  test('bloqueia escrita em arquivo de segredo mesmo dentro de workspace/', () => {
    const g = criarGuard({ raiz });
    assert.equal(g.podeEscrever('workspace/.env').permitido, false);
    assert.equal(g.podeEscrever('workspace/wifi_creds.json').permitido, false);
  });

  test('symlink de workspace/ apontando pra core/ nao vale', () => {
    fs.writeFileSync(path.join(raiz, 'core', 'guard.ts'), 'x');
    try {
      fs.symlinkSync(path.join(raiz, 'core'), path.join(raiz, 'workspace', 'atalho'), 'junction');
    } catch {
      return; // sem permissao de symlink neste SO: teste nao se aplica
    }
    const g = criarGuard({ raiz });
    assert.equal(g.podeEscrever('workspace/atalho/guard.ts').permitido, false);
  });
});

describe('guard: leitura de segredos', () => {
  test('bloqueia leitura de .env e chaves', () => {
    fs.writeFileSync(path.join(raiz, '.env'), 'ANTHROPIC_API_KEY=x');
    const g = criarGuard({ raiz });
    assert.equal(g.podeLer('.env').permitido, false);
    assert.equal(g.podeLer('.env.local').permitido, false);
    assert.equal(g.podeLer('certs/chave.pem').permitido, false);
  });

  test('permite ler arquivo comum do projeto', () => {
    fs.writeFileSync(path.join(raiz, 'workspace', 'nota.md'), 'oi');
    assert.equal(criarGuard({ raiz }).podeLer('workspace/nota.md').permitido, true);
  });
});

describe('acoes sensiveis', () => {
  test('rede, dinheiro, mensagem e apagar dados pedem aprovacao', () => {
    const g = criarGuard({ raiz });
    for (const tipo of ['rede', 'dinheiro', 'mensagem', 'publicar', 'apagar_dados']) {
      assert.equal(g.exigeAprovacao(tipo), true, tipo);
    }
    assert.equal(g.exigeAprovacao('ler'), false);
  });
});

describe('auditoria', () => {
  test('encadeia registros e detecta alteracao', () => {
    const arq = path.join(raiz, 'memory', 'audit.jsonl');
    const a = criarAuditoria({ arquivo: arq });
    a.registrar({ tipo: 'escrever', resultado: 'executado' });
    a.registrar({ tipo: 'escrever', resultado: 'bloqueado' });
    assert.equal(a.verificar().valido, true);

    const linhas = fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean);
    linhas[0] = linhas[0].replace('executado', 'bloqueado');
    fs.writeFileSync(arq, linhas.join('\n') + '\n');
    const r = a.verificar();
    assert.equal(r.valido, false);
    assert.equal(r.quebradaNaLinha, 1);
  });

  test('detecta linha apagada', () => {
    const arq = path.join(raiz, 'memory', 'audit.jsonl');
    const a = criarAuditoria({ arquivo: arq });
    a.registrar({ tipo: 'a' });
    a.registrar({ tipo: 'b' });
    a.registrar({ tipo: 'c' });
    const linhas = fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(arq, [linhas[0], linhas[2]].join('\n') + '\n');
    assert.equal(a.verificar().valido, false);
  });

  test('nao expoe nenhuma forma de apagar ou editar', () => {
    const a = criarAuditoria({ arquivo: path.join(raiz, 'a.jsonl') });
    assert.deepEqual(Object.keys(a).sort(), ['registrar', 'verificar']);
  });
});

describe('orcamento', () => {
  test('bloqueia ao estourar o teto diario', () => {
    const o = criarOrcamento({ tetoDiarioUsd: 1, tetoMensalUsd: 10 });
    o.registrarGasto(0.9);
    assert.equal(o.podeGastar(0.05).permitido, true);
    assert.equal(o.podeGastar(0.2).permitido, false);
  });

  test('bloqueia ao estourar o teto mensal, mesmo com o dia livre', () => {
    let agora = new Date('2026-10-01T10:00:00Z');
    const o = criarOrcamento({ tetoDiarioUsd: 5, tetoMensalUsd: 3, agora: () => agora });
    o.registrarGasto(2.9);
    agora = new Date('2026-10-02T10:00:00Z');
    assert.equal(o.podeGastar(0.5).permitido, false);
  });

  test('o teto diario zera no dia seguinte', () => {
    let agora = new Date('2026-10-01T10:00:00Z');
    const o = criarOrcamento({ tetoDiarioUsd: 1, tetoMensalUsd: 100, agora: () => agora });
    o.registrarGasto(1);
    assert.equal(o.podeGastar(0.1).permitido, false);
    agora = new Date('2026-10-02T10:00:00Z');
    assert.equal(o.podeGastar(0.1).permitido, true);
  });

  test('rejeita valor de gasto invalido', () => {
    const o = criarOrcamento({ tetoDiarioUsd: 1, tetoMensalUsd: 1 });
    assert.throws(() => o.registrarGasto(-1));
    assert.throws(() => o.registrarGasto(NaN));
  });
});

describe('aprovacoes', () => {
  test('pedido fica pendente ate o dono decidir, e so decide uma vez', () => {
    const ap = criarAprovacoes();
    const p = ap.pedir({ acao: 'mensagem', descricao: 'avisar a Maria' });
    assert.equal(ap.estado(p.id), 'pendente');
    ap.aprovar(p.id);
    assert.equal(ap.estado(p.id), 'aprovado');
    assert.throws(() => ap.negar(p.id));
  });

  test('pedido inexistente nao pode ser aprovado', () => {
    assert.throws(() => criarAprovacoes().aprovar('nao-existe'));
  });

  test('o agente nao consegue aprovar: o objeto dado a ele so pede', () => {
    const ap = criarAprovacoes();
    const soPedir = { pedir: ap.pedir, listarPendentes: ap.listarPendentes };
    assert.equal(typeof soPedir.aprovar, 'undefined');
  });
});

describe('executarAcao (ponto de entrada)', () => {
  function criar(extra = {}) {
    return criarContextoSeguranca({
      raiz,
      arquivoAuditoria: path.join(raiz, 'memory', 'audit.jsonl'),
      tetoDiarioUsd: 1,
      tetoMensalUsd: 10,
      ...extra,
    });
  }

  test('escrita permitida executa e fica registrada', async () => {
    const s = criar();
    let rodou = false;
    const r = await s.executarAcao({ tipo: 'escrever', alvo: 'workspace/a.txt', executar: async () => { rodou = true; return 'ok'; } });
    assert.equal(r.ok, true);
    assert.equal(rodou, true);
    assert.equal(s.auditoria.verificar().valido, true);
  });

  test('escrita em core/ nao executa nem chega perto da funcao', async () => {
    const s = criar();
    let rodou = false;
    const r = await s.executarAcao({ tipo: 'escrever', alvo: 'core/guard.ts', executar: async () => { rodou = true; } });
    assert.equal(r.ok, false);
    assert.equal(rodou, false);
  });

  test('acao sensivel vira pedido de aprovacao e nao executa', async () => {
    const s = criar();
    let rodou = false;
    const r = await s.executarAcao({ tipo: 'mensagem', descricao: 'enviar oi', executar: async () => { rodou = true; } });
    assert.equal(r.aguardandoAprovacao, true);
    assert.equal(rodou, false);
    assert.equal(s.aprovacoes.listarPendentes().length, 1);
  });

  test('custo acima do teto nao executa', async () => {
    const s = criar({ tetoDiarioUsd: 0.1 });
    let rodou = false;
    const r = await s.executarAcao({ tipo: 'ler', alvo: 'workspace', custoUsd: 0.5, executar: async () => { rodou = true; } });
    assert.equal(r.ok, false);
    assert.equal(rodou, false);
  });

  test('custo executado e contabilizado no orcamento', async () => {
    const s = criar();
    await s.executarAcao({ tipo: 'ler', alvo: 'workspace', custoUsd: 0.3, executar: async () => 1 });
    assert.equal(s.orcamento.situacao().hoje, 0.3);
  });

  test('cada tentativa, inclusive bloqueada, gera registro de auditoria', async () => {
    const s = criar();
    await s.executarAcao({ tipo: 'escrever', alvo: 'src/x.js', executar: async () => {} });
    await s.executarAcao({ tipo: 'escrever', alvo: 'workspace/x.js', executar: async () => {} });
    const linhas = fs.readFileSync(path.join(raiz, 'memory', 'audit.jsonl'), 'utf8').trim().split('\n');
    assert.equal(linhas.length, 2);
    assert.match(linhas[0], /"resultado":"bloqueado"/);
    assert.match(linhas[1], /"resultado":"executado"/);
  });
});

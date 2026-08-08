import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// Devolve { texto, uso } - "uso" traz os tokens de entrada/saida que a API
// retornou, pra dar pra calcular custo depois (ver config.claudePrecos e
// src/memory/sqlite.js -> registrarUsoClaude).
export async function askClaude({ system, messages, maxTokens = 1024 }) {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: maxTokens,
    system,
    messages,
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const texto = textBlock ? textBlock.text : '';

  return {
    texto,
    uso: {
      tokensEntrada: response.usage.input_tokens,
      tokensSaida: response.usage.output_tokens,
    },
  };
}

// Versao "crua" usada quando o Claude precisa poder chamar ferramentas
// (tool use) - ex: controlar dispositivos da casa por linguagem natural,
// em vez de comandos fixos tipo "casa: ligar quarto". Devolve a resposta
// inteira da API (sem extrair so o texto), porque quem chama precisa ver
// `stop_reason` (pra saber se o Claude quer usar uma ferramenta) e os
// blocos de `content` crus (pra devolver pro Claude no proximo turno).
export async function askClaudeComFerramentas({ system, messages, tools, maxTokens = 1024 }) {
  return client.messages.create({
    model: config.claudeModel,
    max_tokens: maxTokens,
    system,
    messages,
    tools,
  });
}

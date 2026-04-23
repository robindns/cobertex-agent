// src/agent.js
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memorandoTools = require('./tools/memorando');
const clienteTools = require('./tools/clientes');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ─── Definição das ferramentas disponíveis para o Claude ────────────────────

const TOOLS = [
  {
    name: 'criar_memorando',
    description: `Cria um memorando operacional no sistema Cobertex. 
Use quando o usuário quiser registrar: saída de equipes, chegada em obras, 
relatórios de campo, ocorrências, checklist de veículos, qualquer relato do dia a dia.
Detecte automaticamente urgência (palavras: urgente, emergência, problema grave, quebrou, acidente).
Gere tags relevantes como: saida, chegada, equipe, caminhao, montagem, desmontagem, cliente, manutencao, ocorrencia.`,
    input_schema: {
      type: 'object',
      properties: {
        titulo: {
          type: 'string',
          description: 'Título conciso do memorando (ex: "Saída equipe - Cliente X - 23/04")',
        },
        conteudo: {
          type: 'string',
          description: 'Conteúdo completo do relato, formatado e organizado',
        },
        criador_id: {
          type: 'string',
          description: 'ID do usuário no sistema que está criando o memorando',
        },
        cliente_id: {
          type: 'string',
          description: 'ID do cliente relacionado (se mencionado)',
        },
        instalacao_id: {
          type: 'string',
          description: 'ID da instalação relacionada (se mencionada)',
        },
        urgente: {
          type: 'boolean',
          description: 'Se o memorando é urgente',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags para categorização',
        },
        anexos: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs de imagens ou arquivos anexos',
        },
      },
      required: ['titulo', 'conteudo', 'criador_id'],
    },
  },
  {
    name: 'listar_memorandos',
    description: 'Lista memorandos recentes do sistema. Use quando o usuário perguntar sobre registros anteriores, o que foi anotado, histórico do dia, etc.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: {
          type: 'string',
          description: 'Filtrar por cliente (opcional)',
        },
        status: {
          type: 'string',
          enum: ['pendente', 'concluido'],
          description: 'Filtrar por status (opcional)',
        },
        limit: {
          type: 'number',
          description: 'Quantidade máxima de resultados (padrão: 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'concluir_memorando',
    description: 'Marca um memorando como concluído. Use quando o usuário disser que uma tarefa foi finalizada, chegaram ao destino, obra concluída, etc.',
    input_schema: {
      type: 'object',
      properties: {
        memorando_id: {
          type: 'string',
          description: 'ID do memorando a ser concluído',
        },
      },
      required: ['memorando_id'],
    },
  },
  {
    name: 'buscar_cliente',
    description: 'Busca clientes no sistema pelo nome. Use para encontrar o ID de um cliente quando mencionado pelo usuário.',
    input_schema: {
      type: 'object',
      properties: {
        nome: {
          type: 'string',
          description: 'Nome ou parte do nome do cliente',
        },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_instalacoes_cliente',
    description: 'Lista instalações de um cliente específico.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: {
          type: 'string',
          description: 'ID do cliente',
        },
      },
      required: ['cliente_id'],
    },
  },
  {
    name: 'notificar_robinson',
    description: `Use quando o usuário solicitar algo completamente fora do escopo operacional/memorandos 
(ex: questões financeiras complexas, alterações no CRM de vendas, bugs no sistema, 
funcionalidades inexistentes). Registra a solicitação para que Robinson resolva.`,
    input_schema: {
      type: 'object',
      properties: {
        solicitante: {
          type: 'string',
          description: 'Nome de quem está solicitando',
        },
        descricao: {
          type: 'string',
          description: 'Descrição do que foi solicitado e está fora do escopo',
        },
      },
      required: ['solicitante', 'descricao'],
    },
  },
];

// ─── Execução das ferramentas ────────────────────────────────────────────────

async function executarFerramenta(nome, input) {
  console.log(`[agent] Executando ferramenta: ${nome}`, JSON.stringify(input));

  switch (nome) {
    case 'criar_memorando':
      return memorandoTools.criarMemorando(input);

    case 'listar_memorandos':
      return memorandoTools.listarMemorandos(input);

    case 'concluir_memorando':
      return memorandoTools.concluirMemorando(input);

    case 'buscar_cliente':
      return clienteTools.buscarCliente(input);

    case 'listar_instalacoes_cliente':
      return clienteTools.listarInstalacoesCliente(input);

    case 'notificar_robinson':
      // Retorna a notificação — o index.js enviará a mensagem para Robinson
      return {
        __notificar_robinson: true,
        solicitante: input.solicitante,
        descricao: input.descricao,
      };

    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

// ─── Sistema de contexto por usuário ────────────────────────────────────────

// Mantém histórico por número para conversas multi-turno (apenas em memória)
const historicos = {};
const MAX_HISTORICO = 20; // mensagens por usuário

function obterHistorico(numero) {
  if (!historicos[numero]) historicos[numero] = [];
  return historicos[numero];
}

function adicionarAoHistorico(numero, role, content) {
  const hist = obterHistorico(numero);
  hist.push({ role, content });
  // Limita o histórico
  if (hist.length > MAX_HISTORICO) {
    historicos[numero] = hist.slice(-MAX_HISTORICO);
  }
}

// ─── Processamento principal ─────────────────────────────────────────────────

/**
 * Processa uma mensagem e retorna a resposta
 * @param {object} params
 * @param {string} params.numero - Número do remetente
 * @param {object} params.usuario - { nome, user_id, role }
 * @param {string} params.texto - Texto da mensagem (já transcrito se era áudio)
 * @param {string|null} params.imagemBase64 - Imagem em base64 se houver
 * @param {string|null} params.imagemMimeType - MIME type da imagem
 * @param {string|null} params.descricaoImagem - Descrição gerada pela IA da imagem
 * @returns {Promise<{ resposta: string, notificarRobinson?: object }>}
 */
async function processarMensagem({ numero, usuario, texto, imagemBase64, imagemMimeType, descricaoImagem }) {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

  const systemPrompt = `Você é o assistente IA da Cobertex, empresa de coberturas e galpões em São Paulo.
Hoje é ${hoje}.

## Seu papel
Você atende a equipe operacional (Gustavo, Robinson e outros) pelo WhatsApp.
Seu foco principal é: **registrar e consultar memorandos operacionais**.

## Usuário atual
- Nome: ${usuario.nome}
- ID no sistema: ${usuario.user_id || 'não configurado'}
- Perfil: ${usuario.role}

## O que você pode fazer
1. **Registrar relatos operacionais** como memorandos no sistema (saídas de equipe, chegadas, ocorrências, checklists, etc.)
2. **Consultar memorandos** existentes
3. **Concluir memorandos** pendentes
4. **Buscar clientes** para vincular aos memorandos
5. **Interpretar imagens** enviadas (análise já feita, descrição fornecida no contexto)
6. **Responder dúvidas gerais** sobre operações, rotinas e o sistema
7. **Escalar para Robinson** quando algo estiver fora do seu escopo

## Regras importantes
- Sempre use o \`criador_id\` = "${usuario.user_id || 'USUARIO_NAO_CONFIGURADO'}" ao criar memorandos
- Se o usuário mencionar um cliente, busque o ID primeiro antes de criar o memorando
- Seja objetivo e confirme ações com emoji: ✅ para sucesso, ⚠️ para alertas
- Respostas curtas e diretas — eles estão no campo
- Não interfira em CRM (leads, propostas, atendimentos) — apenas memorandos
- Se algo não estiver no escopo, use a ferramenta notificar_robinson e avise o usuário

## Formato de confirmação de memorando
Quando criar um memorando, confirme assim:
✅ *Memorando registrado*
📋 ${usuario.nome} [TÍTULO]
🏷️ Tags: [tags]
${usuario.role !== 'admin' ? '👀 Robinson foi notificado se urgente' : ''}

## Sobre urgências
Se detectar palavras como "urgente", "emergência", "acidente", "problema grave", marque urgente: true.`;

  // Monta conteúdo da mensagem do usuário
  let userContent = texto || '';
  if (descricaoImagem) {
    userContent = `[O usuário enviou uma imagem. Descrição automática: ${descricaoImagem}]\n\n${userContent || '(sem texto adicional)'}`;
  }

  // Adiciona ao histórico
  adicionarAoHistorico(numero, 'user', userContent);

  const messages = obterHistorico(numero).map((m, i) => {
    // O último é o que acabamos de adicionar
    if (i === obterHistorico(numero).length - 1) {
      return { role: m.role, content: userContent };
    }
    return m;
  });

  let notificarRobinson = null;

  // Loop de tool use
  let resposta = '';
  let continuar = true;
  let mensagensAtuais = [...messages];

  while (continuar) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      tools: TOOLS,
      messages: mensagensAtuais,
    });

    if (response.stop_reason === 'tool_use') {
      // Processa todas as ferramentas da resposta
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const resultado = await executarFerramenta(toolUse.name, toolUse.input);

        // Verifica se é notificação para Robinson
        if (resultado?.__notificar_robinson) {
          notificarRobinson = resultado;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(resultado),
        });
      }

      // Adiciona resposta do assistente e resultados ao histórico da conversa
      mensagensAtuais.push({ role: 'assistant', content: response.content });
      mensagensAtuais.push({ role: 'user', content: toolResults });

    } else {
      // Resposta final em texto
      resposta = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      continuar = false;
    }
  }

  // Salva resposta do assistente no histórico
  adicionarAoHistorico(numero, 'assistant', resposta);

  return { resposta, notificarRobinson };
}

module.exports = { processarMensagem };

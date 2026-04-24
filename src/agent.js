// src/agent.js
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memorandoTools = require('./tools/memorando');
const clienteTools = require('./tools/clientes');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const TOOLS = [
  {
    name: 'criar_memorando',
    description: `Cria um memorando operacional no sistema Cobertex.
Use quando o usuário quiser registrar: saída de equipes, chegada em obras,
relatórios de campo, ocorrências, checklist de veículos, qualquer relato do dia a dia.
Se houver imagemUrl no contexto, inclua em anexos[].
Detecte urgência com palavras: urgente, emergência, problema grave, quebrou, acidente.
Tags sugeridas: saida, chegada, equipe, caminhao, montagem, desmontagem, cliente, manutencao, ocorrencia.`,
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título conciso do memorando' },
        conteudo: { type: 'string', description: 'Conteúdo completo do relato' },
        criador_id: { type: 'string', description: 'ID do usuário criador' },
        cliente_id: { type: 'string', description: 'ID do cliente (se mencionado)' },
        instalacao_id: { type: 'string', description: 'ID da instalação (se mencionada)' },
        urgente: { type: 'boolean', description: 'Se é urgente' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags de categorização' },
        anexos: { type: 'array', items: { type: 'string' }, description: 'URLs de imagens/arquivos' },
      },
      required: ['titulo', 'conteudo', 'criador_id'],
    },
  },
  {
    name: 'adicionar_anexos_memorando',
    description: `Adiciona imagens ou arquivos a um memorando já existente.
Use quando o usuário enviar uma imagem após um memorando e quiser anexar ao memorando anterior,
ou quando confirmar que quer adicionar a imagem a um memorando específico.`,
    input_schema: {
      type: 'object',
      properties: {
        memorando_id: { type: 'string', description: 'ID do memorando' },
        novos_anexos: { type: 'array', items: { type: 'string' }, description: 'URLs das imagens a anexar' },
      },
      required: ['memorando_id', 'novos_anexos'],
    },
  },
  {
    name: 'listar_memorandos',
    description: 'Lista memorandos recentes. Use quando o usuário perguntar sobre registros, histórico do dia, etc.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string', description: 'Filtrar por cliente (opcional)' },
        status: { type: 'string', enum: ['pendente', 'concluido'], description: 'Filtrar por status' },
        limit: { type: 'number', description: 'Quantidade máxima (padrão 20)' },
      },
      required: [],
    },
  },
  {
    name: 'concluir_memorando',
    description: 'Marca um memorando como concluído.',
    input_schema: {
      type: 'object',
      properties: {
        memorando_id: { type: 'string', description: 'ID do memorando' },
      },
      required: ['memorando_id'],
    },
  },
  {
    name: 'buscar_cliente',
    description: 'Busca clientes pelo nome para encontrar o ID.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome ou parte do nome do cliente' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_instalacoes_cliente',
    description: 'Lista instalações de um cliente.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string', description: 'ID do cliente' },
      },
      required: ['cliente_id'],
    },
  },
  {
    name: 'notificar_robinson',
    description: 'Use quando a solicitação estiver fora do escopo (CRM, financeiro, bugs, funcionalidades inexistentes).',
    input_schema: {
      type: 'object',
      properties: {
        solicitante: { type: 'string', description: 'Nome de quem solicitou' },
        descricao: { type: 'string', description: 'O que foi solicitado e está fora do escopo' },
      },
      required: ['solicitante', 'descricao'],
    },
  },
];

async function executarFerramenta(nome, input) {
  console.log(`[agent] Tool: ${nome}`, JSON.stringify(input));

  switch (nome) {
    case 'criar_memorando':
      return memorandoTools.criarMemorando(input);
    case 'adicionar_anexos_memorando':
      return memorandoTools.adicionarAnexos(input);
    case 'listar_memorandos':
      return memorandoTools.listarMemorandos(input);
    case 'concluir_memorando':
      return memorandoTools.concluirMemorando(input);
    case 'buscar_cliente':
      return clienteTools.buscarCliente(input);
    case 'listar_instalacoes_cliente':
      return clienteTools.listarInstalacoesCliente(input);
    case 'notificar_robinson':
      return { __notificar_robinson: true, ...input };
    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

// Histórico por número (em memória)
const historicos = {};
const MAX_HISTORICO = 20;

// Último memorando criado por número (para anexar imagens)
const ultimoMemorando = {};

function obterHistorico(numero) {
  if (!historicos[numero]) historicos[numero] = [];
  return historicos[numero];
}

function adicionarAoHistorico(numero, role, content) {
  const hist = obterHistorico(numero);
  hist.push({ role, content });
  if (hist.length > MAX_HISTORICO) {
    historicos[numero] = hist.slice(-MAX_HISTORICO);
  }
}

async function processarMensagem({ numero, usuario, texto, imagemUrl, descricaoImagem }) {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

  // Contexto extra sobre imagem e último memorando
  let contextoExtra = '';
  if (imagemUrl) {
    contextoExtra += `\n\n📎 IMAGEM RECEBIDA: ${imagemUrl}`;
    if (ultimoMemorando[numero]) {
      contextoExtra += `\n⚠️ O usuário tem um memorando recente (ID: ${ultimoMemorando[numero].id}, título: "${ultimoMemorando[numero].titulo}"). Pergunte se quer ANEXAR esta imagem ao memorando anterior ou CRIAR um novo memorando com ela.`;
    }
  }
  if (descricaoImagem) {
    contextoExtra += `\n🖼️ DESCRIÇÃO DA IMAGEM: ${descricaoImagem}`;
  }

  const systemPrompt = `Você é o assistente IA da Cobertex, empresa de coberturas e galpões em São Paulo.
Hoje é ${hoje}.

## Usuário atual
- Nome: ${usuario.nome}
- ID no sistema: ${usuario.user_id}
- Perfil: ${usuario.role}

## Seu foco
Registrar e consultar memorandos operacionais. Respostas curtas e diretas — equipe está no campo.

## Regras
- Use criador_id = "${usuario.user_id}" ao criar memorandos
- Se vier imagem, inclua a URL nos anexos[] do memorando
- Se houver memorando recente, PERGUNTE se quer anexar ao anterior ou criar novo
- Confirme ações com ✅
- Não interfira no CRM (leads, propostas, atendimentos)
- Se fora do escopo, use notificar_robinson

## Confirmação de memorando criado
✅ *Memorando registrado*
📋 [Título]
🏷️ Tags: [tags]
📎 Anexos: [quantidade de imagens, se houver]${contextoExtra}`;

  let userContent = texto || '';
  if (descricaoImagem && !imagemUrl) {
    userContent = `[Imagem enviada. Descrição: ${descricaoImagem}]\n\n${userContent}`;
  } else if (imagemUrl) {
    userContent = `[Imagem enviada. URL: ${imagemUrl}. Descrição: ${descricaoImagem}]\n\n${userContent}`;
  }

  adicionarAoHistorico(numero, 'user', userContent);

  const messages = obterHistorico(numero).map(m => ({ role: m.role, content: m.content }));

  let resposta = '';
  let notificarRobinson = null;
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
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const resultado = await executarFerramenta(toolUse.name, toolUse.input);

        // Salva último memorando criado para contexto de anexos
        if (toolUse.name === 'criar_memorando' && resultado?.id) {
          ultimoMemorando[numero] = { id: resultado.id, titulo: resultado.titulo };
          console.log(`[agent] Último memorando salvo: ${resultado.id}`);
        }

        if (resultado?.__notificar_robinson) {
          notificarRobinson = resultado;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(resultado),
        });
      }

      mensagensAtuais.push({ role: 'assistant', content: response.content });
      mensagensAtuais.push({ role: 'user', content: toolResults });

    } else {
      resposta = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      continuar = false;
    }
  }

  adicionarAoHistorico(numero, 'assistant', resposta);
  return { resposta, notificarRobinson };
}

module.exports = { processarMensagem };

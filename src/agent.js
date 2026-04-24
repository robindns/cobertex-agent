// src/agent.js
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memorandoTools = require('./tools/memorando');
const clienteTools = require('./tools/clientes');
const agendaTools = require('./tools/agenda');
const { getPrefs, setPrefs } = require('./scheduler');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const TOOLS = [
  // ── Memorandos ────────────────────────────────────────────────────────────
  {
    name: 'criar_memorando',
    description: `Cria memorando operacional. Use para: saída de equipes, chegadas, ocorrências, relatos de campo.
Se houver imagemUrl no contexto, inclua em anexos[].
Detecte urgência: urgente, emergência, acidente, quebrou.
Tags: saida, chegada, equipe, caminhao, montagem, desmontagem, manutencao, ocorrencia.`,
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        conteudo: { type: 'string' },
        criador_id: { type: 'string' },
        cliente_id: { type: 'string' },
        instalacao_id: { type: 'string' },
        urgente: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        anexos: { type: 'array', items: { type: 'string' } },
      },
      required: ['titulo', 'conteudo', 'criador_id'],
    },
  },
  {
    name: 'adicionar_anexos_memorando',
    description: 'Adiciona imagens a memorando existente. Use quando usuário confirmar que quer anexar imagem ao memorando anterior.',
    input_schema: {
      type: 'object',
      properties: {
        memorando_id: { type: 'string' },
        novos_anexos: { type: 'array', items: { type: 'string' } },
      },
      required: ['memorando_id', 'novos_anexos'],
    },
  },
  {
    name: 'listar_memorandos',
    description: 'Lista memorandos recentes.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['pendente', 'concluido'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'concluir_memorando',
    description: 'Marca memorando como concluído.',
    input_schema: {
      type: 'object',
      properties: { memorando_id: { type: 'string' } },
      required: ['memorando_id'],
    },
  },

  // ── Agenda ────────────────────────────────────────────────────────────────
  {
    name: 'criar_evento_agenda',
    description: `Cria evento, reunião, compromisso ou lembrete na agenda pessoal.
Use quando: "agendar", "marcar reunião", "criar lembrete", "tenho compromisso às X".
Data no formato ISO: "2026-04-24T10:00:00".`,
    input_schema: {
      type: 'object',
      properties: {
        diretor: { type: 'string', enum: ['ana', 'gustavo', 'eduardo', 'diego'] },
        titulo: { type: 'string' },
        descricao: { type: 'string' },
        data_inicio: { type: 'string' },
        data_fim: { type: 'string' },
        dia_todo: { type: 'boolean' },
        tipo: { type: 'string', enum: ['reuniao', 'compromisso', 'lembrete', 'viagem', 'pessoal', 'outro'] },
        local: { type: 'string' },
        lembrete_minutos: { type: 'number' },
        recorrente: { type: 'boolean' },
        recorrencia: { type: 'string', enum: ['diario', 'semanal', 'mensal', 'anual'] },
      },
      required: ['diretor', 'titulo', 'data_inicio'],
    },
  },
  {
    name: 'listar_eventos_agenda',
    description: 'Lista eventos da agenda. Use para: "minha agenda", "próximos compromissos", "o que tenho essa semana".',
    input_schema: {
      type: 'object',
      properties: {
        diretor: { type: 'string', enum: ['ana', 'gustavo', 'eduardo', 'diego'] },
        data_inicio_partir: { type: 'string' },
        concluido: { type: 'boolean' },
        limit: { type: 'number' },
      },
      required: ['diretor'],
    },
  },
  {
    name: 'eventos_hoje',
    description: 'Lista eventos de hoje da agenda.',
    input_schema: {
      type: 'object',
      properties: {
        diretor: { type: 'string', enum: ['ana', 'gustavo', 'eduardo', 'diego'] },
      },
      required: ['diretor'],
    },
  },
  {
    name: 'concluir_evento_agenda',
    description: 'Marca evento como concluído.',
    input_schema: {
      type: 'object',
      properties: { evento_id: { type: 'string' } },
      required: ['evento_id'],
    },
  },
  {
    name: 'atualizar_evento_agenda',
    description: 'Atualiza dados de um evento.',
    input_schema: {
      type: 'object',
      properties: {
        evento_id: { type: 'string' },
        campos: { type: 'object' },
      },
      required: ['evento_id', 'campos'],
    },
  },

  // ── Preferências de notificação ───────────────────────────────────────────
  {
    name: 'configurar_lembretes',
    description: `Configura notificações da agenda. Use quando o usuário disser:
- "quero ser avisado X min antes" → minutosAntes: X
- "ativar resumo diário às Xh" → resumoDiario: true, horaResumo: "HH:MM"
- "desativar lembretes" → lembretes: false
- "não quero resumo" → resumoDiario: false
- "ativar lembretes" → lembretes: true`,
    input_schema: {
      type: 'object',
      properties: {
        lembretes: { type: 'boolean', description: 'Ativar/desativar lembretes' },
        minutosAntes: { type: 'number', description: 'Minutos antes do evento para avisar' },
        resumoDiario: { type: 'boolean', description: 'Ativar/desativar resumo diário' },
        horaResumo: { type: 'string', description: 'Horário do resumo ex: "08:00"' },
      },
      required: [],
    },
  },
  {
    name: 'ver_preferencias',
    description: 'Mostra configurações atuais de notificação do usuário.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ── Clientes ──────────────────────────────────────────────────────────────
  {
    name: 'buscar_cliente',
    description: 'Busca clientes pelo nome.',
    input_schema: {
      type: 'object',
      properties: { nome: { type: 'string' } },
      required: ['nome'],
    },
  },
  {
    name: 'listar_instalacoes_cliente',
    description: 'Lista instalações de um cliente.',
    input_schema: {
      type: 'object',
      properties: { cliente_id: { type: 'string' } },
      required: ['cliente_id'],
    },
  },

  // ── Escalação ─────────────────────────────────────────────────────────────
  {
    name: 'notificar_robinson',
    description: 'Use quando a solicitação estiver fora do escopo.',
    input_schema: {
      type: 'object',
      properties: {
        solicitante: { type: 'string' },
        descricao: { type: 'string' },
      },
      required: ['solicitante', 'descricao'],
    },
  },
];

async function executarFerramenta(nome, input, numero) {
  console.log(`[agent] Tool: ${nome}`);

  switch (nome) {
    case 'criar_memorando':
      return memorandoTools.criarMemorando(input);
    case 'adicionar_anexos_memorando':
      return memorandoTools.adicionarAnexos(input);
    case 'listar_memorandos':
      return memorandoTools.listarMemorandos(input);
    case 'concluir_memorando':
      return memorandoTools.concluirMemorando(input);
    case 'criar_evento_agenda':
      return agendaTools.criarEvento(input);
    case 'listar_eventos_agenda':
      return agendaTools.listarEventos(input);
    case 'eventos_hoje':
      return agendaTools.eventosHoje(input);
    case 'concluir_evento_agenda':
      return agendaTools.concluirEvento(input);
    case 'atualizar_evento_agenda':
      return agendaTools.atualizarEvento(input);
    case 'configurar_lembretes':
      return { sucesso: true, preferencias: setPrefs(numero, input) };
    case 'ver_preferencias':
      return getPrefs(numero);
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

const historicos = {};
const ultimoMemorando = {};
const MAX_HISTORICO = 20;

function obterHistorico(numero) {
  if (!historicos[numero]) historicos[numero] = [];
  return historicos[numero];
}

function adicionarAoHistorico(numero, role, content) {
  const hist = obterHistorico(numero);
  hist.push({ role, content });
  if (hist.length > MAX_HISTORICO) historicos[numero] = hist.slice(-MAX_HISTORICO);
}

async function processarMensagem({ numero, usuario, texto, imagemUrl, descricaoImagem }) {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

  const temAgenda = !!usuario.diretor;
  const prefs = getPrefs(numero);

  let contextoExtra = '';
  if (imagemUrl) {
    contextoExtra += `\n\n📎 IMAGEM RECEBIDA: ${imagemUrl}`;
    if (ultimoMemorando[numero]) {
      contextoExtra += `\n⚠️ Memorando recente: ID=${ultimoMemorando[numero].id}, título="${ultimoMemorando[numero].titulo}". Pergunte se quer ANEXAR ao anterior ou CRIAR novo.`;
    }
  }
  if (descricaoImagem) {
    contextoExtra += `\n🖼️ DESCRIÇÃO DA IMAGEM: ${descricaoImagem}`;
  }

  const systemPrompt = `Você é o assistente IA da Cobertex, empresa de coberturas em São Paulo.
Hoje é ${hoje}.

## Usuário
- Nome: ${usuario.nome}
- ID: ${usuario.user_id}
- Perfil: ${usuario.role}
${temAgenda ? `- Agenda: diretor="${usuario.diretor}"` : ''}

## Preferências de notificação atuais
- Lembretes: ${prefs.lembretes ? `✅ ativados (${prefs.minutosAntes} min antes)` : '❌ desativados'}
- Resumo diário: ${prefs.resumoDiario ? `✅ ativado às ${prefs.horaResumo}` : '❌ desativado'}

## Escopo
1. Memorandos operacionais (todos)
2. Agenda pessoal ${temAgenda ? `(diretor="${usuario.diretor}")` : '(apenas diretores)'}
3. Configurar notificações (ativar/desativar lembretes e resumo diário)
4. Buscar clientes

## Regras
- criador_id = "${usuario.user_id}" nos memorandos
- diretor = "${usuario.diretor || 'N/A'}" na agenda
- Se imagem com URL → inclua em anexos[]
- Se memorando recente existir ao receber imagem → pergunte antes de criar novo
- Respostas curtas e diretas
- Fora do escopo → notificar_robinson

## Confirmações
Memorando: ✅ *Registrado* — [título] 🏷️ [tags]
Evento: ✅ *Agendado* — [título] 📅 [data/hora]
Preferência: ✅ *Configurado* — [o que mudou]${contextoExtra}`;

  let userContent = texto || '';
  if (imagemUrl) {
    userContent = `[Imagem. URL: ${imagemUrl}. Descrição: ${descricaoImagem}]\n\n${userContent}`;
  } else if (descricaoImagem) {
    userContent = `[Imagem. Descrição: ${descricaoImagem}]\n\n${userContent}`;
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
        const resultado = await executarFerramenta(toolUse.name, toolUse.input, numero);

        if (toolUse.name === 'criar_memorando' && resultado?.id) {
          ultimoMemorando[numero] = { id: resultado.id, titulo: resultado.titulo };
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
      resposta = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      continuar = false;
    }
  }

  adicionarAoHistorico(numero, 'assistant', resposta);
  return { resposta, notificarRobinson };
}

module.exports = { processarMensagem };

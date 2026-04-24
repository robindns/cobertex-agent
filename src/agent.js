// src/agent.js
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memorandoTools = require('./tools/memorando');
const crmTools = require('./tools/crm');
const agendaTools = require('./tools/agenda');
const { getPrefs, setPrefs } = require('./scheduler');
const { gerarAudio } = require('./media');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// Mapa numero -> nome para lookup reverso
const MAPA_USUARIOS = Object.entries(require('./config').USUARIOS).reduce((acc, [num, usr]) => {
  acc[usr.nome.toLowerCase()] = num;
  acc[usr.diretor || ''] = num;
  return acc;
}, {});

const TOOLS = [
  // ── Memorandos ────────────────────────────────────────────────────────────
  {
    name: 'criar_memorando',
    description: `Cria memorando operacional. Use para: saída/chegada de equipes, ocorrências, relatos de campo.
Se houver midiaUrl no contexto, inclua em anexos[].
Detecte urgência: urgente, emergência, acidente, quebrou.
Campos especiais: tag_livro (Livro de Ocorrências), tag_eduardo (centro de custos).`,
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
        tag_livro: { type: 'boolean' },
        tag_eduardo: { type: 'boolean' },
        tags_livro: { type: 'array', items: { type: 'string' } },
        tags_eduardo: { type: 'array', items: { type: 'string' } },
      },
      required: ['titulo', 'conteudo', 'criador_id'],
    },
  },
  {
    name: 'buscar_memorandos',
    description: `Busca memorandos por texto livre. SEMPRE use antes de dizer que não encontrou algo.
Busca em: título, conteúdo transcrito, tags.
Exemplos: "o que Pastel fez ontem?", "caminhão W2", "ocorrências de hoje".`,
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string' },
        data: { type: 'string', description: '"hoje", "ontem", "23/04/2026"' },
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['pendente', 'concluido'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'listar_memorandos',
    description: 'Lista memorandos recentes sem filtro.',
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
    name: 'atualizar_memorando',
    description: 'Atualiza campos de um memorando existente.',
    input_schema: {
      type: 'object',
      properties: {
        memorando_id: { type: 'string' },
        campos: { type: 'object' },
      },
      required: ['memorando_id', 'campos'],
    },
  },
  {
    name: 'excluir_memorando',
    description: 'Exclui memorando permanentemente. Só use após confirmação explícita.',
    input_schema: {
      type: 'object',
      properties: { memorando_id: { type: 'string' } },
      required: ['memorando_id'],
    },
  },
  {
    name: 'adicionar_anexos_memorando',
    description: 'Adiciona imagens/arquivos a memorando existente.',
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
    name: 'concluir_memorando',
    description: 'Marca memorando como concluído.',
    input_schema: {
      type: 'object',
      properties: { memorando_id: { type: 'string' } },
      required: ['memorando_id'],
    },
  },

  // ── CRM — Leads ───────────────────────────────────────────────────────────
  {
    name: 'listar_leads',
    description: `Lista leads. Leads são contatos que passaram pela triagem comercial.
Estágios: novo → contatado → qualificado → proposta_enviada → convertido → perdido.`,
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['novo', 'contatado', 'qualificado', 'proposta_enviada', 'convertido', 'perdido'] },
        responsavel: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_lead',
    description: 'Busca lead por nome, empresa ou telefone.',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string' }, limit: { type: 'number' } },
      required: ['texto'],
    },
  },
  {
    name: 'atualizar_lead',
    description: 'Atualiza dados ou status de um lead.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
        campos: { type: 'object' },
      },
      required: ['lead_id', 'campos'],
    },
  },

  // ── CRM — Atendimentos ────────────────────────────────────────────────────
  {
    name: 'listar_atendimentos',
    description: `Lista atendimentos/contatos recebidos (formulário, WhatsApp, site, telefone).
Atendimentos são primeiros contatos — podem ou não virar leads após triagem.`,
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['novo', 'em_analise', 'contatado', 'aguardando_retorno', 'convertido_lead', 'descartado'] },
        origem: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_atendimento',
    description: 'Busca atendimento por nome, empresa ou local.',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string' }, limit: { type: 'number' } },
      required: ['texto'],
    },
  },

  // ── CRM — Clientes / Instalações / Propostas ──────────────────────────────
  {
    name: 'listar_clientes',
    description: 'Lista clientes do sistema.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ativo', 'inativo', 'prospecto'] },
        cidade: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_cliente',
    description: 'Busca cliente por nome ou documento.',
    input_schema: {
      type: 'object',
      properties: { nome: { type: 'string' } },
      required: ['nome'],
    },
  },
  {
    name: 'listar_instalacoes',
    description: 'Lista instalações, com filtro de status ou cliente.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['prevista', 'em_instalacao', 'ativa', 'encerrada', 'manutencao'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'listar_propostas',
    description: 'Lista propostas enviadas.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['rascunho', 'enviada', 'aprovada', 'rejeitada', 'expirada'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'resumo_estrategico',
    description: `Gera resumo estratégico completo: clientes, leads, atendimentos, instalações, propostas, taxa de conversão.
Use para: "como estamos?", "status geral", "relatório executivo", "quantos leads temos?".`,
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── Agenda ────────────────────────────────────────────────────────────────
  {
    name: 'criar_evento_agenda',
    description: 'Cria evento, reunião, compromisso ou lembrete na agenda pessoal.',
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
    description: 'Lista eventos da agenda.',
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
      properties: { diretor: { type: 'string', enum: ['ana', 'gustavo', 'eduardo', 'diego'] } },
      required: ['diretor'],
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
  {
    name: 'excluir_evento_agenda',
    description: 'Exclui evento permanentemente. Só use após confirmação explícita.',
    input_schema: {
      type: 'object',
      properties: { evento_id: { type: 'string' } },
      required: ['evento_id'],
    },
  },

  // ── PDF ───────────────────────────────────────────────────────────────────
  {
    name: 'gerar_pdf',
    description: `Gera relatório em PDF e envia pelo WhatsApp.
Use quando: "gera um PDF", "quero exportar", "relatório em PDF".
Pode incluir dados de memorandos, leads, atendimentos, etc.`,
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        conteudo: { type: 'string', description: 'Texto introdutório' },
        dados: { type: 'array', items: { type: 'object' }, description: 'Dados estruturados' },
      },
      required: ['titulo'],
    },
  },

  // ── Preferências ──────────────────────────────────────────────────────────
  {
    name: 'configurar_lembretes',
    description: 'Configura notificações de agenda.',
    input_schema: {
      type: 'object',
      properties: {
        lembretes: { type: 'boolean' },
        minutosAntes: { type: 'number' },
        resumoDiario: { type: 'boolean' },
        horaResumo: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'ver_preferencias',
    description: 'Mostra configurações atuais de notificação.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── Comunicação entre usuários ───────────────────────────────────────────
  {
    name: 'enviar_mensagem_usuario',
    description: `Envia uma mensagem de texto ou áudio para outro usuário autorizado do sistema.
Use quando: "envie uma mensagem para Gustavo", "mande boas-vindas à Ana", "avise o Eduardo", "envie um áudio para Robinson".
Usuários disponíveis: Gustavo, Robinson, Ana Carolina, Eduardo.
Para áudio: só gere quando explicitamente solicitado ("envie um áudio", "manda um áudio").`,
    input_schema: {
      type: 'object',
      properties: {
        destinatario: { type: 'string', description: 'Nome do destinatário (Gustavo, Robinson, Ana, Eduardo)' },
        mensagem: { type: 'string', description: 'Conteúdo da mensagem a enviar' },
        tipo: { type: 'string', enum: ['texto', 'audio'], description: 'texto (padrão) ou audio (só quando explicitamente pedido)' },
      },
      required: ['destinatario', 'mensagem'],
    },
  },

  // ── Escalação ─────────────────────────────────────────────────────────────
  {
    name: 'notificar_robinson',
    description: 'Use para solicitações que precisam da atenção de Robinson.',
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
    case 'criar_memorando': return memorandoTools.criarMemorando(input);
    case 'buscar_memorandos': return memorandoTools.buscarMemorandos(input);
    case 'listar_memorandos': return memorandoTools.listarMemorandos(input);
    case 'atualizar_memorando': {
      const mid = input.memorando_id || '';
      if (!mid || mid.length < 20 || !/^[a-f0-9]+$/i.test(mid)) {
        return { erro: 'ID de memorando inválido. Busque o memorando primeiro para obter o ID real.' };
      }
      return memorandoTools.atualizarMemorando(input);
    }
    case 'excluir_memorando': {
      const mid = input.memorando_id || '';
      if (!mid || mid.length < 20 || !/^[a-f0-9]+$/i.test(mid)) {
        return { erro: 'ID de memorando inválido. Busque o memorando primeiro para obter o ID real.' };
      }
      return memorandoTools.excluirMemorando(input);
    }
    case 'adicionar_anexos_memorando': {
      // Valida que o memorando_id é um ID real (hexadecimal), não um texto descritivo
      const mid = input.memorando_id || '';
      if (!mid || mid.length < 20 || !/^[a-f0-9]+$/i.test(mid)) {
        return { erro: 'ID de memorando inválido. Busque o memorando primeiro para obter o ID real.' };
      }
      return memorandoTools.adicionarAnexos(input);
    }
    case 'concluir_memorando': return memorandoTools.concluirMemorando(input);
    case 'listar_leads': return crmTools.listarLeads(input);
    case 'buscar_lead': return crmTools.buscarLead(input);
    case 'atualizar_lead': return crmTools.atualizarLead(input);
    case 'listar_atendimentos': return crmTools.listarAtendimentos(input);
    case 'buscar_atendimento': return crmTools.buscarAtendimento(input);
    case 'listar_clientes': return crmTools.listarClientes(input);
    case 'buscar_cliente': return crmTools.buscarCliente(input);
    case 'listar_instalacoes':
      if (input.cliente_id) return crmTools.listarInstalacoesCliente(input);
      return crmTools.listarInstalacoes(input);
    case 'listar_propostas': return crmTools.listarPropostas(input);
    case 'resumo_estrategico': return crmTools.resumoEstrategico();
    case 'criar_evento_agenda': return agendaTools.criarEvento(input);
    case 'listar_eventos_agenda': return agendaTools.listarEventos(input);
    case 'eventos_hoje': return agendaTools.eventosHoje(input);
    case 'atualizar_evento_agenda': return agendaTools.atualizarEvento(input);
    case 'excluir_evento_agenda': return agendaTools.excluirEvento(input);
    case 'gerar_pdf': return { __pdf_pendente: true, ...input };
    case 'configurar_lembretes': return { sucesso: true, preferencias: setPrefs(numero, input) };
    case 'ver_preferencias': return getPrefs(numero);
    case 'enviar_mensagem_usuario': {
      const config = require('./config');
      const { enviarTexto, enviarAudio } = require('./evolution');
      
      // Encontra número do destinatário
      const nomeDestino = (input.destinatario || '').toLowerCase();
      let numeroDestino = null;
      for (const [num, usr] of Object.entries(config.USUARIOS)) {
        if (usr.nome.toLowerCase().includes(nomeDestino) || 
            (usr.diretor || '').toLowerCase() === nomeDestino) {
          numeroDestino = num;
          break;
        }
      }
      
      if (!numeroDestino) {
        return { erro: `Usuário ${input.destinatario} não encontrado. Disponíveis: Gustavo, Robinson, Ana Carolina, Eduardo.` };
      }
      
      const tipo = input.tipo || 'texto';
      
      if (tipo === 'audio') {
        // Gera áudio via ElevenLabs
        const audioBuffer = await gerarAudio(input.mensagem);
        if (audioBuffer) {
          await enviarAudio(numeroDestino, audioBuffer);
          return { sucesso: true, tipo: 'audio', destinatario: input.destinatario, numero: numeroDestino };
        } else {
          // Fallback para texto se áudio falhar
          await enviarTexto(numeroDestino, input.mensagem);
          return { sucesso: true, tipo: 'texto_fallback', aviso: 'ElevenLabs indisponível, enviado como texto', destinatario: input.destinatario };
        }
      } else {
        await enviarTexto(numeroDestino, input.mensagem);
        return { sucesso: true, tipo: 'texto', destinatario: input.destinatario, numero: numeroDestino };
      }
    }
    
    case 'notificar_robinson': return { __notificar_robinson: true, ...input };
    default: return { erro: `Ferramenta desconhecida: ${nome}` };
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

async function processarMensagem({ numero, usuario, texto, midiaUrl, midiaInfo, descricaoImagem }) {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

  const temAgenda = !!usuario.diretor;
  const prefs = getPrefs(numero);

  let contextoExtra = '';
  if (midiaUrl) {
    contextoExtra += `\n\n📎 MÍDIA RECEBIDA COM URL PÚBLICA: ${midiaUrl}`;
    if (midiaInfo) contextoExtra += ` (${midiaInfo.tipo})`;
    if (ultimoMemorando[numero]) {
      contextoExtra += `\n⚠️ Memorando recente: ID=${ultimoMemorando[numero].id}, título="${ultimoMemorando[numero].titulo}". Pergunte se quer ANEXAR ao anterior ou CRIAR novo.`;
    } else {
      contextoExtra += `\nSe criar memorando: 1) inclua esta URL em anexos[], 2) E também mencione a URL no campo conteudo no final (ex: '📎 Imagem: URL').`;
    }
  }
  if (descricaoImagem) contextoExtra += `\n🖼️ DESCRIÇÃO DA IMAGEM: ${descricaoImagem}`;

  const systemPrompt = `Você é o assistente pessoal IA da Cobertex, empresa de coberturas e galpões em São Paulo.
Hoje é ${hoje}.

## Usuário
- Nome: ${usuario.nome} | ID: ${usuario.user_id} | Perfil: ${usuario.role}
${temAgenda ? `- Agenda pessoal: diretor="${usuario.diretor}"` : ''}
- Notificações: ${prefs.lembretes ? `lembretes ${prefs.minutosAntes}min antes` : 'sem lembretes'} | ${prefs.resumoDiario ? `resumo às ${prefs.horaResumo}` : 'sem resumo diário'}

## Capacidades completas
1. Memorandos operacionais — criar, buscar, editar, excluir, anexar mídia
2. CRM completo — clientes, leads, atendimentos, propostas, instalações
3. Agenda pessoal ${temAgenda ? `(diretor="${usuario.diretor}")` : '(apenas diretores)'}
4. Relatórios em PDF — gerados e enviados direto pelo WhatsApp
5. Análise estratégica — resumos, métricas, tendências do negócio

## Funil comercial Cobertex
ATENDIMENTO → LEAD → PROPOSTA → CLIENTE
- Atendimento: Primeiro contato de interesse. Ainda não qualificado. Pode ser de qualquer origem.
- Lead: Passou pela triagem comercial. Tem potencial real. Avança por estágios.
- Proposta: Enviada ao lead qualificado.
- Cliente: Lead convertido após proposta aprovada.
⚠️ Atendimentos ≠ Leads — são etapas diferentes do funil!

## Regras
- criador_id = "${usuario.user_id}" nos memorandos
- diretor = "${usuario.diretor || 'N/A'}" na agenda
- BUSCA: Para qualquer nome/apelido/veículo → use buscar_memorandos IMEDIATAMENTE sem perguntar
- MÍDIA: Se midiaUrl existe → inclua em anexos[] E também no conteúdo do memorando no final (ex: '📎 Imagem: [URL]')
- EXCLUIR: Confirme antes. Após confirmação → execute.
- EDITAR: Pergunte se quer sobrescrever ou criar novo
- PDF: Use gerar_pdf e avise que está gerando — será enviado em seguida
- Para uploads grandes → indique ${config.SISTEMA_URL}
- Respostas objetivas. Para diretores, pode ser mais analítico e estratégico.${contextoExtra}`;

  let userContent = texto || '';
  if (midiaUrl) {
    userContent = `[Mídia recebida. URL: ${midiaUrl}. Tipo: ${midiaInfo?.tipo}. Descrição: ${descricaoImagem || 'N/A'}]\n\n${userContent}`;
  } else if (descricaoImagem) {
    userContent = `[Imagem. Descrição: ${descricaoImagem}]\n\n${userContent}`;
  }

  adicionarAoHistorico(numero, 'user', userContent);
  const messages = obterHistorico(numero).map(m => ({ role: m.role, content: m.content }));

  let resposta = '';
  let notificarRobinson = null;
  let pdfPendente = null;
  let continuar = true;
  let mensagensAtuais = [...messages];

  while (continuar) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 3000,
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
        if (resultado?.__notificar_robinson) notificarRobinson = resultado;
        if (resultado?.__pdf_pendente) {
          pdfPendente = resultado;
          // Retorna confirmação ao Claude
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ sucesso: true, mensagem: 'PDF será gerado e enviado pelo WhatsApp agora.' }),
          });
          continue;
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
  return { resposta, notificarRobinson, pdfPendente };
}

module.exports = { processarMensagem };

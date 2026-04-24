// src/tools/crm.js — Acesso completo ao CRM Cobertex
const base44 = require('../base44');

// ─── LEADS ───────────────────────────────────────────────────────────────────

async function listarLeads({ status, responsavel, limit = 30 } = {}) {
  const query = {};
  if (status) query.status = status;
  if (responsavel) query.responsavel = responsavel;
  return base44.list('Lead', query, limit);
}

async function buscarLead({ texto, limit = 50 }) {
  const todos = await base44.list('Lead', {}, limit);
  if (!texto) return todos;
  const t = texto.toLowerCase();
  return todos.filter(l =>
    (l.nome || '').toLowerCase().includes(t) ||
    (l.empresa || '').toLowerCase().includes(t) ||
    (l.email || '').toLowerCase().includes(t) ||
    (l.telefone || '').includes(t)
  );
}

async function atualizarLead({ lead_id, campos }) {
  return base44.update('Lead', lead_id, campos);
}

// ─── ATENDIMENTOS ─────────────────────────────────────────────────────────────

async function listarAtendimentos({ status, origem, limit = 30 } = {}) {
  const query = {};
  if (status) query.status_atendimento = status;
  if (origem) query.origem = origem;
  const result = await base44.list('ContatoFormulario', query, limit);
  return result.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
}

async function buscarAtendimento({ texto, limit = 50 }) {
  const todos = await base44.list('ContatoFormulario', {}, limit);
  if (!texto) return todos;
  const t = texto.toLowerCase();
  return todos.filter(a =>
    (a.nome || '').toLowerCase().includes(t) ||
    (a.empresa || '').toLowerCase().includes(t) ||
    (a.local_instalacao || '').toLowerCase().includes(t) ||
    (a.observacoes || '').toLowerCase().includes(t)
  );
}

async function atualizarAtendimento({ atendimento_id, campos }) {
  return base44.update('ContatoFormulario', atendimento_id, campos);
}

// ─── CLIENTES ────────────────────────────────────────────────────────────────

async function listarClientes({ status, cidade, limit = 30 } = {}) {
  const query = {};
  if (status) query.status = status;
  if (cidade) query.cidade = cidade;
  return base44.list('Cliente', query, limit);
}

async function buscarCliente({ nome }) {
  const todos = await base44.list('Cliente', {}, 200);
  if (!nome) return todos.slice(0, 10);
  const t = nome.toLowerCase();
  return todos.filter(c =>
    (c.nome || '').toLowerCase().includes(t) ||
    (c.documento || '').includes(nome)
  ).slice(0, 10);
}

async function obterCliente({ cliente_id }) {
  return base44.get('Cliente', cliente_id);
}

// ─── CONTATOS ────────────────────────────────────────────────────────────────

async function listarContatosCliente({ cliente_id }) {
  return base44.list('Contato', { cliente_id }, 50);
}

// ─── INSTALAÇÕES ──────────────────────────────────────────────────────────────

async function listarInstalacoesCliente({ cliente_id }) {
  return base44.list('Instalacao', { cliente_id }, 50);
}

async function listarInstalacoes({ status, limit = 30 } = {}) {
  const query = {};
  if (status) query.status = status;
  return base44.list('Instalacao', query, limit);
}

// ─── PROPOSTAS ───────────────────────────────────────────────────────────────

async function listarPropostas({ cliente_id, status, limit = 20 } = {}) {
  const query = {};
  if (cliente_id) query.cliente_id = cliente_id;
  if (status) query.status = status;
  return base44.list('Proposta', query, limit);
}

// ─── RESUMO ESTRATÉGICO ───────────────────────────────────────────────────────

async function resumoEstrategico() {
  const [clientes, leads, atendimentos, instalacoes, propostas] = await Promise.all([
    base44.list('Cliente', {}, 200),
    base44.list('Lead', {}, 200),
    base44.list('ContatoFormulario', {}, 200),
    base44.list('Instalacao', {}, 200),
    base44.list('Proposta', {}, 200),
  ]);

  const clientesAtivos = clientes.filter(c => c.status === 'ativo').length;
  const leadsNovos = leads.filter(l => l.status === 'novo').length;
  const leadsConvertidos = leads.filter(l => l.status === 'convertido').length;
  const atendimentosNovos = atendimentos.filter(a => a.status_atendimento === 'novo').length;
  const instalacoesAtivas = instalacoes.filter(i => i.status === 'ativa').length;
  const propostasEnviadas = propostas.filter(p => p.status === 'enviada').length;
  const propostasAprovadas = propostas.filter(p => p.status === 'aprovada').length;

  // Origens dos atendimentos
  const origens = {};
  atendimentos.forEach(a => {
    const o = a.origem || 'outro';
    origens[o] = (origens[o] || 0) + 1;
  });

  return {
    clientes: { total: clientes.length, ativos: clientesAtivos },
    leads: { total: leads.length, novos: leadsNovos, convertidos: leadsConvertidos },
    atendimentos: { total: atendimentos.length, novos: atendimentosNovos, origens },
    instalacoes: { total: instalacoes.length, ativas: instalacoesAtivas },
    propostas: { total: propostas.length, enviadas: propostasEnviadas, aprovadas: propostasAprovadas },
    taxaConversao: leads.length > 0 ? `${((leadsConvertidos / leads.length) * 100).toFixed(1)}%` : '0%',
  };
}

module.exports = {
  listarLeads, buscarLead, atualizarLead,
  listarAtendimentos, buscarAtendimento, atualizarAtendimento,
  listarClientes, buscarCliente, obterCliente,
  listarContatosCliente, listarInstalacoesCliente, listarInstalacoes,
  listarPropostas,
  resumoEstrategico,
};

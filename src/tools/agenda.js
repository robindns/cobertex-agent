// src/tools/agenda.js
const base44 = require('../base44');

async function criarEvento({ diretor, titulo, descricao, data_inicio, data_fim, dia_todo, tipo, local, lembrete_minutos, recorrente, recorrencia }) {
  const payload = { diretor, titulo, data_inicio, concluido: false };
  if (descricao) payload.descricao = descricao;
  if (data_fim) payload.data_fim = data_fim;
  if (dia_todo !== undefined) payload.dia_todo = dia_todo;
  if (tipo) payload.tipo = tipo;
  if (local) payload.local = local;
  if (lembrete_minutos) payload.lembrete_minutos = lembrete_minutos;
  if (recorrente !== undefined) payload.recorrente = recorrente;
  if (recorrencia) payload.recorrencia = recorrencia;
  return base44.create('EventoAgenda', payload);
}

async function listarEventos({ diretor, data_inicio_partir, concluido, limit = 20 }) {
  const query = { diretor };
  if (concluido !== undefined) query.concluido = concluido;
  const todos = await base44.list('EventoAgenda', query, limit);
  let resultado = todos;
  if (data_inicio_partir) {
    const filtro = new Date(data_inicio_partir);
    resultado = resultado.filter(e => new Date(e.data_inicio) >= filtro);
  }
  return resultado.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
}

async function atualizarEvento({ evento_id, campos }) {
  return base44.update('EventoAgenda', evento_id, campos);
}

/**
 * Exclui um evento permanentemente
 */
async function excluirEvento({ evento_id }) {
  await base44.delete('EventoAgenda', evento_id);
  return { excluido: true, evento_id };
}

async function eventosHoje({ diretor }) {
  const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const inicioHoje = new Date(agoraSP.getFullYear(), agoraSP.getMonth(), agoraSP.getDate(), 0, 0, 0);
  const fimHoje = new Date(agoraSP.getFullYear(), agoraSP.getMonth(), agoraSP.getDate(), 23, 59, 59);
  const todos = await base44.list('EventoAgenda', { diretor }, 100);
  return todos.filter(e => {
    const data = new Date(e.data_inicio);
    return data >= inicioHoje && data <= fimHoje;
  }).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
}

module.exports = { criarEvento, listarEventos, atualizarEvento, excluirEvento, eventosHoje };

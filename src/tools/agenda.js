// src/tools/agenda.js
const base44 = require('../base44');

/**
 * Cria um evento na agenda do diretor
 */
async function criarEvento({ diretor, titulo, descricao, data_inicio, data_fim, dia_todo, tipo, local, lembrete_minutos, recorrente, recorrencia }) {
  const payload = {
    diretor,
    titulo,
    data_inicio,
    concluido: false,
  };

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

/**
 * Lista eventos da agenda de um diretor
 * Pode filtrar por data de início (hoje, semana, etc.)
 */
async function listarEventos({ diretor, data_inicio_partir, concluido, limit = 20 }) {
  const query = { diretor };
  if (concluido !== undefined) query.concluido = concluido;

  const todos = await base44.list('EventoAgenda', query, limit);

  // Filtra por data se informada
  if (data_inicio_partir) {
    const filtro = new Date(data_inicio_partir);
    return todos.filter(e => new Date(e.data_inicio) >= filtro);
  }

  // Ordena por data_inicio crescente
  return todos.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
}

/**
 * Atualiza um evento
 */
async function atualizarEvento({ evento_id, campos }) {
  return base44.update('EventoAgenda', evento_id, campos);
}

/**
 * Marca evento como concluído
 */
async function concluirEvento({ evento_id }) {
  return base44.update('EventoAgenda', evento_id, { concluido: true });
}

/**
 * Lista eventos de hoje para um diretor
 */
async function eventosHoje({ diretor }) {
  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString();
  const fimHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59).toISOString();

  const todos = await base44.list('EventoAgenda', { diretor }, 100);
  return todos.filter(e => {
    const data = new Date(e.data_inicio);
    return data >= new Date(inicioHoje) && data <= new Date(fimHoje);
  }).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
}

module.exports = { criarEvento, listarEventos, atualizarEvento, concluirEvento, eventosHoje };

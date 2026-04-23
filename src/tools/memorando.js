// src/tools/memorando.js
const base44 = require('../base44');

/**
 * Cria um memorando no sistema Cobertex
 */
async function criarMemorando({ titulo, conteudo, criador_id, cliente_id, instalacao_id, urgente, tags, anexos }) {
  const hoje = new Date().toISOString().split('T')[0];

  const payload = {
    titulo: titulo || 'Relato operacional',
    conteudo_transcrito: conteudo,
    data: hoje,
    criador_id,
    urgente: urgente || false,
    status: 'pendente',
  };

  if (cliente_id) payload.cliente_id = cliente_id;
  if (instalacao_id) payload.instalacao_id = instalacao_id;
  if (tags && tags.length) payload.tags = tags;
  if (anexos && anexos.length) payload.anexos = anexos;

  const resultado = await base44.create('Memorando', payload);
  return resultado;
}

/**
 * Lista memorandos recentes (hoje ou N dias)
 */
async function listarMemorandos({ cliente_id, status, limit = 20 }) {
  const query = {};
  if (cliente_id) query.cliente_id = cliente_id;
  if (status) query.status = status;

  const resultado = await base44.list('Memorando', query, limit);
  return resultado;
}

/**
 * Atualiza um memorando existente
 */
async function atualizarMemorando({ memorando_id, campos }) {
  const resultado = await base44.update('Memorando', memorando_id, campos);
  return resultado;
}

/**
 * Marca memorando como concluído
 */
async function concluirMemorando({ memorando_id }) {
  return atualizarMemorando({ memorando_id, campos: { status: 'concluido' } });
}

module.exports = { criarMemorando, listarMemorandos, atualizarMemorando, concluirMemorando };

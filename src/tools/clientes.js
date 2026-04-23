// src/tools/clientes.js
const base44 = require('../base44');

/**
 * Busca clientes por nome (busca parcial)
 */
async function buscarCliente({ nome }) {
  // Base44 suporta busca por campo; buscamos todos e filtramos
  const todos = await base44.list('Cliente', {}, 200);
  if (!nome) return todos.slice(0, 10);

  const nomeLower = nome.toLowerCase();
  return todos.filter(c =>
    c.nome?.toLowerCase().includes(nomeLower) ||
    c.documento?.includes(nome)
  ).slice(0, 10);
}

/**
 * Busca cliente por ID
 */
async function obterCliente({ cliente_id }) {
  return base44.get('Cliente', cliente_id);
}

/**
 * Lista instalações de um cliente
 */
async function listarInstalacoesCliente({ cliente_id }) {
  return base44.list('Instalacao', { cliente_id }, 50);
}

module.exports = { buscarCliente, obterCliente, listarInstalacoesCliente };

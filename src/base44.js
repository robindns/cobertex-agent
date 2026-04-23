// src/base44.js
const axios = require('axios');
const config = require('./config');

const client = axios.create({
  baseURL: config.BASE44_BASE_URL,
  headers: {
    'api_key': config.BASE44_API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// Interceptor para logar erros
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data || err.message;
    console.error(`[Base44] Erro ${err.response?.status}:`, JSON.stringify(msg));
    return Promise.reject(err);
  }
);

/**
 * Lista registros de uma entidade com filtro opcional
 */
async function list(entity, query = {}, limit = 50) {
  const params = { limit };
  if (Object.keys(query).length) {
    params.q = JSON.stringify(query);
  }
  const res = await client.get(`/entities/${entity}`, { params });
  return res.data;
}

/**
 * Busca um registro por ID
 */
async function get(entity, id) {
  const res = await client.get(`/entities/${entity}/${id}`);
  return res.data;
}

/**
 * Cria um registro
 */
async function create(entity, data) {
  const res = await client.post(`/entities/${entity}`, data);
  return res.data;
}

/**
 * Atualiza um registro
 */
async function update(entity, id, data) {
  const res = await client.put(`/entities/${entity}/${id}`, data);
  return res.data;
}

module.exports = { list, get, create, update };

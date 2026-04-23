# 🏗️ Cobertex Agent

Agente WhatsApp com IA para gestão operacional da **Cobertex** — registra memorandos, interpreta áudios e imagens, e responde a equipe de campo em tempo real.

---

## Funcionalidades

- 📝 **Registra memorandos** automaticamente a partir de mensagens de texto ou áudio
- 🎙️ **Transcreve áudios** via Whisper (OpenAI)
- 🖼️ **Interpreta imagens** via Claude Vision
- 🔊 **Responde em áudio** via ElevenLabs (quando mensagem for áudio e resposta curta)
- 👤 **Identifica usuários** pelo número do WhatsApp
- 🔔 **Escala para Robinson** quando solicitação estiver fora do escopo
- 🏷️ **Tags automáticas** para categorização dos memorandos

---

## Usuários autorizados

| Número | Nome | Perfil |
|--------|------|--------|
| 5511947436391 | Gustavo | CEO Operacional |
| 5511995692963 | Robinson | Admin |
| 5511925122380 | Equipe | Operacional |

---

## Deploy no Railway

### 1. Pré-requisitos

- Conta no Railway com o projeto `frosa-agent` já funcionando
- Evolution API já rodando (mesma instância Railway)
- Node.js 18+

### 2. Criar novo serviço no Railway

```bash
# Crie o repositório no GitHub
git init
git add .
git commit -m "feat: cobertex-agent inicial"
git remote add origin https://github.com/SEU_USER/cobertex-agent.git
git push -u origin main
```

No Railway:
1. **New Project** → **Deploy from GitHub repo** → selecione `cobertex-agent`
2. Ou adicione como novo **Service** dentro do seu projeto existente

### 3. Configurar variáveis de ambiente no Railway

Copie o `.env.example` e preencha todas as variáveis em **Variables** no Railway:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
EVOLUTION_API_URL=https://evolution-api-production-2a78.up.railway.app
EVOLUTION_API_KEY=sua_chave
EVOLUTION_INSTANCE=cobertex
BASE44_API_KEY=652f2efaebd040f48c7eeda422c4a288
USER_ID_GUSTAVO=id_real_do_gustavo
USER_ID_ROBINSON=id_real_do_robinson
USER_ID_EQUIPE=id_do_usuario_equipe
```

### 4. Obter os IDs dos usuários no Base44

Acesse: `https://cobertex-crm-dc1fb74c.base44.app/api/entities/User`
com o header `api_key: 652f2efaebd040f48c7eeda422c4a288`

Copie o `id` de cada usuário e cole nas variáveis acima.

### 5. Criar instância WhatsApp na Evolution API

Após o deploy, configure a instância `cobertex` na Evolution API:

```bash
# Criar instância
curl -X POST https://evolution-api-production-2a78.up.railway.app/instance/create \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "cobertex",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'

# Pegar QR Code para conectar o número 5511925122380
curl https://evolution-api-production-2a78.up.railway.app/instance/connect/cobertex \
  -H "apikey: SUA_API_KEY"
```

### 6. Configurar webhook na Evolution API

```bash
curl -X POST https://evolution-api-production-2a78.up.railway.app/webhook/set/cobertex \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://SEU_AGENTE.railway.app/webhook",
      "webhookByEvents": false,
      "webhookBase64": true,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

> ⚠️ Substitua `SEU_AGENTE.railway.app` pela URL do Railway do cobertex-agent.

---

## Exemplos de uso

### Relato de saída de equipe
> *"Gustavo: Saindo da empresa agora com João e Pedro no caminhão, destino cliente Textilária ABC, ETA 2h"*

→ IA cria memorando: "Saída equipe - Textilária ABC" com tags: [saida, equipe, caminhao]

### Chegada em obra
> *"Chegamos na Textilária ABC, tudo certo, iniciando montagem"*

→ IA cria memorando: "Chegada - Textilária ABC - início montagem" com tags: [chegada, montagem]

### Imagem de obra
> *[envia foto] "Situação da cobertura antes da montagem"*

→ IA descreve a imagem e cria memorando com a descrição e anexo

### Áudio de ocorrência
> *[nota de voz] "O caminhão furou o pneu na Marginal, precisamos de socorro"*

→ IA transcreve, detecta urgência, cria memorando urgente e responde em áudio

### Consulta de registros
> *"O que temos registrado hoje?"*

→ IA lista os memorandos do dia

---

## Estrutura do projeto

```
cobertex-agent/
├── src/
│   ├── index.js      # Servidor Express + webhook
│   ├── agent.js      # Lógica Claude + tool use
│   ├── media.js      # Áudio (Whisper) + Imagem (Vision) + TTS (ElevenLabs)
│   ├── evolution.js  # Envio de mensagens WhatsApp
│   ├── base44.js     # Cliente REST Base44
│   ├── config.js     # Configurações e env vars
│   └── tools/
│       ├── memorando.js  # CRUD memorandos
│       └── clientes.js   # Busca clientes (read-only)
├── .env.example
├── package.json
├── railway.toml
└── README.md
```

---

## Escopo do agente

| ✅ Faz | ❌ Não faz |
|--------|-----------|
| Criar/listar memorandos | Criar/editar clientes |
| Interpretar áudios | Criar propostas |
| Interpretar imagens | Gerenciar leads |
| Buscar clientes (leitura) | Criar atendimentos |
| Responder em áudio | Alterar dados do CRM |
| Notificar Robinson | Acessar dados financeiros |

---

## Suporte

Problemas ou funcionalidades fora do escopo são automaticamente reportados para Robinson (5511995692963).

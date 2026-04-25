// Patch: adicionar tools de preferências ao agent
// Este arquivo documenta as tools adicionais a serem inseridas no TOOLS array

const TOOLS_AGENDA_PREFS = [
  {
    name: 'configurar_lembretes',
    description: `Configura as preferências de notificações da agenda do usuário.
Use quando o usuário disser:
- "quero ser avisado 15 min antes" → minutosAntes: 15
- "ativar resumo diário às 8h" → resumoDiario: true, horaResumo: "08:00"
- "desativar lembretes" → lembretes: false
- "não quero mais resumo" → resumoDiario: false`,
    input_schema: {
      type: 'object',
      properties: {
        lembretes: { type: 'boolean', description: 'Ativar/desativar lembretes antes dos eventos' },
        minutosAntes: { type: 'number', description: 'Quantos minutos antes enviar o lembrete' },
        resumoDiario: { type: 'boolean', description: 'Ativar/desativar resumo diário da agenda' },
        horaResumo: { type: 'string', description: 'Horário do resumo diário (ex: "08:00")' },
      },
      required: [],
    },
  },
  {
    name: 'ver_preferencias',
    description: 'Mostra as configurações de notificação atuais do usuário.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

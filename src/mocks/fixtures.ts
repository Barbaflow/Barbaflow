/**
 * Dados fictícios do modo offline (VITE_DATA_SOURCE=mock).
 *
 * Tudo aqui é inventado: nenhuma URL, id ou chave real do Supabase.
 * Os tipos vêm de src/integrations/supabase/types.ts, então o formato
 * acompanha o schema real sem precisar de banco.
 *
 * Duas barbearias independentes (A e B) permitem exercitar o isolamento
 * multi-tenant: nenhum dado de uma deve aparecer na outra.
 */
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_BARBERSHOP_ID } from "@/lib/constants";

type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;
export type TableRow<T extends TableName> = Tables[T]["Row"];

/** Conjunto completo de tabelas fictícias. Tabelas ausentes resolvem para lista vazia. */
export type MockDatabase = {
  [K in TableName]?: TableRow<K>[];
};

/* ------------------------------------------------------------------ */
/* Identificadores fictícios                                           */
/* ------------------------------------------------------------------ */

/** Barbearia A — é a barbearia padrão resolvida por src/lib/constants.ts. */
export const MOCK_BARBERSHOP_ID = DEFAULT_BARBERSHOP_ID;

/** Barbearia B — usada para provar o isolamento entre tenants. */
export const MOCK_BARBERSHOP_B_ID = "b1b2c3d4-e5f6-7890-abcd-ef0987654321";

export const MOCK_USER_IDS = {
  // Barbearia A
  admin: "11111111-1111-4111-8111-111111111111",
  barberAna: "22222222-2222-4222-8222-222222222222",
  barberBruno: "33333333-3333-4333-8333-333333333333",
  clienteCarla: "44444444-4444-4444-8444-444444444444",
  clienteCaio: "45454545-4545-4545-8545-454545454545",
  /** Cliente sem telefone cadastrado. */
  clienteDiego: "46464646-4646-4646-8646-464646464646",
  /** Cliente avulso (walk-in) já existente no seed. */
  walkinEva: "47474747-4747-4747-8747-474747474747",
  // Barbearia B
  adminBeatriz: "55555555-5555-4555-8555-555555555555",
  barberBianca: "66666666-6666-4666-8666-666666666666",
  barberBreno: "77777777-7777-4777-8777-777777777777",
  clienteBento: "88888888-8888-4888-8888-888888888888",
  /** Cliente da B sem telefone. */
  clienteBruna: "89898989-8989-4989-8989-898989898989",
} as const;

export const MOCK_ADMIN_EMAIL = "admin@barbearia.teste";
export const MOCK_ADMIN_B_EMAIL = "beatriz@navalha.teste";
/** Destinatário do convite de equipe que pode ser aceito no seed. */
export const MOCK_CLIENT_BENTO_EMAIL = "bento@cliente.teste";

const SERVICE_IDS = {
  // Barbearia A
  corte: "aaaaaaa1-0000-4000-8000-000000000001",
  barba: "aaaaaaa1-0000-4000-8000-000000000002",
  combo: "aaaaaaa1-0000-4000-8000-000000000003",
  pezinho: "aaaaaaa1-0000-4000-8000-000000000004",
  platinado: "aaaaaaa1-0000-4000-8000-000000000005",
  // Barbearia A — o admin também atende
  corteAlex: "aaaaaaa1-0000-4000-8000-000000000006",
  barbaAlex: "aaaaaaa1-0000-4000-8000-000000000007",
  // Barbearia B
  corteB: "aaaaaaa2-0000-4000-8000-000000000001",
  barbaB: "aaaaaaa2-0000-4000-8000-000000000002",
  comboB: "aaaaaaa2-0000-4000-8000-000000000003",
  corteBeatriz: "aaaaaaa2-0000-4000-8000-000000000004",
} as const;

export const MOCK_SERVICE_IDS = SERVICE_IDS;

/** Planos — `pro` libera a tela de relatórios (ver useCanAccessFeature). */
export const MOCK_PLAN_IDS = {
  free: "0c0c0c01-0000-4000-8000-000000000001",
  pro: "0c0c0c01-0000-4000-8000-000000000002",
  enterprise: "0c0c0c01-0000-4000-8000-000000000003",
} as const;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dia da semana (0 = domingo) de uma data ISO, na convenção usada pelo app. */
export function dayOfWeekOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00`).getDay();
}

const NOW_ISO = new Date().toISOString();

/** "HH:MM:SS" → minutos desde 00:00. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** minutos desde 00:00 → "HH:MM:SS". */
export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** Horizonte de dias para os quais o seed gera disponibilidade. */
const AVAILABILITY_HORIZON_DAYS = 21;

/** Passo padrão da grade de horários, em minutos. */
const SLOT_STEP_MINUTES = 30;

/* ------------------------------------------------------------------ */
/* Barbearias                                                          */
/* ------------------------------------------------------------------ */

function buildBarbershops(): TableRow<"barbershops">[] {
  const base = {
    // Plano pro: sem isso a rota /relatorios cai no paywall do plano free.
    plan_id: MOCK_PLAN_IDS.pro,
    timezone: "America/Sao_Paulo",
    // Storage indisponível no modo offline: nenhuma URL de arquivo simulada.
    logo_url: null,
    complement: null,
    appointments_this_month: 3,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  };

  return [
    {
      ...base,
      id: MOCK_BARBERSHOP_ID,
      name: "Barbearia Modelo (offline)",
      subdomain: "modelo",
      status: "approved",
      owner_id: MOCK_USER_IDS.admin,
      primary_color: "#C8A96E",
      secondary_color: "#1A1A1A",
      cep: "01310-100",
      street: "Avenida Paulista",
      number: "1000",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      rating_avg: 4.8,
      rating_count: 12,
      // Políticas mais permissivas que as da B.
      cancel_min_hours: 2,
      reschedule_min_hours: 2,
      noshow_policy_enabled: false,
      noshow_max_count: 3,
      noshow_block_days: 7,
      whatsapp_message: "Olá! Aqui é da Barbearia Modelo. Seu horário está confirmado.",
      pdf_template: "classico",
      pdf_slogan: "Tradição desde 1998",
      qr_size: "240",
      receipt_title: "Recibo — Barbearia Modelo",
      receipt_subtitle: "Obrigado pela preferência",
      receipt_footer: "Av. Paulista, 1000 — São Paulo/SP",
      receipt_thank_you_message: "Volte sempre!",
      receipt_whatsapp_intro: "Segue o comprovante do seu atendimento:",
    },
    {
      ...base,
      id: MOCK_BARBERSHOP_B_ID,
      name: "Navalha de Ouro (offline)",
      subdomain: "navalha",
      status: "approved",
      owner_id: MOCK_USER_IDS.adminBeatriz,
      primary_color: "#8E6BC8",
      secondary_color: "#141018",
      cep: "22071-900",
      street: "Avenida Atlântica",
      number: "250",
      neighborhood: "Copacabana",
      city: "Rio de Janeiro",
      state: "RJ",
      rating_avg: 4.5,
      rating_count: 7,
      // Políticas mais rígidas e política de falta ativa.
      cancel_min_hours: 24,
      reschedule_min_hours: 12,
      noshow_policy_enabled: true,
      noshow_max_count: 2,
      noshow_block_days: 15,
      whatsapp_message: "Navalha de Ouro agradece! Seu horário está reservado.",
      pdf_template: "moderno",
      pdf_slogan: "Corte de assinatura",
      qr_size: "320",
      receipt_title: "Comprovante — Navalha de Ouro",
      receipt_subtitle: "Atendimento premium",
      receipt_footer: "Av. Atlântica, 250 — Rio de Janeiro/RJ",
      receipt_thank_you_message: "Foi um prazer atender você.",
      receipt_whatsapp_intro: "Seu comprovante:",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Pessoas                                                             */
/* ------------------------------------------------------------------ */

interface PersonSeed {
  userId: string;
  profileId: string;
  fullName: string;
  /** `null` reproduz o cliente cadastrado sem telefone. */
  phone: string | null;
}

const PEOPLE: readonly PersonSeed[] = [
  {
    userId: MOCK_USER_IDS.admin,
    profileId: "bbbbbbb1-0000-4000-8000-000000000001",
    fullName: "Alex Admin",
    phone: "+5511900000001",
  },
  {
    userId: MOCK_USER_IDS.barberAna,
    profileId: "bbbbbbb1-0000-4000-8000-000000000002",
    fullName: "Ana Tesoura",
    phone: "+5511900000002",
  },
  {
    userId: MOCK_USER_IDS.barberBruno,
    profileId: "bbbbbbb1-0000-4000-8000-000000000003",
    fullName: "Bruno Navalha",
    phone: "+5511900000003",
  },
  {
    userId: MOCK_USER_IDS.clienteCarla,
    profileId: "bbbbbbb1-0000-4000-8000-000000000004",
    fullName: "Carla Cliente",
    phone: "+5511900000004",
  },
  {
    userId: MOCK_USER_IDS.clienteCaio,
    profileId: "bbbbbbb1-0000-4000-8000-000000000005",
    fullName: "Caio Cliente",
    phone: "+5511900000005",
  },
  {
    userId: MOCK_USER_IDS.clienteDiego,
    profileId: "bbbbbbb1-0000-4000-8000-000000000006",
    fullName: "Diego Cliente",
    phone: null,
  },
  {
    userId: MOCK_USER_IDS.walkinEva,
    profileId: "bbbbbbb1-0000-4000-8000-000000000007",
    fullName: "Eva Avulsa",
    phone: "+5511900000007",
  },
  {
    userId: MOCK_USER_IDS.adminBeatriz,
    profileId: "bbbbbbb2-0000-4000-8000-000000000001",
    fullName: "Beatriz Dona",
    phone: "+5521900000001",
  },
  {
    userId: MOCK_USER_IDS.barberBianca,
    profileId: "bbbbbbb2-0000-4000-8000-000000000002",
    fullName: "Bianca Lâmina",
    phone: "+5521900000002",
  },
  {
    userId: MOCK_USER_IDS.barberBreno,
    profileId: "bbbbbbb2-0000-4000-8000-000000000003",
    fullName: "Breno Pente",
    phone: "+5521900000003",
  },
  {
    userId: MOCK_USER_IDS.clienteBento,
    profileId: "bbbbbbb2-0000-4000-8000-000000000004",
    fullName: "Bento Cliente",
    phone: "+5521900000004",
  },
  {
    userId: MOCK_USER_IDS.clienteBruna,
    profileId: "bbbbbbb2-0000-4000-8000-000000000005",
    fullName: "Bruna Cliente",
    phone: null,
  },
];

function buildProfiles(): TableRow<"profiles">[] {
  return PEOPLE.map((person) => ({
    id: person.profileId,
    user_id: person.userId,
    full_name: person.fullName,
    phone: person.phone,
    avatar_url: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  }));
}

/* ------------------------------------------------------------------ */
/* Papéis                                                             */
/* ------------------------------------------------------------------ */

type AppRole = Database["public"]["Enums"]["app_role"];

interface RoleSeed {
  userId: string;
  barbershopId: string;
  role: AppRole;
}

const ROLES: readonly RoleSeed[] = [
  // Barbearia A — o admin também atende, então tem as duas roles.
  // Sem isso, /relatorios (que filtra por barber_id = user.id) vem vazio para ele.
  { userId: MOCK_USER_IDS.admin, barbershopId: MOCK_BARBERSHOP_ID, role: "admin_barbearia" },
  { userId: MOCK_USER_IDS.admin, barbershopId: MOCK_BARBERSHOP_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.barberAna, barbershopId: MOCK_BARBERSHOP_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.barberBruno, barbershopId: MOCK_BARBERSHOP_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.clienteCarla, barbershopId: MOCK_BARBERSHOP_ID, role: "cliente" },
  { userId: MOCK_USER_IDS.clienteCaio, barbershopId: MOCK_BARBERSHOP_ID, role: "cliente" },
  { userId: MOCK_USER_IDS.clienteDiego, barbershopId: MOCK_BARBERSHOP_ID, role: "cliente" },
  { userId: MOCK_USER_IDS.walkinEva, barbershopId: MOCK_BARBERSHOP_ID, role: "cliente" },
  // Barbearia B
  { userId: MOCK_USER_IDS.adminBeatriz, barbershopId: MOCK_BARBERSHOP_B_ID, role: "admin_barbearia" },
  { userId: MOCK_USER_IDS.adminBeatriz, barbershopId: MOCK_BARBERSHOP_B_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.barberBianca, barbershopId: MOCK_BARBERSHOP_B_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.barberBreno, barbershopId: MOCK_BARBERSHOP_B_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.clienteBento, barbershopId: MOCK_BARBERSHOP_B_ID, role: "cliente" },
  { userId: MOCK_USER_IDS.clienteBruna, barbershopId: MOCK_BARBERSHOP_B_ID, role: "cliente" },
];

function buildUserRoles(): TableRow<"user_roles">[] {
  return ROLES.map((seed, index) => ({
    id: `ccccccc1-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    user_id: seed.userId,
    barbershop_id: seed.barbershopId,
    role: seed.role,
    created_at: NOW_ISO,
  }));
}

/* ------------------------------------------------------------------ */
/* Serviços — durações propositalmente diferentes                      */
/* ------------------------------------------------------------------ */

function buildServices(): TableRow<"services">[] {
  const base = { active: true, created_at: NOW_ISO, updated_at: NOW_ISO };

  return [
    // Barbearia A
    {
      ...base,
      id: SERVICE_IDS.corte,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      name: "Corte masculino",
      price: 60,
      duration_minutes: 30,
    },
    {
      ...base,
      id: SERVICE_IDS.barba,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      name: "Barba",
      price: 40,
      duration_minutes: 60,
    },
    {
      ...base,
      id: SERVICE_IDS.combo,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberBruno,
      name: "Corte + Barba",
      price: 90,
      duration_minutes: 90,
    },
    {
      ...base,
      id: SERVICE_IDS.platinado,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberBruno,
      name: "Platinado",
      price: 150,
      duration_minutes: 120,
    },
    {
      ...base,
      id: SERVICE_IDS.pezinho,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberBruno,
      name: "Pezinho",
      price: 25,
      duration_minutes: 30,
      active: false,
    },
    // Barbearia B
    {
      ...base,
      id: SERVICE_IDS.corteAlex,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.admin,
      name: "Corte executivo",
      price: 80,
      duration_minutes: 45,
    },
    {
      ...base,
      id: SERVICE_IDS.barbaAlex,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.admin,
      name: "Barba premium",
      price: 70,
      duration_minutes: 30,
    },
    // Barbearia B
    {
      ...base,
      id: SERVICE_IDS.corteBeatriz,
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      barber_id: MOCK_USER_IDS.adminBeatriz,
      name: "Corte assinatura",
      price: 95,
      duration_minutes: 45,
    },
    {
      ...base,
      id: SERVICE_IDS.corteB,
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      barber_id: MOCK_USER_IDS.barberBianca,
      name: "Corte navalhado",
      price: 75,
      duration_minutes: 60,
    },
    {
      ...base,
      id: SERVICE_IDS.barbaB,
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      barber_id: MOCK_USER_IDS.barberBianca,
      name: "Barba terapia",
      price: 55,
      duration_minutes: 30,
    },
    {
      ...base,
      id: SERVICE_IDS.comboB,
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      barber_id: MOCK_USER_IDS.barberBreno,
      name: "Dia do noivo",
      price: 200,
      duration_minutes: 120,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Grade semanal                                                       */
/* ------------------------------------------------------------------ */

interface WeeklySeed {
  barberId: string;
  barbershopId: string;
  /** Dias da semana atendidos (0 = domingo). */
  days: readonly number[];
  start: string;
  end: string;
}

const WEEKLY: readonly WeeklySeed[] = [
  // Barbearia A — o admin atende de terça a sábado.
  {
    barberId: MOCK_USER_IDS.admin,
    barbershopId: MOCK_BARBERSHOP_ID,
    days: [2, 3, 4, 5, 6],
    start: "09:00:00",
    end: "17:00:00",
  },
  // Barbearia B — a admin também atende.
  {
    barberId: MOCK_USER_IDS.adminBeatriz,
    barbershopId: MOCK_BARBERSHOP_B_ID,
    days: [1, 2, 3, 4, 5],
    start: "09:00:00",
    end: "18:00:00",
  },
  // Ana atende de segunda a sexta; Bruno inclui sábado.
  {
    barberId: MOCK_USER_IDS.barberAna,
    barbershopId: MOCK_BARBERSHOP_ID,
    days: [1, 2, 3, 4, 5],
    start: "09:00:00",
    end: "18:00:00",
  },
  {
    barberId: MOCK_USER_IDS.barberBruno,
    barbershopId: MOCK_BARBERSHOP_ID,
    days: [2, 3, 4, 5, 6],
    start: "10:00:00",
    end: "19:00:00",
  },
  // Barbearia B
  {
    barberId: MOCK_USER_IDS.barberBianca,
    barbershopId: MOCK_BARBERSHOP_B_ID,
    days: [1, 2, 3, 4, 5],
    start: "08:00:00",
    end: "17:00:00",
  },
  {
    barberId: MOCK_USER_IDS.barberBreno,
    barbershopId: MOCK_BARBERSHOP_B_ID,
    days: [3, 4, 5, 6],
    start: "11:00:00",
    end: "20:00:00",
  },
];

function buildWeeklySchedule(): TableRow<"weekly_schedule">[] {
  const rows: TableRow<"weekly_schedule">[] = [];
  let index = 0;

  for (const seed of WEEKLY) {
    for (const day of seed.days) {
      index += 1;
      rows.push({
        id: `eeeeeee1-0000-4000-8000-${String(index).padStart(12, "0")}`,
        barbershop_id: seed.barbershopId,
        barber_id: seed.barberId,
        day_of_week: day,
        start_time: seed.start,
        end_time: seed.end,
        is_active: true,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      });
    }
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Bloqueios                                                           */
/* ------------------------------------------------------------------ */

function buildScheduleBlocks(): TableRow<"schedule_blocks">[] {
  return [
    {
      id: "fffffff1-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberBruno,
      block_date: isoDateOffset(3),
      block_type: "pessoal",
      reason: "Compromisso pessoal (fictício)",
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: "fffffff1-0000-4000-8000-000000000002",
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      block_date: isoDateOffset(7),
      block_type: "ferias",
      reason: "Férias (fictício)",
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: "fffffff2-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      barber_id: MOCK_USER_IDS.barberBianca,
      block_date: isoDateOffset(4),
      block_type: "feriado",
      reason: "Feriado local (fictício)",
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Agendamentos                                                        */
/* ------------------------------------------------------------------ */

type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

interface AppointmentSeed {
  id: string;
  barbershopId: string;
  barberId: string;
  clientId: string;
  serviceId: string;
  dayOffset: number;
  start: string;
  durationMinutes: number;
  status: AppointmentStatus;
  notes?: string;
}

/* ---------- gerador determinístico do histórico ---------- */

/**
 * Gerador congruente linear. É determinístico de propósito: o seed precisa
 * ser idêntico a cada `resetMockDatabase()`, senão os gráficos mudariam a
 * cada restauração e os testes não poderiam afirmar nada.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Quantos dias para trás o histórico cobre (suficiente para filtros de 30 dias e mês anterior). */
const HISTORY_DAYS_BACK = 75;

/** Quantos dias para frente há agendamentos marcados. */
const HISTORY_DAYS_AHEAD = 10;

interface BarberPlan {
  barbershopId: string;
  barberId: string;
  clientIds: readonly string[];
}

const BARBER_PLANS: readonly BarberPlan[] = [
  {
    barbershopId: MOCK_BARBERSHOP_ID,
    barberId: MOCK_USER_IDS.admin,
    clientIds: [MOCK_USER_IDS.clienteCarla, MOCK_USER_IDS.clienteDiego],
  },
  {
    barbershopId: MOCK_BARBERSHOP_ID,
    barberId: MOCK_USER_IDS.barberAna,
    clientIds: [
      MOCK_USER_IDS.clienteCarla,
      MOCK_USER_IDS.clienteCaio,
      MOCK_USER_IDS.clienteDiego,
    ],
  },
  {
    barbershopId: MOCK_BARBERSHOP_ID,
    barberId: MOCK_USER_IDS.barberBruno,
    clientIds: [MOCK_USER_IDS.clienteCaio, MOCK_USER_IDS.clienteCarla, MOCK_USER_IDS.walkinEva],
  },
  {
    barbershopId: MOCK_BARBERSHOP_B_ID,
    barberId: MOCK_USER_IDS.adminBeatriz,
    clientIds: [MOCK_USER_IDS.clienteBento, MOCK_USER_IDS.clienteBruna],
  },
  {
    barbershopId: MOCK_BARBERSHOP_B_ID,
    barberId: MOCK_USER_IDS.barberBianca,
    clientIds: [MOCK_USER_IDS.clienteBento, MOCK_USER_IDS.clienteBruna],
  },
  {
    barbershopId: MOCK_BARBERSHOP_B_ID,
    barberId: MOCK_USER_IDS.barberBreno,
    clientIds: [MOCK_USER_IDS.clienteBento],
  },
];

/**
 * Escolhe o status conforme a posição no tempo:
 * passado vira majoritariamente "completed", com uma minoria de
 * "cancelled"/"no_show"; futuro fica "scheduled" com alguns cancelamentos.
 */
function pickStatus(isPast: boolean, roll: number): AppointmentStatus {
  if (!isPast) return roll < 0.12 ? "cancelled" : "scheduled";
  if (roll < 0.72) return "completed";
  if (roll < 0.86) return "cancelled";
  return "no_show";
}

/**
 * Gera o histórico percorrendo a grade semanal de cada profissional:
 * só cria agendamento em dia atendido, fora de bloqueio e sem sobreposição,
 * mantendo os dados coerentes com as regras de src/mocks/rules.ts.
 */
function generateAppointments(
  weekly: TableRow<"weekly_schedule">[],
  blocks: TableRow<"schedule_blocks">[],
  services: TableRow<"services">[],
): TableRow<"appointments">[] {
  const rows: TableRow<"appointments">[] = [];
  const random = createRandom(20260415);
  let index = 0;

  for (let offset = -HISTORY_DAYS_BACK; offset <= HISTORY_DAYS_AHEAD; offset += 1) {
    const date = isoDateOffset(offset);
    const dow = dayOfWeekOf(date);
    const isPast = offset < 0;

    for (const plan of BARBER_PLANS) {
      const shift = weekly.find(
        (item) =>
          item.barber_id === plan.barberId &&
          item.barbershop_id === plan.barbershopId &&
          item.day_of_week === dow &&
          item.is_active,
      );
      if (!shift) continue;

      const blocked = blocks.some(
        (block) => block.barber_id === plan.barberId && block.block_date === date,
      );
      if (blocked) continue;

      const ownServices = services.filter(
        (service) =>
          service.barber_id === plan.barberId &&
          service.barbershop_id === plan.barbershopId &&
          service.active,
      );
      if (ownServices.length === 0) continue;

      // 0 a 3 atendimentos por dia, encadeados sem sobreposição.
      const count = Math.floor(random() * 4);
      let cursor = timeToMinutes(shift.start_time) + Math.floor(random() * 3) * 30;
      const shiftEnd = timeToMinutes(shift.end_time);

      for (let n = 0; n < count; n += 1) {
        const service = ownServices[Math.floor(random() * ownServices.length)];
        const end = cursor + service.duration_minutes;
        if (end > shiftEnd) break;

        index += 1;
        rows.push({
          id: `ddddddd0-0000-4000-8000-${String(index).padStart(12, "0")}`,
          barbershop_id: plan.barbershopId,
          barber_id: plan.barberId,
          client_id: plan.clientIds[Math.floor(random() * plan.clientIds.length)],
          service_id: service.id,
          date,
          start_time: minutesToTime(cursor),
          end_time: minutesToTime(end),
          status: pickStatus(isPast, random()),
          notes: null,
          created_at: NOW_ISO,
          updated_at: NOW_ISO,
        });

        // Intervalo de 0 ou 30 min entre atendimentos.
        cursor = end + Math.floor(random() * 2) * 30;
      }
    }
  }

  return rows;
}

/**
 * O primeiro agendamento futuro de cada barbeiro cai num horário da grade,
 * para que o teste "tentar agendar horário ocupado" tenha um alvo previsível.
 */
const APPOINTMENTS: readonly AppointmentSeed[] = [
  {
    id: "ddddddd1-0000-4000-8000-000000000001",
    barbershopId: MOCK_BARBERSHOP_ID,
    barberId: MOCK_USER_IDS.barberAna,
    clientId: MOCK_USER_IDS.clienteCarla,
    serviceId: SERVICE_IDS.corte,
    dayOffset: 1,
    start: "10:00:00",
    durationMinutes: 30,
    status: "scheduled",
    notes: "Agendamento fictício de amanhã.",
  },
  {
    id: "ddddddd1-0000-4000-8000-000000000002",
    barbershopId: MOCK_BARBERSHOP_ID,
    barberId: MOCK_USER_IDS.barberBruno,
    clientId: MOCK_USER_IDS.clienteCaio,
    serviceId: SERVICE_IDS.combo,
    dayOffset: 2,
    start: "14:00:00",
    durationMinutes: 90,
    status: "scheduled",
  },
  {
    id: "ddddddd1-0000-4000-8000-000000000003",
    barbershopId: MOCK_BARBERSHOP_ID,
    barberId: MOCK_USER_IDS.barberAna,
    clientId: MOCK_USER_IDS.clienteCarla,
    serviceId: SERVICE_IDS.barba,
    dayOffset: -3,
    start: "09:00:00",
    durationMinutes: 60,
    status: "completed",
  },
  {
    id: "ddddddd1-0000-4000-8000-000000000004",
    barbershopId: MOCK_BARBERSHOP_ID,
    barberId: MOCK_USER_IDS.barberBruno,
    clientId: MOCK_USER_IDS.clienteCarla,
    serviceId: SERVICE_IDS.platinado,
    dayOffset: -10,
    start: "15:00:00",
    durationMinutes: 120,
    status: "no_show",
  },
  {
    id: "ddddddd2-0000-4000-8000-000000000001",
    barbershopId: MOCK_BARBERSHOP_B_ID,
    barberId: MOCK_USER_IDS.barberBianca,
    clientId: MOCK_USER_IDS.clienteBento,
    serviceId: SERVICE_IDS.corteB,
    dayOffset: 1,
    start: "09:00:00",
    durationMinutes: 60,
    status: "scheduled",
    notes: "Agendamento fictício da Barbearia B.",
  },
  {
    id: "ddddddd2-0000-4000-8000-000000000002",
    barbershopId: MOCK_BARBERSHOP_B_ID,
    barberId: MOCK_USER_IDS.barberBreno,
    clientId: MOCK_USER_IDS.clienteBento,
    serviceId: SERVICE_IDS.comboB,
    dayOffset: -5,
    start: "11:00:00",
    durationMinutes: 120,
    status: "completed",
  },
];

/**
 * Agendamentos fixos ("âncoras"): ids estáveis, referenciados pelas
 * avaliações e usados como alvo previsível nos testes.
 */
function buildAnchorAppointments(): TableRow<"appointments">[] {
  return APPOINTMENTS.map((seed) => ({
    id: seed.id,
    barbershop_id: seed.barbershopId,
    barber_id: seed.barberId,
    client_id: seed.clientId,
    service_id: seed.serviceId,
    date: isoDateOffset(seed.dayOffset),
    start_time: seed.start,
    end_time: minutesToTime(timeToMinutes(seed.start) + seed.durationMinutes),
    status: seed.status,
    notes: seed.notes ?? null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  }));
}

/** Âncoras + histórico gerado, descartando o que colidiria com uma âncora. */
function buildAppointments(
  weekly: TableRow<"weekly_schedule">[],
  blocks: TableRow<"schedule_blocks">[],
  services: TableRow<"services">[],
): TableRow<"appointments">[] {
  const anchors = buildAnchorAppointments();

  const generated = generateAppointments(weekly, blocks, services).filter(
    (candidate) =>
      !anchors.some(
        (anchor) =>
          anchor.barber_id === candidate.barber_id &&
          anchor.date === candidate.date &&
          overlaps(
            timeToMinutes(candidate.start_time),
            timeToMinutes(candidate.end_time),
            timeToMinutes(anchor.start_time),
            timeToMinutes(anchor.end_time),
          ),
      ),
  );

  return [...anchors, ...generated];
}

/* ------------------------------------------------------------------ */
/* Disponibilidade — derivada da grade, dos bloqueios e da agenda      */
/* ------------------------------------------------------------------ */

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Gera a grade de horários dos próximos dias a partir de weekly_schedule.
 * Dias bloqueados não geram slots; slots que colidem com um agendamento
 * ativo nascem como "ocupado".
 */
function buildAvailability(
  weekly: TableRow<"weekly_schedule">[],
  blocks: TableRow<"schedule_blocks">[],
  appointments: TableRow<"appointments">[],
): TableRow<"availability">[] {
  const rows: TableRow<"availability">[] = [];
  let index = 0;

  for (let offset = 0; offset < AVAILABILITY_HORIZON_DAYS; offset += 1) {
    const date = isoDateOffset(offset);
    const dow = dayOfWeekOf(date);

    for (const shift of weekly) {
      if (!shift.is_active || shift.day_of_week !== dow) continue;

      const isBlocked = blocks.some(
        (block) => block.barber_id === shift.barber_id && block.block_date === date,
      );
      if (isBlocked) continue;

      const busy = appointments
        .filter(
          (appointment) =>
            appointment.barber_id === shift.barber_id &&
            appointment.date === date &&
            appointment.status !== "cancelled",
        )
        .map((appointment) => ({
          start: timeToMinutes(appointment.start_time),
          end: timeToMinutes(appointment.end_time),
        }));

      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);

      for (let start = shiftStart; start + SLOT_STEP_MINUTES <= shiftEnd; start += SLOT_STEP_MINUTES) {
        const end = start + SLOT_STEP_MINUTES;
        index += 1;

        const taken = busy.some((slot) => overlaps(start, end, slot.start, slot.end));

        rows.push({
          id: `0a0a0a01-0000-4000-8000-${String(index).padStart(12, "0")}`,
          barbershop_id: shift.barbershop_id,
          barber_id: shift.barber_id,
          date,
          start_time: minutesToTime(start),
          end_time: minutesToTime(end),
          status: taken ? "ocupado" : "livre",
          created_at: NOW_ISO,
          updated_at: NOW_ISO,
        });
      }
    }
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Avaliações — alimentam a nota exibida na escolha do barbeiro        */
/* ------------------------------------------------------------------ */

function buildReviews(): TableRow<"reviews">[] {
  const base = {
    comment: null,
    replied_by: null,
    reply: null,
    reply_at: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  };

  return [
    {
      ...base,
      id: "0b0b0b01-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: MOCK_USER_IDS.clienteCarla,
      appointment_id: "ddddddd1-0000-4000-8000-000000000003",
      rating: 5,
      comment: "Atendimento impecável (avaliação fictícia).",
    },
    {
      ...base,
      id: "0b0b0b02-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      client_id: MOCK_USER_IDS.clienteBento,
      appointment_id: "ddddddd2-0000-4000-8000-000000000002",
      rating: 4,
      comment: "Muito bom (avaliação fictícia).",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Convites de equipe                                                  */
/* ------------------------------------------------------------------ */

/**
 * Cobre os quatro estados que TeamManager renderiza. O convite "expirado"
 * fica com `status: "pending"` e `expires_at` no passado — é assim que o
 * banco real o guarda; quem decide é a data, não o campo.
 */
function buildTeamInvitations(): TableRow<"team_invitations">[] {
  const future = new Date();
  future.setDate(future.getDate() + 7);
  const past = new Date();
  past.setDate(past.getDate() - 3);

  const base = { created_at: NOW_ISO, updated_at: NOW_ISO };

  return [
    {
      ...base,
      id: "0e0f0a01-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_ID,
      email: "novo.barbeiro@barbearia.teste",
      role: "barbeiro",
      status: "pending",
      token: "mock-invite-pendente-a",
      expires_at: future.toISOString(),
      invited_by: MOCK_USER_IDS.admin,
    },
    {
      ...base,
      id: "0e0f0a01-0000-4000-8000-000000000002",
      barbershop_id: MOCK_BARBERSHOP_ID,
      email: "ana@barbearia.teste",
      role: "barbeiro",
      status: "accepted",
      token: "mock-invite-aceito-a",
      expires_at: future.toISOString(),
      invited_by: MOCK_USER_IDS.admin,
    },
    {
      // Pendente no campo, mas vencido pela data.
      ...base,
      id: "0e0f0a01-0000-4000-8000-000000000003",
      barbershop_id: MOCK_BARBERSHOP_ID,
      email: "expirado@barbearia.teste",
      role: "barbeiro",
      status: "pending",
      token: "mock-invite-expirado-a",
      expires_at: past.toISOString(),
      invited_by: MOCK_USER_IDS.admin,
    },
    {
      ...base,
      id: "0e0f0a01-0000-4000-8000-000000000004",
      barbershop_id: MOCK_BARBERSHOP_ID,
      email: "cancelado@barbearia.teste",
      role: "admin_barbearia",
      status: "cancelled",
      token: "mock-invite-cancelado-a",
      expires_at: future.toISOString(),
      invited_by: MOCK_USER_IDS.admin,
    },
    {
      // Convite nominal para uma conta fictícia existente: é o único que
      // pode de fato ser aceito, já que o aceite exige email da sessão.
      ...base,
      id: "0e0f0a01-0000-4000-8000-000000000005",
      barbershop_id: MOCK_BARBERSHOP_ID,
      email: MOCK_CLIENT_BENTO_EMAIL,
      role: "barbeiro",
      status: "pending",
      token: "mock-invite-para-bento",
      expires_at: future.toISOString(),
      invited_by: MOCK_USER_IDS.admin,
    },
    {
      ...base,
      id: "0e0f0a02-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      email: "novo.barbeiro@navalha.teste",
      role: "barbeiro",
      status: "pending",
      token: "mock-invite-pendente-b",
      expires_at: future.toISOString(),
      invited_by: MOCK_USER_IDS.adminBeatriz,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Planos                                                              */
/* ------------------------------------------------------------------ */

function buildPlans(): TableRow<"plans">[] {
  const base = { created_at: NOW_ISO, updated_at: NOW_ISO };
  return [
    {
      ...base,
      id: MOCK_PLAN_IDS.free,
      name: "free",
      price: 0,
      appointment_limit: 50,
      barber_limit: 1,
      has_subscriptions: false,
    },
    {
      ...base,
      id: MOCK_PLAN_IDS.pro,
      name: "pro",
      price: 79.9,
      appointment_limit: null,
      barber_limit: 5,
      has_subscriptions: true,
    },
    {
      ...base,
      id: MOCK_PLAN_IDS.enterprise,
      name: "enterprise",
      price: 199.9,
      appointment_limit: null,
      barber_limit: null,
      has_subscriptions: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Produtos — o schema tem stock_quantity, mas o app não dá baixa      */
/* ------------------------------------------------------------------ */

export const MOCK_PRODUCT_IDS = {
  pomadaA: "0f0f0f01-0000-4000-8000-000000000001",
  oleoA: "0f0f0f01-0000-4000-8000-000000000002",
  shampooA: "0f0f0f01-0000-4000-8000-000000000003",
  cremeAInativo: "0f0f0f01-0000-4000-8000-000000000004",
  pomadaB: "0f0f0f02-0000-4000-8000-000000000001",
  oleoBInativo: "0f0f0f02-0000-4000-8000-000000000002",
} as const;

function buildProducts(): TableRow<"products">[] {
  const base = { image_url: null, created_at: NOW_ISO, updated_at: NOW_ISO };

  return [
    {
      ...base,
      id: MOCK_PRODUCT_IDS.pomadaA,
      barbershop_id: MOCK_BARBERSHOP_ID,
      name: "Pomada modeladora",
      description: "Fixação forte, acabamento matte.",
      price: 45,
      stock_quantity: 12,
      active: true,
    },
    {
      ...base,
      id: MOCK_PRODUCT_IDS.oleoA,
      barbershop_id: MOCK_BARBERSHOP_ID,
      name: "Óleo para barba",
      description: "Hidratação diária.",
      price: 35,
      stock_quantity: 5,
      active: true,
    },
    {
      // Estoque zerado: CloseTicketDialog desabilita a opção "(sem estoque)".
      ...base,
      id: MOCK_PRODUCT_IDS.shampooA,
      barbershop_id: MOCK_BARBERSHOP_ID,
      name: "Shampoo anticaspa",
      description: "Frasco 250ml.",
      price: 30,
      stock_quantity: 0,
      active: true,
    },
    {
      ...base,
      id: MOCK_PRODUCT_IDS.cremeAInativo,
      barbershop_id: MOCK_BARBERSHOP_ID,
      name: "Creme de barbear (descontinuado)",
      description: null,
      price: 25,
      stock_quantity: 3,
      active: false,
    },
    {
      ...base,
      id: MOCK_PRODUCT_IDS.pomadaB,
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      name: "Pomada premium",
      description: "Linha exclusiva da casa.",
      price: 60,
      stock_quantity: 8,
      active: true,
    },
    {
      ...base,
      id: MOCK_PRODUCT_IDS.oleoBInativo,
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      name: "Óleo importado (fora de linha)",
      description: null,
      price: 90,
      stock_quantity: 0,
      active: false,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Formas de pagamento                                                 */
/* ------------------------------------------------------------------ */

export const MOCK_PAYMENT_METHOD_IDS = {
  dinheiroA: "0a0b0c01-0000-4000-8000-000000000001",
  pixA: "0a0b0c01-0000-4000-8000-000000000002",
  creditoA: "0a0b0c01-0000-4000-8000-000000000003",
  debitoAInativo: "0a0b0c01-0000-4000-8000-000000000004",
  dinheiroB: "0a0b0c02-0000-4000-8000-000000000001",
  pixB: "0a0b0c02-0000-4000-8000-000000000002",
} as const;

function buildPaymentMethods(): TableRow<"payment_methods">[] {
  const base = { created_at: NOW_ISO, updated_at: NOW_ISO };

  return [
    { ...base, id: MOCK_PAYMENT_METHOD_IDS.dinheiroA, barbershop_id: MOCK_BARBERSHOP_ID, name: "Dinheiro", sort_order: 1, active: true },
    { ...base, id: MOCK_PAYMENT_METHOD_IDS.pixA, barbershop_id: MOCK_BARBERSHOP_ID, name: "Pix", sort_order: 2, active: true },
    { ...base, id: MOCK_PAYMENT_METHOD_IDS.creditoA, barbershop_id: MOCK_BARBERSHOP_ID, name: "Cartão de crédito", sort_order: 3, active: true },
    { ...base, id: MOCK_PAYMENT_METHOD_IDS.debitoAInativo, barbershop_id: MOCK_BARBERSHOP_ID, name: "Cartão de débito (desativado)", sort_order: 4, active: false },
    { ...base, id: MOCK_PAYMENT_METHOD_IDS.dinheiroB, barbershop_id: MOCK_BARBERSHOP_B_ID, name: "Dinheiro", sort_order: 1, active: true },
    { ...base, id: MOCK_PAYMENT_METHOD_IDS.pixB, barbershop_id: MOCK_BARBERSHOP_B_ID, name: "Pix", sort_order: 2, active: true },
  ];
}

/* ------------------------------------------------------------------ */
/* Notas internas e bloqueios de cliente                               */
/* ------------------------------------------------------------------ */

function buildClientNotes(): TableRow<"client_notes">[] {
  const base = { created_at: NOW_ISO, updated_at: NOW_ISO, updated_by: null };

  return [
    {
      ...base,
      id: "0b0c0d01-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: MOCK_USER_IDS.clienteCarla,
      note: "Prefere máquina 2 nas laterais. (nota fictícia)",
      pinned: true,
      created_by: MOCK_USER_IDS.admin,
    },
    {
      ...base,
      id: "0b0c0d01-0000-4000-8000-000000000002",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: MOCK_USER_IDS.clienteCarla,
      note: "Costuma remarcar em cima da hora. (nota fictícia)",
      pinned: false,
      created_by: MOCK_USER_IDS.barberAna,
    },
    {
      ...base,
      id: "0b0c0d01-0000-4000-8000-000000000003",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: MOCK_USER_IDS.clienteCaio,
      note: "Alergia a produtos com álcool. (nota fictícia)",
      pinned: true,
      created_by: MOCK_USER_IDS.barberBruno,
    },
    {
      ...base,
      id: "0b0c0d02-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      client_id: MOCK_USER_IDS.clienteBento,
      note: "Cliente da Barbearia B. (nota fictícia)",
      pinned: false,
      created_by: MOCK_USER_IDS.adminBeatriz,
    },
  ];
}

/** Um bloqueio vigente e um já expirado, para exercitar o filtro por data. */
function buildClientBlocks(): TableRow<"client_blocks">[] {
  const future = new Date();
  future.setDate(future.getDate() + 10);
  const past = new Date();
  past.setDate(past.getDate() - 10);

  const base = { created_at: NOW_ISO, updated_at: NOW_ISO };

  return [
    {
      ...base,
      id: "0c0d0e01-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: MOCK_USER_IDS.clienteCaio,
      blocked_until: future.toISOString(),
      reason: "Faltas seguidas. (bloqueio fictício vigente)",
      blocked_by: MOCK_USER_IDS.admin,
    },
    {
      ...base,
      id: "0c0d0e01-0000-4000-8000-000000000002",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: MOCK_USER_IDS.clienteDiego,
      blocked_until: past.toISOString(),
      reason: "Bloqueio fictício já expirado.",
      blocked_by: MOCK_USER_IDS.admin,
    },
    {
      ...base,
      id: "0c0d0e02-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_B_ID,
      client_id: MOCK_USER_IDS.clienteBruna,
      blocked_until: future.toISOString(),
      reason: "Bloqueio fictício vigente da Barbearia B.",
      blocked_by: MOCK_USER_IDS.adminBeatriz,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Comandas                                                            */
/* ------------------------------------------------------------------ */

interface TicketBundle {
  tickets: TableRow<"tickets">[];
  items: TableRow<"ticket_items">[];
  payments: TableRow<"ticket_payments">[];
}

/**
 * Abre comanda para uma fração dos agendamentos concluídos.
 *
 * O schema não tem coluna de status (`closed_at` é obrigatório), então
 * "aberta" aqui significa comanda sem pagamento registrado — exatamente o
 * estado que BarberDashboard rotula como `open`. O ciclo de três cobre:
 *   0 → pagamento integral em um método;
 *   1 → pagamento dividido entre dois métodos;
 *   2 → sem pagamento (comanda aberta).
 *
 * Uma a cada quatro leva também um item de produto, fazendo o total divergir
 * do preço do serviço — o caso que BarberReports trata ao preferir o total
 * da comanda.
 */
function buildTickets(
  appointments: TableRow<"appointments">[],
  services: TableRow<"services">[],
  products: TableRow<"products">[],
  methods: TableRow<"payment_methods">[],
): TicketBundle {
  const tickets: TableRow<"tickets">[] = [];
  const items: TableRow<"ticket_items">[] = [];
  const payments: TableRow<"ticket_payments">[] = [];

  const completed = appointments.filter((item) => item.status === "completed");
  let index = 0;

  const pad = (value: number) => String(value).padStart(12, "0");

  for (let position = 0; position < completed.length; position += 3) {
    const appointment = completed[position];
    const service = services.find((item) => item.id === appointment.service_id);
    if (!service) continue;

    index += 1;
    const ticketId = `0d0d0d01-0000-4000-8000-${pad(index)}`;
    const shopId = appointment.barbershop_id;

    /* ---- itens ---- */
    const ticketItems: TableRow<"ticket_items">[] = [
      {
        id: `0d0e0f01-0000-4000-8000-${pad(index * 2 - 1)}`,
        ticket_id: ticketId,
        barbershop_id: shopId,
        item_type: "service",
        service_id: service.id,
        product_id: null,
        description: service.name,
        unit_price: service.price,
        quantity: 1,
        total: service.price,
        created_at: NOW_ISO,
      },
    ];

    if (index % 4 === 0) {
      const product = products.find((item) => item.barbershop_id === shopId && item.active);
      if (product) {
        ticketItems.push({
          id: `0d0e0f01-0000-4000-8000-${pad(index * 2)}`,
          ticket_id: ticketId,
          barbershop_id: shopId,
          item_type: "product",
          service_id: null,
          product_id: product.id,
          description: product.name,
          unit_price: product.price,
          quantity: 2,
          total: product.price * 2,
          created_at: NOW_ISO,
        });
      }
    }

    /* ---- totais: subtotal = soma dos itens ---- */
    const subtotal = ticketItems.reduce((sum, item) => sum + item.total, 0);
    // Uma a cada cinco recebe R$ 10 de desconto.
    const discount = index % 5 === 0 ? 10 : 0;
    const total = Math.max(0, subtotal - discount);

    tickets.push({
      id: ticketId,
      barbershop_id: shopId,
      appointment_id: appointment.id,
      barber_id: appointment.barber_id,
      client_id: appointment.client_id,
      subtotal,
      discount_amount: discount,
      discount_type: "value",
      total,
      notes: null,
      closed_at: NOW_ISO,
      closed_by: appointment.barber_id,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    });
    items.push(...ticketItems);

    /* ---- pagamentos ---- */
    const shopMethods = methods.filter((item) => item.barbershop_id === shopId && item.active);
    const mode = index % 3;

    if (mode === 0 && shopMethods.length > 0) {
      payments.push({
        id: `0e0e0e01-0000-4000-8000-${pad(index * 2 - 1)}`,
        ticket_id: ticketId,
        barbershop_id: shopId,
        payment_method_id: shopMethods[0].id,
        method_name: shopMethods[0].name,
        amount: total,
        created_at: NOW_ISO,
      });
    } else if (mode === 1 && shopMethods.length > 1) {
      // Divide em duas parcelas; a segunda absorve o arredondamento.
      const first = Math.round((total / 2) * 100) / 100;
      const second = Math.round((total - first) * 100) / 100;

      payments.push(
        {
          id: `0e0e0e01-0000-4000-8000-${pad(index * 2 - 1)}`,
          ticket_id: ticketId,
          barbershop_id: shopId,
          payment_method_id: shopMethods[0].id,
          method_name: shopMethods[0].name,
          amount: first,
          created_at: NOW_ISO,
        },
        {
          id: `0e0e0e01-0000-4000-8000-${pad(index * 2)}`,
          ticket_id: ticketId,
          barbershop_id: shopId,
          payment_method_id: shopMethods[1].id,
          method_name: shopMethods[1].name,
          amount: second,
          created_at: NOW_ISO,
        },
      );
    }
    // mode === 2: nenhuma linha de pagamento → comanda aberta.
  }

  return { tickets, items, payments };
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

/** Gera um snapshot novo dos dados fictícios. Sempre retorna objetos novos. */
export function buildSeedDatabase(): MockDatabase {
  const weekly = buildWeeklySchedule();
  const blocks = buildScheduleBlocks();
  const services = buildServices();
  const appointments = buildAppointments(weekly, blocks, services);
  const products = buildProducts();
  const paymentMethods = buildPaymentMethods();
  const { tickets, items, payments } = buildTickets(
    appointments,
    services,
    products,
    paymentMethods,
  );

  return {
    barbershops: buildBarbershops(),
    profiles: buildProfiles(),
    user_roles: buildUserRoles(),
    plans: buildPlans(),
    services,
    weekly_schedule: weekly,
    schedule_blocks: blocks,
    appointments,
    availability: buildAvailability(weekly, blocks, appointments),
    reviews: buildReviews(),
    products,
    payment_methods: paymentMethods,
    tickets,
    ticket_items: items,
    ticket_payments: payments,
    client_notes: buildClientNotes(),
    client_blocks: buildClientBlocks(),
    team_invitations: buildTeamInvitations(),
  };
}

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
  // Barbearia B
  adminBeatriz: "55555555-5555-4555-8555-555555555555",
  barberBianca: "66666666-6666-4666-8666-666666666666",
  barberBreno: "77777777-7777-4777-8777-777777777777",
  clienteBento: "88888888-8888-4888-8888-888888888888",
} as const;

export const MOCK_ADMIN_EMAIL = "admin@barbearia.teste";
export const MOCK_ADMIN_B_EMAIL = "beatriz@navalha.teste";

const SERVICE_IDS = {
  // Barbearia A
  corte: "aaaaaaa1-0000-4000-8000-000000000001",
  barba: "aaaaaaa1-0000-4000-8000-000000000002",
  combo: "aaaaaaa1-0000-4000-8000-000000000003",
  pezinho: "aaaaaaa1-0000-4000-8000-000000000004",
  platinado: "aaaaaaa1-0000-4000-8000-000000000005",
  // Barbearia B
  corteB: "aaaaaaa2-0000-4000-8000-000000000001",
  barbaB: "aaaaaaa2-0000-4000-8000-000000000002",
  comboB: "aaaaaaa2-0000-4000-8000-000000000003",
} as const;

export const MOCK_SERVICE_IDS = SERVICE_IDS;

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
    plan_id: null,
    timezone: "America/Sao_Paulo",
    logo_url: null,
    complement: null,
    appointments_this_month: 3,
    cancel_min_hours: 2,
    reschedule_min_hours: 2,
    noshow_policy_enabled: false,
    noshow_block_days: 7,
    noshow_max_count: 3,
    pdf_slogan: null,
    pdf_template: null,
    qr_size: null,
    receipt_footer: null,
    receipt_subtitle: null,
    receipt_thank_you_message: null,
    receipt_title: null,
    receipt_whatsapp_intro: null,
    whatsapp_message: null,
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
  phone: string;
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
  // Barbearia A
  { userId: MOCK_USER_IDS.admin, barbershopId: MOCK_BARBERSHOP_ID, role: "admin_barbearia" },
  { userId: MOCK_USER_IDS.barberAna, barbershopId: MOCK_BARBERSHOP_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.barberBruno, barbershopId: MOCK_BARBERSHOP_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.clienteCarla, barbershopId: MOCK_BARBERSHOP_ID, role: "cliente" },
  { userId: MOCK_USER_IDS.clienteCaio, barbershopId: MOCK_BARBERSHOP_ID, role: "cliente" },
  // Barbearia B
  { userId: MOCK_USER_IDS.adminBeatriz, barbershopId: MOCK_BARBERSHOP_B_ID, role: "admin_barbearia" },
  { userId: MOCK_USER_IDS.barberBianca, barbershopId: MOCK_BARBERSHOP_B_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.barberBreno, barbershopId: MOCK_BARBERSHOP_B_ID, role: "barbeiro" },
  { userId: MOCK_USER_IDS.clienteBento, barbershopId: MOCK_BARBERSHOP_B_ID, role: "cliente" },
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
  // Barbearia A — Ana atende de segunda a sexta; Bruno inclui sábado.
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

interface AppointmentSeed {
  id: string;
  barbershopId: string;
  barberId: string;
  clientId: string;
  serviceId: string;
  dayOffset: number;
  start: string;
  durationMinutes: number;
  status: Database["public"]["Enums"]["appointment_status"];
  notes?: string;
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

function buildAppointments(): TableRow<"appointments">[] {
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
/* Seed                                                                */
/* ------------------------------------------------------------------ */

/** Gera um snapshot novo dos dados fictícios. Sempre retorna objetos novos. */
export function buildSeedDatabase(): MockDatabase {
  const weekly = buildWeeklySchedule();
  const blocks = buildScheduleBlocks();
  const appointments = buildAppointments();

  return {
    barbershops: buildBarbershops(),
    profiles: buildProfiles(),
    user_roles: buildUserRoles(),
    services: buildServices(),
    weekly_schedule: weekly,
    schedule_blocks: blocks,
    appointments,
    availability: buildAvailability(weekly, blocks, appointments),
    reviews: buildReviews(),
  };
}

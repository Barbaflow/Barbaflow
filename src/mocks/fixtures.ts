/**
 * Dados fictícios do modo offline (VITE_DATA_SOURCE=mock).
 *
 * Tudo aqui é inventado: nenhuma URL, id ou chave real do Supabase.
 * Os tipos vêm de src/integrations/supabase/types.ts, então o formato
 * acompanha o schema real sem precisar de banco.
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

export const MOCK_BARBERSHOP_ID = DEFAULT_BARBERSHOP_ID;

export const MOCK_USER_IDS = {
  admin: "11111111-1111-4111-8111-111111111111",
  barberAna: "22222222-2222-4222-8222-222222222222",
  barberBruno: "33333333-3333-4333-8333-333333333333",
  clienteCarla: "44444444-4444-4444-8444-444444444444",
} as const;

export const MOCK_ADMIN_EMAIL = "admin@barbearia.teste";

const SERVICE_IDS = {
  corte: "aaaaaaa1-0000-4000-8000-000000000001",
  barba: "aaaaaaa1-0000-4000-8000-000000000002",
  combo: "aaaaaaa1-0000-4000-8000-000000000003",
  pezinho: "aaaaaaa1-0000-4000-8000-000000000004",
} as const;

/* ------------------------------------------------------------------ */
/* Helpers de data                                                     */
/* ------------------------------------------------------------------ */

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const NOW_ISO = new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

function buildBarbershops(): TableRow<"barbershops">[] {
  return [
    {
      id: MOCK_BARBERSHOP_ID,
      name: "Barbearia Modelo (offline)",
      subdomain: "modelo",
      status: "approved",
      owner_id: MOCK_USER_IDS.admin,
      plan_id: null,
      timezone: "America/Sao_Paulo",
      primary_color: "#C8A96E",
      secondary_color: "#1A1A1A",
      logo_url: null,
      cep: "01310-100",
      street: "Avenida Paulista",
      number: "1000",
      complement: null,
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      appointments_this_month: 3,
      cancel_min_hours: 2,
      reschedule_min_hours: 2,
      noshow_policy_enabled: false,
      noshow_block_days: 7,
      noshow_max_count: 3,
      rating_avg: 4.8,
      rating_count: 12,
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
    },
  ];
}

function buildProfiles(): TableRow<"profiles">[] {
  return [
    {
      id: "bbbbbbb1-0000-4000-8000-000000000001",
      user_id: MOCK_USER_IDS.admin,
      full_name: "Alex Admin",
      phone: "+5511900000001",
      avatar_url: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: "bbbbbbb1-0000-4000-8000-000000000002",
      user_id: MOCK_USER_IDS.barberAna,
      full_name: "Ana Tesoura",
      phone: "+5511900000002",
      avatar_url: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: "bbbbbbb1-0000-4000-8000-000000000003",
      user_id: MOCK_USER_IDS.barberBruno,
      full_name: "Bruno Navalha",
      phone: "+5511900000003",
      avatar_url: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: "bbbbbbb1-0000-4000-8000-000000000004",
      user_id: MOCK_USER_IDS.clienteCarla,
      full_name: "Carla Cliente",
      phone: "+5511900000004",
      avatar_url: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
  ];
}

function buildUserRoles(): TableRow<"user_roles">[] {
  return [
    {
      id: "ccccccc1-0000-4000-8000-000000000001",
      user_id: MOCK_USER_IDS.admin,
      barbershop_id: MOCK_BARBERSHOP_ID,
      role: "admin_barbearia",
      created_at: NOW_ISO,
    },
    {
      id: "ccccccc1-0000-4000-8000-000000000002",
      user_id: MOCK_USER_IDS.barberAna,
      barbershop_id: MOCK_BARBERSHOP_ID,
      role: "barbeiro",
      created_at: NOW_ISO,
    },
    {
      id: "ccccccc1-0000-4000-8000-000000000003",
      user_id: MOCK_USER_IDS.barberBruno,
      barbershop_id: MOCK_BARBERSHOP_ID,
      role: "barbeiro",
      created_at: NOW_ISO,
    },
    {
      id: "ccccccc1-0000-4000-8000-000000000004",
      user_id: MOCK_USER_IDS.clienteCarla,
      barbershop_id: MOCK_BARBERSHOP_ID,
      role: "cliente",
      created_at: NOW_ISO,
    },
  ];
}

function buildServices(): TableRow<"services">[] {
  return [
    {
      id: SERVICE_IDS.corte,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      name: "Corte masculino",
      price: 60,
      duration_minutes: 40,
      active: true,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: SERVICE_IDS.barba,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      name: "Barba",
      price: 40,
      duration_minutes: 30,
      active: true,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: SERVICE_IDS.combo,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberBruno,
      name: "Corte + Barba",
      price: 90,
      duration_minutes: 60,
      active: true,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: SERVICE_IDS.pezinho,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberBruno,
      name: "Pezinho",
      price: 25,
      duration_minutes: 15,
      active: false,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
  ];
}

function buildAppointments(): TableRow<"appointments">[] {
  return [
    {
      id: "ddddddd1-0000-4000-8000-000000000001",
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      client_id: MOCK_USER_IDS.clienteCarla,
      service_id: SERVICE_IDS.corte,
      date: isoDateOffset(0),
      start_time: "10:00:00",
      end_time: "10:40:00",
      status: "scheduled",
      notes: "Agendamento fictício de hoje.",
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: "ddddddd1-0000-4000-8000-000000000002",
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberBruno,
      client_id: MOCK_USER_IDS.clienteCarla,
      service_id: SERVICE_IDS.combo,
      date: isoDateOffset(1),
      start_time: "14:00:00",
      end_time: "15:00:00",
      status: "scheduled",
      notes: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
    {
      id: "ddddddd1-0000-4000-8000-000000000003",
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      client_id: MOCK_USER_IDS.clienteCarla,
      service_id: SERVICE_IDS.barba,
      date: isoDateOffset(-3),
      start_time: "09:00:00",
      end_time: "09:30:00",
      status: "completed",
      notes: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    },
  ];
}

/** Gera um snapshot novo dos dados fictícios. Sempre retorna objetos novos. */
export function buildSeedDatabase(): MockDatabase {
  return {
    barbershops: buildBarbershops(),
    profiles: buildProfiles(),
    user_roles: buildUserRoles(),
    services: buildServices(),
    appointments: buildAppointments(),
  };
}

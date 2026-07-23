/**
 * Núcleo compartilhado do seed de teste do BarbaFlow.
 *
 * Reúne, num só lugar, o que o seed e o cleanup NÃO podem divergir:
 *   - a leitura e validação de variáveis de ambiente;
 *   - a trava de ambiente (recusa projeto diferente do autorizado, exige
 *     confirmação explícita — nunca escolhe o ambiente em silêncio);
 *   - o cliente administrativo (persistSession/autoRefreshToken desligados);
 *   - a definição determinística de TODOS os dados de teste (emails, slugs,
 *     UUIDs), que é o que torna as duas operações idempotentes e reversíveis.
 *
 * Este módulo roda SÓ em Node (servidor). Ele nunca deve ser importado por
 * código do frontend: usa a chave secreta/service_role, que bypassa RLS.
 * Nada aqui imprime a chave nem a senha.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

/* ─────────────────────────── ambiente / trava ──────────────────────────── */

/** Project ref remoto único autorizado para o BarbaFlow. */
export const ALLOWED_REMOTE_REF = "qfcngyyzyiwotehubifx";

/** Deriva o "ref" alvo a partir da URL. `*.supabase.co` → subdomínio; local → "local". */
export function refFromUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`SUPABASE_URL inválida: ${url}`);
  }
  if (host === "127.0.0.1" || host === "localhost" || host.endsWith(".local")) {
    return "local";
  }
  const m = host.match(/^([a-z0-9-]+)\.supabase\.(co|in|red)$/i);
  if (m) return m[1].toLowerCase();
  // Qualquer outro host: devolve o host inteiro para forçar recusa explícita.
  return host.toLowerCase();
}

/**
 * Lê o ambiente, valida tudo e devolve a configuração — ou lança com uma
 * mensagem clara. `confirmVar` é o nome da variável de confirmação exigida
 * (SEED_CONFIRM_PROJECT_REF), e `allowVar` a trava booleana da operação.
 */
export function loadConfig({ allowVar }) {
  const url = requireEnv("SUPABASE_URL");
  // Preferência à Secret key nova (sb_secret_...); service_role legado é fallback
  // opcional. A chave é passada CRUA ao supabase-js — sem parse, sem decode, sem
  // exigir prefixo "eyJ", sem tratar como JWT, sem montar Authorization à mão.
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const key = secret || legacy || "";
  const keySource = secret ? "SUPABASE_SECRET_KEY" : legacy ? "SUPABASE_SERVICE_ROLE_KEY" : null;
  if (!key) {
    throw new Error(
      "Defina SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY (chave administrativa de servidor).",
    );
  }
  const password = requireEnv("SEED_TEST_PASSWORD");

  if (process.env[allowVar] !== "true") {
    throw new Error(`Trava de segurança: exporte ${allowVar}=true para prosseguir.`);
  }

  const targetRef = refFromUrl(url);

  // Recusa qualquer projeto remoto que não seja o autorizado.
  if (targetRef !== "local" && targetRef !== ALLOWED_REMOTE_REF) {
    throw new Error(
      `Projeto NÃO autorizado: "${targetRef}". ` +
        `Este seed só opera em "${ALLOWED_REMOTE_REF}" (remoto) ou "local".`,
    );
  }

  // Confirmação explícita do alvo: precisa nomear exatamente o ref derivado.
  const confirm = process.env.SEED_CONFIRM_PROJECT_REF?.trim();
  if (confirm !== targetRef) {
    throw new Error(
      `Confirmação de projeto ausente ou divergente. ` +
        `Alvo derivado de SUPABASE_URL: "${targetRef}". ` +
        `Exporte SEED_CONFIRM_PROJECT_REF="${targetRef}" para confirmar.`,
    );
  }

  return { url, key, password, targetRef, keySource };
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

/**
 * Cliente administrativo. A chave (Secret key nova `sb_secret_...` ou
 * service_role legado) vai CRUA ao supabase-js, que a envia como `apikey`/
 * `Authorization` internamente — não montamos cabeçalho manual nem tratamos a
 * chave como JWT. Sem persistência/refresh de sessão e sem detecção de sessão
 * na URL: é um cliente de servidor puro, nunca uma sessão de usuário.
 */
export function makeAdminClient({ url, key }) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/* ──────────────────────── UUID determinístico (v5) ─────────────────────── */

/** UUID estável derivado de um nome fixo — mesma entrada, mesmo UUID, sempre. */
export function detUuid(name) {
  const b = Buffer.from(createHash("sha1").update(`barbaflow-seed:${name}`).digest().subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // versão 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/* ─────────────────────────── definição dos dados ──────────────────────── */

const MARK = "[SEED TESTE]";

/** Serviços por barbearia (4). O app filtra serviços por barbershop_id, não por
 *  barbeiro — `services.barber_id` só registra o dono da linha. `barberIdx`
 *  aponta para o barbeiro da barbearia que "possui" cada serviço. */
export const SERVICES = [
  { key: "corte", name: "Corte tradicional", duration: 30, price: 35, barberIdx: 0 },
  { key: "barba", name: "Barba", duration: 30, price: 25, barberIdx: 0 },
  { key: "cortebarba", name: "Corte e barba", duration: 60, price: 55, barberIdx: 1 },
  { key: "acabamento", name: "Acabamento", duration: 15, price: 15, barberIdx: 2 },
];

/** Produtos por barbearia (4). O Balm fica com estoque baixo (3) de propósito. */
export const PRODUCTS = [
  { key: "pomada", name: "Pomada modeladora", stock: 20, price: 35 },
  { key: "oleo", name: "Óleo para barba", stock: 15, price: 30 },
  { key: "shampoo", name: "Shampoo masculino", stock: 12, price: 28 },
  { key: "balm", name: "Balm para barba", stock: 3, price: 32 },
];

/** Duas barbearias. `slug` é a coluna real `subdomain` (UNIQUE). */
export const SHOPS = [
  {
    key: "central",
    name: `Barbearia Central Teste ${MARK}`,
    subdomain: "barbearia-central-teste",
    admin: { email: "admin.central@barbaflow.test", name: `Admin Central ${MARK}`, phone: "+55 11 90000-0001" },
    barbers: [
      { email: "barbeiro1.central@barbaflow.test", name: `Barbeiro 1 Central ${MARK}`, phone: "+55 11 90000-0002" },
      { email: "barbeiro2.central@barbaflow.test", name: `Barbeiro 2 Central ${MARK}`, phone: "+55 11 90000-0003" },
      { email: "barbeiro3.central@barbaflow.test", name: `Barbeiro 3 Central ${MARK}`, phone: "+55 11 90000-0004" },
    ],
    address: { street: "Rua de Teste", number: "100", neighborhood: "Centro", city: "São Paulo", state: "SP", cep: "01000-000" },
    // Barbearia 1 mantém todos os serviços ativos.
    disabledService: null,
  },
  {
    key: "vilanova",
    name: `Barbearia Vila Nova Teste ${MARK}`,
    subdomain: "barbearia-vila-nova-teste",
    admin: { email: "admin.vilanova@barbaflow.test", name: `Admin Vila Nova ${MARK}`, phone: "+55 11 90000-0101" },
    barbers: [
      { email: "barbeiro1.vilanova@barbaflow.test", name: `Barbeiro 1 Vila Nova ${MARK}`, phone: "+55 11 90000-0102" },
      { email: "barbeiro2.vilanova@barbaflow.test", name: `Barbeiro 2 Vila Nova ${MARK}`, phone: "+55 11 90000-0103" },
      { email: "barbeiro3.vilanova@barbaflow.test", name: `Barbeiro 3 Vila Nova ${MARK}`, phone: "+55 11 90000-0104" },
    ],
    address: { street: "Avenida de Teste", number: "200", neighborhood: "Vila Nova", city: "São Paulo", state: "SP", cep: "02000-000" },
    // Barbearia 2 deixa "Acabamento" DESATIVADO para testar o filtro público.
    disabledService: "acabamento",
  },
];

/** Três clientes de teste. */
export const CLIENTS = [
  { email: "cliente1@barbaflow.test", name: `Cliente 1 ${MARK}`, phone: "+55 11 91111-1111" },
  { email: "cliente2@barbaflow.test", name: `Cliente 2 ${MARK}`, phone: "+55 11 92222-2222" },
  { email: "cliente3@barbaflow.test", name: `Cliente 3 ${MARK}`, phone: "+55 11 93333-3333" },
];

/** Grade semanal de cada barbeiro. day_of_week: 0=domingo … 6=sábado (EXTRACT(DOW)).
 *  Seg–Sex: 09–12 e 13–18. Sáb: 09–14. Dom: inativo (sem linha). */
export const WEEKLY_SCHEDULE = [
  ...[1, 2, 3, 4, 5].flatMap((d) => [
    { day_of_week: d, start_time: "09:00:00", end_time: "12:00:00" },
    { day_of_week: d, start_time: "13:00:00", end_time: "18:00:00" },
  ]),
  { day_of_week: 6, start_time: "09:00:00", end_time: "14:00:00" },
];

/**
 * Nove agendamentos, definidos por deslocamento em DIAS ÚTEIS a partir de hoje
 * (negativo = passado). Tempos sempre dentro das janelas seg–sex, sem
 * sobreposição por barbeiro. `barberIdx`/`clientIdx` indexam os arrays da
 * barbearia e CLIENTS. Cliente 1 (idx 0) aparece nas duas barbearias.
 */
export const APPOINTMENTS = [
  // Barbearia Central
  { key: "c1", shop: "central", clientIdx: 0, barberIdx: 0, service: "corte", offset: 3, start: "09:00", status: "scheduled" },
  { key: "c2", shop: "central", clientIdx: 1, barberIdx: 1, service: "cortebarba", offset: 4, start: "10:00", status: "scheduled" },
  { key: "c3", shop: "central", clientIdx: 2, barberIdx: 2, service: "barba", offset: 5, start: "13:00", status: "scheduled" },
  { key: "c4", shop: "central", clientIdx: 0, barberIdx: 0, service: "corte", offset: -7, start: "09:00", status: "completed" },
  { key: "c5", shop: "central", clientIdx: 1, barberIdx: 1, service: "acabamento", offset: -10, start: "14:00", status: "completed" },
  { key: "c6", shop: "central", clientIdx: 2, barberIdx: 0, service: "barba", offset: 6, start: "15:00", status: "cancelled" },
  // Barbearia Vila Nova
  { key: "v1", shop: "vilanova", clientIdx: 0, barberIdx: 0, service: "corte", offset: 3, start: "09:00", status: "scheduled" },
  { key: "v2", shop: "vilanova", clientIdx: 1, barberIdx: 1, service: "cortebarba", offset: -5, start: "10:00", status: "completed" },
  { key: "v3", shop: "vilanova", clientIdx: 2, barberIdx: 0, service: "barba", offset: -3, start: "11:00", status: "no_show" },
];

/**
 * Um bloqueio de DUAS HORAS por barbearia, no futuro. Modelado como janela
 * `availability` status 'folga' — que é como o app representa um bloqueio
 * PARCIAL de dia (schedule_blocks é dia inteiro, sem hora). Cai num barbeiro/dia
 * sem agendamento, dentro da janela 13–18, nunca no passado.
 */
export const AVAIL_BLOCKS = [
  { key: "blk-central", shop: "central", barberIdx: 2, offset: 8, start: "14:00:00", end: "16:00:00" },
  { key: "blk-vilanova", shop: "vilanova", barberIdx: 2, offset: 8, start: "14:00:00", end: "16:00:00" },
];

/** Avatar placeholder determinístico (apenas texto/URL, sem rede no seed). */
export function placeholderAvatar(label) {
  return `https://placehold.co/128x128/EEE/31343C?text=${encodeURIComponent(label)}`;
}

/* ────────────────────── helpers de data e horário ─────────────────────── */

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Data (YYYY-MM-DD) a `offset` DIAS ÚTEIS de hoje, pulando sáb/dom na direção do sinal. */
export function weekdayDate(offset) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // meio-dia local evita bordas de fuso/DST
  d.setDate(d.getDate() + offset);
  const step = offset >= 0 ? 1 : -1;
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + step);
  return isoDate(d);
}

/** "HH:MM" + minutos → "HH:MM:SS". */
export function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + mins;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}:00`;
}

/** "HH:MM" → "HH:MM:00". */
export const hms = (hhmm) => `${hhmm}:00`;

/* ─────────────────────── usuários (admin API) ─────────────────────────── */

/** Todos os e-mails de teste (para conferência e limpeza). */
export function allTestEmails() {
  const emails = [];
  for (const s of SHOPS) {
    emails.push(s.admin.email, ...s.barbers.map((b) => b.email));
  }
  emails.push(...CLIENTS.map((c) => c.email));
  return emails;
}

/** Mapa email→id de todos os usuários existentes (paginado). */
export async function fetchUserMap(admin) {
  const map = new Map();
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers falhou: ${error.message}`);
    for (const u of data.users) if (u.email) map.set(u.email.toLowerCase(), u.id);
    if (data.users.length < perPage) break;
  }
  return map;
}

/**
 * Seed de teste do BarbaFlow — poucos dados, cobrindo os fluxos principais.
 *
 *   ALLOW_TEST_SEED=true SEED_CONFIRM_PROJECT_REF=local \
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... SEED_TEST_PASSWORD=... \
 *   npm run seed:test
 *
 * Idempotente: rodar duas vezes produz exatamente o mesmo estado. Só toca dados
 * marcados como teste (emails @barbaflow.test, slugs -teste, UUIDs derivados).
 * NUNCA imprime a chave nem a senha. Ver .env.seed.example.
 *
 * Não importe este arquivo do frontend: usa a chave administrativa (bypassa RLS).
 */
import {
  loadConfig, makeAdminClient, detUuid,
  SHOPS, CLIENTS, SERVICES, PRODUCTS, WEEKLY_SCHEDULE, APPOINTMENTS, AVAIL_BLOCKS,
  placeholderAvatar, weekdayDate, addMinutes, hms, fetchUserMap,
} from "./seed-barbaflow-lib.mjs";

/* util: falha alto e claro em qualquer erro do supabase-js. */
function ok(res, label) {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

async function main() {
  const cfg = loadConfig({ allowVar: "ALLOW_TEST_SEED" });
  const admin = makeAdminClient(cfg);

  console.log("─────────────────────────────────────────────");
  console.log(" BarbaFlow · seed de teste");
  console.log(` Alvo (project ref): ${cfg.targetRef}`);
  console.log(` URL:                ${cfg.url}`);
  console.log(` Chave admin:        ${cfg.keySource} (valor nunca impresso)`);
  console.log("─────────────────────────────────────────────");

  // Plano com ≥3 barbeiros: 'pro' (barber_limit NULL = ilimitado).
  const plan = ok(
    await admin.from("plans").select("id,name").eq("name", "pro").single(),
    "buscar plano pro",
  );

  /* ── contas: reutiliza se já existir, cria se faltar ──────────────────── */
  const userMap = await fetchUserMap(admin); // email(lower) → id
  const ids = new Map(); // email → id (final)

  async function ensureUser(email, fullName) {
    const existing = userMap.get(email.toLowerCase());
    if (existing) {
      ids.set(email, existing);
      return existing;
    }
    const data = ok(
      await admin.auth.admin.createUser({
        email,
        password: cfg.password,
        email_confirm: true, // ambiente de teste: sem envio de e-mail
        user_metadata: { full_name: fullName },
      }),
      `criar usuário ${email}`,
    );
    ids.set(email, data.user.id);
    return data.user.id;
  }

  // Cria/reutiliza todos os usuários primeiro (admins, barbeiros, clientes).
  for (const shop of SHOPS) {
    await ensureUser(shop.admin.email, shop.admin.name);
    for (const b of shop.barbers) await ensureUser(b.email, b.name);
  }
  for (const c of CLIENTS) await ensureUser(c.email, c.name);

  /* ── perfis: nome, telefone e avatar (upsert por user_id) ─────────────── */
  const profileRows = [];
  const pushProfile = (email, name, phone) =>
    profileRows.push({
      user_id: ids.get(email),
      full_name: name,
      phone,
      avatar_url: placeholderAvatar(name.split(" ").slice(0, 2).join(" ")),
    });
  for (const shop of SHOPS) {
    pushProfile(shop.admin.email, shop.admin.name, shop.admin.phone);
    for (const b of shop.barbers) pushProfile(b.email, b.name, b.phone);
  }
  for (const c of CLIENTS) pushProfile(c.email, c.name, c.phone);
  ok(await admin.from("profiles").upsert(profileRows, { onConflict: "user_id" }), "upsert profiles");

  /* ── barbearias, papéis, serviços, produtos, grade, bloqueios ─────────── */
  const shopId = new Map(); // shop.key → uuid

  for (const shop of SHOPS) {
    const adminId = ids.get(shop.admin.email);

    // Barbearia (upsert por subdomain UNIQUE; devolve o id real da linha).
    const row = ok(
      await admin
        .from("barbershops")
        .upsert(
          {
            name: shop.name,
            subdomain: shop.subdomain,
            status: "approved",
            owner_id: adminId,
            plan_id: plan.id,
            timezone: "America/Sao_Paulo",
            cancel_min_hours: 2,
            reschedule_min_hours: 2,
            ...shop.address,
          },
          { onConflict: "subdomain" },
        )
        .select("id")
        .single(),
      `upsert barbearia ${shop.subdomain}`,
    );
    shopId.set(shop.key, row.id);
    const sid = row.id;

    // Papéis: dono = admin_barbearia; três barbeiros = barbeiro.
    const roleRows = [
      { user_id: adminId, barbershop_id: sid, role: "admin_barbearia" },
      ...shop.barbers.map((b) => ({ user_id: ids.get(b.email), barbershop_id: sid, role: "barbeiro" })),
    ];
    ok(
      await admin.from("user_roles").upsert(roleRows, {
        onConflict: "user_id,barbershop_id,role",
        ignoreDuplicates: true,
      }),
      `upsert papéis ${shop.key}`,
    );

    const barberId = (idx) => ids.get(shop.barbers[idx].email);

    // Serviços (4). UUID determinístico → upsert por id. Um fica inativo na
    // Vila Nova para testar o filtro público.
    const serviceRows = SERVICES.map((s) => ({
      id: detUuid(`svc:${shop.key}:${s.key}`),
      barbershop_id: sid,
      barber_id: barberId(s.barberIdx),
      name: s.name,
      duration_minutes: s.duration,
      price: s.price,
      active: shop.disabledService !== s.key,
    }));
    ok(await admin.from("services").upsert(serviceRows, { onConflict: "id" }), `upsert serviços ${shop.key}`);
    const serviceId = (key) => detUuid(`svc:${shop.key}:${key}`);

    // Produtos (4). Sem unique natural → id determinístico.
    const productRows = PRODUCTS.map((p) => ({
      id: detUuid(`prd:${shop.key}:${p.key}`),
      barbershop_id: sid,
      name: p.name,
      description: "[SEED TESTE]",
      price: p.price,
      stock_quantity: p.stock,
      active: true,
    }));
    ok(await admin.from("products").upsert(productRows, { onConflict: "id" }), `upsert produtos ${shop.key}`);

    // Grade semanal dos três barbeiros (upsert pela chave natural).
    const scheduleRows = shop.barbers.flatMap((b) =>
      WEEKLY_SCHEDULE.map((w) => ({
        barbershop_id: sid,
        barber_id: ids.get(b.email),
        day_of_week: w.day_of_week,
        start_time: w.start_time,
        end_time: w.end_time,
        is_active: true,
      })),
    );
    ok(
      await admin.from("weekly_schedule").upsert(scheduleRows, {
        onConflict: "barber_id,barbershop_id,day_of_week,start_time",
        ignoreDuplicates: true,
      }),
      `upsert grade ${shop.key}`,
    );

    // Bloqueio de 2h (availability folga, futuro).
    const blk = AVAIL_BLOCKS.find((x) => x.shop === shop.key);
    if (blk) {
      ok(
        await admin.from("availability").upsert(
          [
            {
              barbershop_id: sid,
              barber_id: barberId(blk.barberIdx),
              date: weekdayDate(blk.offset),
              start_time: blk.start,
              end_time: blk.end,
              status: "folga",
            },
          ],
          {
            onConflict: "barbershop_id,barber_id,date,start_time,end_time,status",
            ignoreDuplicates: true,
          },
        ),
        `upsert bloqueio ${shop.key}`,
      );
    }

    // Guarda resolvedores para os agendamentos.
    shop._sid = sid;
    shop._barberId = barberId;
    shop._serviceId = serviceId;
  }

  /* ── agendamentos (insere se não existir; nunca duplica) ──────────────── */
  const apptRows = APPOINTMENTS.map((a) => {
    const shop = SHOPS.find((s) => s.key === a.shop);
    const svc = SERVICES.find((s) => s.key === a.service);
    return {
      id: detUuid(`appt:${a.key}`),
      barbershop_id: shop._sid,
      client_id: ids.get(CLIENTS[a.clientIdx].email),
      barber_id: shop._barberId(a.barberIdx),
      service_id: shop._serviceId(a.service),
      date: weekdayDate(a.offset),
      start_time: hms(a.start),
      end_time: addMinutes(a.start, svc.duration),
      status: a.status,
      notes: "[SEED TESTE]",
    };
  });
  // Inserimos via service_role: auth.uid() é NULL, então o trigger de transição
  // restrita do cliente não dispara — o status (completed/no_show/cancelled)
  // entra direto. onConflict id + ignoreDuplicates = idempotente e sem duplicar.
  ok(
    await admin.from("appointments").upsert(apptRows, { onConflict: "id", ignoreDuplicates: true }),
    "upsert agendamentos",
  );

  /* ── resumo (contagens reais no banco) ────────────────────────────────── */
  const shopIds = [...shopId.values()];
  const users = profileRows.length;
  const [svcC, prdC, schC, apptC, availC] = await Promise.all([
    countRows(admin, "services", shopIds),
    countRows(admin, "products", shopIds),
    countRows(admin, "weekly_schedule", shopIds),
    countRows(admin, "appointments", shopIds),
    countRows(admin, "availability", shopIds),
  ]);
  const statusBreak = ok(
    await admin.from("appointments").select("status").in("barbershop_id", shopIds),
    "status dos agendamentos",
  );
  const byStatus = statusBreak.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

  console.log("\n── resumo ──────────────────────────────────");
  console.log(` barbearias:      ${shopIds.length}`);
  console.log(` usuários:        ${users} (2 admins, 6 barbeiros, 3 clientes)`);
  console.log(` serviços:        ${svcC} (4 por barbearia; 1 inativo na Vila Nova)`);
  console.log(` produtos:        ${prdC} (Balm com estoque baixo)`);
  console.log(` grade (linhas):  ${schC}`);
  console.log(` bloqueios (2h):  ${availC}`);
  console.log(` agendamentos:    ${apptC}  ${JSON.stringify(byStatus)}`);
  console.log("─────────────────────────────────────────────");
  console.log("OK — seed idempotente concluído.");
}

/** Contagem exata sem trazer linhas. */
async function countRows(admin, table, shopIds) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .in("barbershop_id", shopIds);
  if (error) throw new Error(`contar ${table}: ${error.message}`);
  return count ?? 0;
}

main().catch((err) => {
  console.error("\n✗ seed falhou:", err.message);
  process.exitCode = 1;
});

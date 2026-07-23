/**
 * Cleanup do seed de teste do BarbaFlow — remove SOMENTE o que o seed cria.
 *
 *   ALLOW_TEST_SEED_CLEANUP=true SEED_CONFIRM_PROJECT_REF=local \
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... SEED_TEST_PASSWORD=... \
 *   npm run seed:test:cleanup
 *
 * Só toca linhas cujo slug (subdomain) e e-mail estão na lista fixa de teste.
 * Mostra as contagens ANTES de apagar. Ordem respeita as foreign keys.
 *
 * Nota sobre o "último admin": trg_protect_last_barbershop_admin é um CONSTRAINT
 * TRIGGER DIFERIDO que valida no COMMIT, sobre o estado final. Por isso NÃO
 * apagamos user_roles avulso (a barbearia ficaria sem admin e o commit falharia):
 * apagamos a BARBEARIA, e o ON DELETE CASCADE remove os papéis junto — no estado
 * final a barbearia não existe e a regra se auto-dispensa.
 */
import {
  loadConfig, makeAdminClient, SHOPS, allTestEmails, fetchUserMap,
} from "./seed-barbaflow-lib.mjs";

function ok(res, label) {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

async function countIn(admin, table, col, values) {
  if (!values.length) return 0;
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .in(col, values);
  if (error) throw new Error(`contar ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const cfg = loadConfig({ allowVar: "ALLOW_TEST_SEED_CLEANUP" });
  const admin = makeAdminClient(cfg);

  console.log("─────────────────────────────────────────────");
  console.log(" BarbaFlow · cleanup do seed de teste");
  console.log(` Alvo (project ref): ${cfg.targetRef}`);
  console.log("─────────────────────────────────────────────");

  // Resolve os IDs das barbearias de teste pelos slugs conhecidos.
  const subdomains = SHOPS.map((s) => s.subdomain);
  const shops = ok(
    await admin.from("barbershops").select("id,subdomain").in("subdomain", subdomains),
    "resolver barbearias de teste",
  );
  const shopIds = shops.map((s) => s.id);

  // Resolve os IDs dos usuários de teste pelos e-mails conhecidos.
  const emails = allTestEmails();
  const userMap = await fetchUserMap(admin);
  const userIds = emails.map((e) => userMap.get(e.toLowerCase())).filter(Boolean);

  // Contagens ANTES de remover.
  const before = {
    barbearias: shopIds.length,
    agendamentos: await countIn(admin, "appointments", "barbershop_id", shopIds),
    disponibilidade: await countIn(admin, "availability", "barbershop_id", shopIds),
    schedule_blocks: await countIn(admin, "schedule_blocks", "barbershop_id", shopIds),
    grade: await countIn(admin, "weekly_schedule", "barbershop_id", shopIds),
    produtos: await countIn(admin, "products", "barbershop_id", shopIds),
    servicos: await countIn(admin, "services", "barbershop_id", shopIds),
    papeis: await countIn(admin, "user_roles", "barbershop_id", shopIds),
    perfis: await countIn(admin, "profiles", "user_id", userIds),
    usuarios: userIds.length,
  };
  console.log("\n── a remover (contagens atuais) ────────────");
  for (const [k, v] of Object.entries(before)) console.log(` ${k.padEnd(16)} ${v}`);

  if (shopIds.length === 0 && userIds.length === 0) {
    console.log("\nNada de teste encontrado. Nada a fazer.");
    return;
  }

  /* ── remoção em ordem de FK ───────────────────────────────────────────── */
  // Filhos escopados por barbearia (não disparam a regra do último admin).
  if (shopIds.length) {
    ok(await admin.from("appointments").delete().in("barbershop_id", shopIds), "apagar agendamentos");
    ok(await admin.from("availability").delete().in("barbershop_id", shopIds), "apagar disponibilidade");
    ok(await admin.from("schedule_blocks").delete().in("barbershop_id", shopIds), "apagar schedule_blocks");
    ok(await admin.from("weekly_schedule").delete().in("barbershop_id", shopIds), "apagar grade");
    ok(await admin.from("products").delete().in("barbershop_id", shopIds), "apagar produtos");
    ok(await admin.from("services").delete().in("barbershop_id", shopIds), "apagar serviços");
    // Barbearia por último entre as tabelas do tenant: CASCADE remove user_roles
    // (papéis) e qualquer resíduo, satisfazendo o trigger diferido do admin.
    ok(await admin.from("barbershops").delete().in("id", shopIds), "apagar barbearias");
  }

  // Perfis e contas Auth (por último). Apagar a conta também removeria o perfil
  // por cascade; fazemos o profile explícito para o caso de conta órfã.
  if (userIds.length) {
    ok(await admin.from("profiles").delete().in("user_id", userIds), "apagar perfis");
    for (const id of userIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(`apagar usuário ${id}: ${error.message}`);
    }
  }

  console.log("\n─────────────────────────────────────────────");
  console.log("OK — cleanup concluído (somente dados de teste).");
}

main().catch((err) => {
  console.error("\n✗ cleanup falhou:", err.message);
  process.exitCode = 1;
});

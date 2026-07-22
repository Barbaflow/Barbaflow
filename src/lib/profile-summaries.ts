import { supabase } from "@/integrations/supabase/client";

/**
 * Nome e avatar de um conjunto CONHECIDO de usuários, para exibição.
 *
 * Existe porque `public.profiles` deixou de ser legível por qualquer usuário
 * autenticado (migration 20260722240000): a policy antiga era
 * `SELECT USING (true)`, e com ela um cliente comum enumerava a tabela inteira
 * e lia o telefone de outros clientes.
 *
 * A RPC por trás devolve exatamente três campos — user_id, nome e avatar — e
 * nunca telefone nem e-mail. Use esta função sempre que precisar exibir o nome
 * de terceiros; para telefone existe `get_client_phone` (validando tenant).
 */
export interface ProfileSummary {
  full_name: string | null;
  avatar_url: string | null;
}

export type ProfileSummaryMap = Record<string, ProfileSummary>;

export async function fetchProfileSummaries(userIds: string[]): Promise<ProfileSummaryMap> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase.rpc("get_public_profile_summaries", {
    _user_ids: ids,
  });

  // Falha na RPC devolve mapa vazio: quem chama já trata "sem nome". Inventar
  // um nome aqui seria pior do que não mostrar nenhum.
  if (error || !data) return {};

  const mapa: ProfileSummaryMap = {};
  for (const linha of data as Array<{
    user_id: string;
    full_name: string | null;
    avatar_url: string | null;
  }>) {
    mapa[linha.user_id] = { full_name: linha.full_name, avatar_url: linha.avatar_url };
  }
  return mapa;
}

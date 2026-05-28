import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const MILESTONES = [
  { label: "20 minutos", minutes: 20 }, { label: "8 horas", minutes: 480 }, { label: "24 horas", minutes: 1440 },
  { label: "48 horas", minutes: 2880 }, { label: "72 horas", minutes: 4320 }, { label: "1 semana", minutes: 10080 },
  { label: "2 semanas", minutes: 20160 }, { label: "1 mes", minutes: 43200 }, { label: "3 meses", minutes: 129600 },
  { label: "6 meses", minutes: 259200 }, { label: "1 ano", minutes: 525600 }, { label: "5 anos", minutes: 2628000 },
  { label: "10 anos", minutes: 5256000 }, { label: "15 anos", minutes: 7884000 }
];

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function makeInviteCode() { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let out = ""; for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]; return out; }

function milestoneProgress(quitDate?: string | null, cigsPerDay = 10) {
  if (!quitDate) return { minutes_since_quit: null, current_milestone_label: null, next_milestone_label: null, next_milestone_progress: 0, cigarettes_not_smoked: 0 };
  const mins = Math.max(0, Math.floor((Date.now() - new Date(quitDate).getTime()) / 60000));
  const achieved = MILESTONES.filter(m => mins >= m.minutes);
  const current = achieved.length ? achieved[achieved.length - 1].label : "Iniciando jornada";
  const next = MILESTONES.find(m => mins < m.minutes) || null;
  let pct = 100;
  if (next) { const prev = achieved.length ? achieved[achieved.length - 1].minutes : 0; pct = Math.round(Math.max(0, Math.min(100, ((mins - prev) / (next.minutes - prev || 1)) * 100))); }
  return { minutes_since_quit: mins, current_milestone_label: current, next_milestone_label: next?.label ?? null, next_milestone_progress: pct, cigarettes_not_smoked: Math.floor((mins / 1440) * cigsPerDay) };
}

async function sendPushToUser(admin: any, userId: string, title: string, body: string) {
  void admin;
  void userId;
  void title;
  void body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData } = await authed.auth.getUser();
  const user = userData.user;
  if (!user) return json(401, { error: "Nao autenticado" });

  const path = new URL(req.url).pathname;
  if (req.method === "GET" && path.endsWith("/buddy/push/public-key")) {
    return json(200, { vapid_public_key: VAPID_PUBLIC_KEY });
  }

  if (req.method === "POST" && path.endsWith("/buddy/push/register")) {
    const b = await req.json();
    const sub = b?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(400, { error: "Subscription invalida" });
    const { error } = await admin.from("push_subscriptions").upsert({ user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: req.headers.get("user-agent") || null, updated_at: new Date().toISOString() }, { onConflict: "user_id,endpoint" });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, vapid_public_key: VAPID_PUBLIC_KEY });
  }

  if (req.method === "POST" && path.endsWith("/buddy/invite")) {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await admin.from("buddy_connections").select("id", { count: "exact", head: true }).eq("requester_id", user.id).gte("created_at", oneHourAgo);
    if ((count || 0) >= 5) return json(429, { error: "Limite de 5 convites por hora atingido." });
    const { data: activeExisting } = await admin.from("buddy_connections").select("id").or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status", "active").maybeSingle();
    if (activeExisting) return json(400, { error: "Voce ja tem um parceiro ativo." });
    let inviteCode = makeInviteCode();
    for (let i = 0; i < 5; i++) { const { data: ex } = await admin.from("buddy_connections").select("id").eq("invite_code", inviteCode).in("status", ["pending", "active"]).maybeSingle(); if (!ex) break; inviteCode = makeInviteCode(); }
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const { error } = await admin.from("buddy_connections").insert({ requester_id: user.id, invite_code: inviteCode, status: "pending", expires_at: expiresAt });
    if (error) return json(500, { error: error.message });
    return json(200, { invite_code: inviteCode, expires_at: expiresAt });
  }

  if (req.method === "POST" && path.endsWith("/buddy/accept")) {
    const body = await req.json();
    const inviteCode = String(body?.invite_code || "").toUpperCase().trim();
    if (!inviteCode || inviteCode.length !== 6) return json(400, { error: "Codigo invalido." });
    const { data: row } = await admin.from("buddy_connections").select("*").eq("invite_code", inviteCode).eq("status", "pending").maybeSingle();
    if (!row) return json(404, { error: "Convite invalido ou expirado." });
    if (row.requester_id === user.id) return json(400, { error: "Voce nao pode aceitar seu proprio convite." });
    if (new Date(row.expires_at).getTime() < Date.now()) return json(400, { error: "Este convite expirou." });
    const { data: activeExisting } = await admin.from("buddy_connections").select("id").or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status", "active").maybeSingle();
    if (activeExisting) return json(409, { error: "Voce ja tem parceiro ativo. Encerre para trocar." });

    await admin.from("buddy_connections").update({ receiver_id: user.id, status: "active", accepted_at: new Date().toISOString() }).eq("id", row.id);
    const { data: buddyPresence } = await admin.from("user_presence").select("user_id,display_name,quit_date,avatar_url").eq("user_id", row.requester_id).maybeSingle();
    const { data: receiverPresence } = await admin.from("user_presence").select("display_name").eq("user_id", user.id).maybeSingle();
    await sendPushToUser(admin, row.requester_id, "Convite aceito!", `${receiverPresence?.display_name || 'Seu parceiro'} aceitou seu convite. Agora voces estao juntos nessa jornada.`);

    return json(200, { buddy: { id: row.requester_id, display_name: buddyPresence?.display_name || "Parceiro", quit_date: buddyPresence?.quit_date || null, avatar_url: buddyPresence?.avatar_url || null } });
  }

  if (req.method === "GET" && path.endsWith("/buddy/me")) {
    const { data: conn } = await admin.from("buddy_connections").select("*").or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status", "active").order("accepted_at", { ascending: false }).limit(1).maybeSingle();
    if (!conn) return json(200, { connection: null });
    const buddyId = conn.requester_id === user.id ? conn.receiver_id : conn.requester_id;
    const { data: buddy } = await admin.from("user_presence").select("user_id,display_name,avatar_url,quit_date,is_online,last_seen_at,cigarettes_per_day").eq("user_id", buddyId).maybeSingle();
    return json(200, { connection: { id: conn.id, status: conn.status, accepted_at: conn.accepted_at }, buddy: { id: buddyId, display_name: buddy?.display_name || "Parceiro", avatar_url: buddy?.avatar_url || null, quit_date: buddy?.quit_date || null, is_online: !!buddy?.is_online, last_seen_at: buddy?.last_seen_at || null, ...milestoneProgress(buddy?.quit_date, buddy?.cigarettes_per_day || 10) } });
  }

  if (req.method === "DELETE" && path.endsWith("/buddy/me")) {
    const { data: conn } = await admin.from("buddy_connections").select("*").or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status", "active").order("accepted_at", { ascending: false }).limit(1).maybeSingle();
    if (!conn) return json(200, { ok: true });
    await admin.from("buddy_connections").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", conn.id);
    const partnerId = conn.requester_id === user.id ? conn.receiver_id : conn.requester_id;
    await sendPushToUser(admin, partnerId, "Conexao encerrada", "Seu parceiro encerrou a conexao. Voce segue forte e pode convidar alguem novo quando quiser.");
    return json(200, { ok: true });
  }

  if (req.method === "POST" && path.endsWith("/buddy/notify-milestone")) {
    const body = await req.json();
    const label = String(body?.label || "um novo marco");
    const { data: conn } = await admin.from("buddy_connections").select("*").or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status", "active").maybeSingle();
    if (!conn) return json(200, { ok: true });
    const partnerId = conn.requester_id === user.id ? conn.receiver_id : conn.requester_id;
    const { data: me } = await admin.from("user_presence").select("display_name").eq("user_id", user.id).maybeSingle();
    await sendPushToUser(admin, partnerId, "Parceiro atingiu marco", `${me?.display_name || 'Seu parceiro'} acabou de completar ${label} sem fumar! Mande uma mensagem de parabens.`);
    return json(200, { ok: true });
  }

  if (req.method === "POST" && path.endsWith("/buddy/weekly-reminder")) {
    const { data: conn } = await admin.from("buddy_connections").select("*").or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status", "active").maybeSingle();
    if (!conn) return json(200, { ok: true });
    const partnerId = conn.requester_id === user.id ? conn.receiver_id : conn.requester_id;
    await sendPushToUser(admin, user.id, "Resumo semanal da dupla", "Sua parceria segue firme. Reservem 5 minutos para celebrar os ganhos da semana.");
    await sendPushToUser(admin, partnerId, "Resumo semanal da dupla", "Sua parceria segue firme. Reservem 5 minutos para celebrar os ganhos da semana.");
    return json(200, { ok: true });
  }

  return json(404, { error: "Rota nao encontrada" });
});


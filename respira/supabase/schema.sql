-- Criação da tabela user_data
CREATE TABLE IF NOT EXISTS public.user_data (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar Row Level Security (Segurança a nível de linha)
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso (RLS Policies)

-- Permite que o usuário veja apenas os seus próprios dados
CREATE POLICY "Usuários podem ver seus próprios dados" 
  ON public.user_data 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Permite que o usuário insira seus próprios dados
CREATE POLICY "Usuários podem inserir seus próprios dados" 
  ON public.user_data 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Permite que o usuário atualize seus próprios dados
CREATE POLICY "Usuários podem atualizar seus próprios dados" 
  ON public.user_data 
  FOR UPDATE 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Habilitar o Realtime para a tabela user_data
-- Isso é necessário para que as inscrições no channel funcionem corretamente no app
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_data;
-- Buddy: conexoes e presenca
create table if not exists public.buddy_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid references auth.users(id) on delete set null,
  invite_code varchar(6) not null unique,
  status text not null check (status in ('pending','active','ended')) default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz
);

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  quit_date timestamptz,
  cigarettes_per_day integer,
  is_online boolean not null default false,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.buddy_live_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.buddy_connections enable row level security;
alter table public.user_presence enable row level security;
alter table public.buddy_live_state enable row level security;

-- RLS buddy_connections
create policy if not exists "buddy_select_own" on public.buddy_connections
for select using (auth.uid() = requester_id or auth.uid() = receiver_id);

create policy if not exists "buddy_insert_requester" on public.buddy_connections
for insert with check (auth.uid() = requester_id);

create policy if not exists "buddy_update_members" on public.buddy_connections
for update using (auth.uid() = requester_id or auth.uid() = receiver_id)
with check (auth.uid() = requester_id or auth.uid() = receiver_id);

-- RLS user_presence
create policy if not exists "presence_select_self_or_active_buddy" on public.user_presence
for select using (
  auth.uid() = user_id or exists (
    select 1 from public.buddy_connections bc
    where bc.status = 'active'
      and (
        (bc.requester_id = auth.uid() and bc.receiver_id = user_presence.user_id) or
        (bc.receiver_id = auth.uid() and bc.requester_id = user_presence.user_id)
      )
  )
);

create policy if not exists "presence_upsert_self" on public.user_presence
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS buddy_live_state
create policy if not exists "live_select_self_or_active_buddy" on public.buddy_live_state
for select using (
  auth.uid() = user_id or exists (
    select 1 from public.buddy_connections bc
    where bc.status = 'active'
      and (
        (bc.requester_id = auth.uid() and bc.receiver_id = buddy_live_state.user_id) or
        (bc.receiver_id = auth.uid() and bc.requester_id = buddy_live_state.user_id)
      )
  )
);

create policy if not exists "live_upsert_self" on public.buddy_live_state
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.user_presence;
alter publication supabase_realtime add table public.buddy_live_state;
alter publication supabase_realtime add table public.buddy_connections;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy if not exists "push_select_own" on public.push_subscriptions
for select using (auth.uid() = user_id);

create policy if not exists "push_insert_own" on public.push_subscriptions
for insert with check (auth.uid() = user_id);

create policy if not exists "push_update_own" on public.push_subscriptions
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "push_delete_own" on public.push_subscriptions
for delete using (auth.uid() = user_id);

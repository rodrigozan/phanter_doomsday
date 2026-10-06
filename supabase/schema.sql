create table projetos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  nome text not null,
  caminho text not null,
  session_id text,
  created_at timestamptz default now()
);

create table conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  projeto_id uuid not null references projetos(id) on delete cascade,
  titulo text not null,
  session_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table execucoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  projeto_id uuid not null references projetos(id) on delete cascade,
  conversa_id uuid references conversas(id) on delete cascade,
  tarefa text not null,
  modelo text not null,
  modo_modelo text not null default 'automatico',
  executor text not null default 'claude_code',
  fallback_de text,
  jev jsonb,
  status text not null default 'concluida',
  resultado text,
  duracao_ms integer,
  created_at timestamptz default now()
);

create table configuracoes (
  user_id uuid primary key default auth.uid() references auth.users(id),
  limiar_confianca numeric not null default 0.5,
  modo_executor text not null default 'automatico',
  limiar_noul numeric not null default 0.7,
  agy_sem_confirmacao boolean not null default false,
  agy_modelos jsonb not null default '{}'::jsonb,
  permission_mode text not null default 'acceptEdits',
  allowed_tools text[] not null default '{}',
  updated_at timestamptz default now()
);

alter table projetos enable row level security;
alter table conversas enable row level security;
alter table execucoes enable row level security;
alter table configuracoes enable row level security;

create policy "projetos do dono" on projetos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "conversas do dono" on conversas for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "execucoes do dono" on execucoes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "configuracoes do dono" on configuracoes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  projeto_id uuid not null references projetos(id) on delete cascade,
  titulo text not null,
  session_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table execucoes add column if not exists conversa_id uuid references conversas(id) on delete cascade;

alter table conversas enable row level security;

drop policy if exists "conversas do dono" on conversas;
create policy "conversas do dono" on conversas for all using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into conversas (user_id, projeto_id, titulo, session_id, created_at, updated_at)
select p.user_id, p.id, 'Conversa anterior', p.session_id, min(e.created_at), max(e.created_at)
from projetos p
join execucoes e on e.projeto_id = p.id and e.conversa_id is null
group by p.user_id, p.id, p.session_id;

update execucoes e
set conversa_id = c.id
from conversas c
where e.conversa_id is null and c.projeto_id = e.projeto_id and c.titulo = 'Conversa anterior';

create index if not exists execucoes_conversa_idx on execucoes (conversa_id, created_at);
create index if not exists conversas_projeto_idx on conversas (projeto_id, updated_at desc);

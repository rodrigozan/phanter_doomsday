alter table execucoes add column if not exists executor text not null default 'claude_code';
alter table execucoes add column if not exists fallback_de text;

alter table configuracoes add column if not exists modo_executor text not null default 'automatico';
alter table configuracoes add column if not exists limiar_noul numeric not null default 0.7;
alter table configuracoes add column if not exists agy_sem_confirmacao boolean not null default false;
alter table configuracoes add column if not exists agy_modelos jsonb not null default '{}'::jsonb;

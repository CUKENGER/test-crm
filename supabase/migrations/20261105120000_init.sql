create type public.user_role as enum ('manager', 'executor');
create type public.task_status as enum ('new', 'in_progress', 'on_review', 'accepted', 'rework');

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  role       public.user_role not null default 'executor',
  created_at timestamptz not null default now()
);

create table public.sites (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  address    text not null check (btrim(address) <> ''),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.sites (id) on delete cascade,
  title       text not null check (btrim(title) <> ''),
  description text not null default '',
  assignee_id uuid not null references public.profiles (id),
  author_id   uuid not null references public.profiles (id),
  status      public.task_status not null default 'new',
  created_at  timestamptz not null default now()
);

create table public.task_history (
  id          bigint generated always as identity primary key,
  task_id     uuid not null,
  task_title  text not null,
  from_status public.task_status,              -- null при создании
  to_status   public.task_status not null,
  changed_by  uuid not null references public.profiles (id),
  changed_at  timestamptz not null default now(),
  comment     text
);

create index tasks_site_idx        on public.tasks (site_id);
create index tasks_assignee_idx    on public.tasks (assignee_id);
create index task_history_task_idx on public.task_history (task_id, changed_at);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.log_task_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_history (task_id, task_title, from_status, to_status, changed_by)
  values (new.id, new.title, null, new.status, new.author_id);
  return new;
end;
$$;

create trigger tasks_log_created
  after insert on public.tasks
  for each row execute function public.log_task_created();

create or replace function public.forbid_history_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'История статусов нельзя изменять или удалять';
end;
$$;

create trigger task_history_no_update_delete
  before update or delete on public.task_history
  for each row execute function public.forbid_history_change();

create trigger task_history_no_truncate
  before truncate on public.task_history
  for each statement execute function public.forbid_history_change();

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'manager'
  );
$$;

create or replace function public.change_task_status(
  p_task_id uuid,
  p_to      public.task_status,
  p_comment text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_is_mgr  boolean := public.is_manager();
  v_is_exec boolean;
  v_task    public.tasks;
  v_comment text := nullif(btrim(p_comment), '');
begin
  if v_uid is null then
    raise exception 'Нужно войти в систему';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;

  if not found or (not v_is_mgr and v_task.assignee_id <> v_uid) then
    raise exception 'Задача не найдена';
  end if;

  v_is_exec := not v_is_mgr;

  if not (
       (v_task.status = 'new'         and p_to = 'in_progress' and v_is_exec)
    or (v_task.status = 'in_progress' and p_to = 'on_review'   and v_is_exec)
    or (v_task.status = 'rework'      and p_to = 'in_progress' and v_is_exec)
    or (v_task.status = 'on_review'   and p_to = 'accepted'    and v_is_mgr)
    or (v_task.status = 'on_review'   and p_to = 'rework'      and v_is_mgr)
  ) then
    raise exception 'Переход из "%" в "%" запрещён', v_task.status::text, p_to::text;
  end if;

  if p_to = 'rework' and v_comment is null then
    raise exception 'Для возврата на доработку нужен комментарий';
  end if;

  insert into public.task_history (task_id, task_title, from_status, to_status, changed_by, comment)
  values (v_task.id, v_task.title, v_task.status, p_to, v_uid, v_comment);

  update public.tasks set status = p_to
  where id = v_task.id
  returning * into v_task;

  return v_task;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.profiles, public.sites, public.tasks, public.task_history to authenticated;

grant insert (name, address, created_by) on public.sites to authenticated;
grant update (name, address)             on public.sites to authenticated;
grant delete                             on public.sites to authenticated;

grant insert (site_id, title, description, assignee_id, author_id) on public.tasks to authenticated;
grant update (site_id, title, description, assignee_id)            on public.tasks to authenticated;
grant delete                                                        on public.tasks to authenticated;

grant execute on function public.is_manager() to authenticated;
grant execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;

alter table public.profiles     enable row level security;
alter table public.sites        enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_history enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy sites_select on public.sites
  for select to authenticated using (
    public.is_manager()
    or exists (select 1 from public.tasks t where t.site_id = sites.id and t.assignee_id = auth.uid())
  );
create policy sites_insert on public.sites
  for insert to authenticated with check (public.is_manager() and created_by = auth.uid());
create policy sites_update on public.sites
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy sites_delete on public.sites
  for delete to authenticated using (public.is_manager());

create policy tasks_select on public.tasks
  for select to authenticated using (public.is_manager() or assignee_id = auth.uid());
create policy tasks_insert on public.tasks
  for insert to authenticated with check (
    public.is_manager() and author_id = auth.uid() and status = 'new'
    and exists (select 1 from public.profiles p where p.id = assignee_id and p.role = 'executor')
  );
create policy tasks_update on public.tasks
  for update to authenticated using (public.is_manager()) with check (
    public.is_manager()
    and exists (select 1 from public.profiles p where p.id = assignee_id and p.role = 'executor')
  );
create policy tasks_delete on public.tasks
  for delete to authenticated using (public.is_manager());

create policy task_history_select on public.task_history
  for select to authenticated using (
    public.is_manager()
    or exists (select 1 from public.tasks t where t.id = task_history.task_id and t.assignee_id = auth.uid())
  );

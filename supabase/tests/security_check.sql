select set_config('request.jwt.claims', '{"sub":"<UUID_ИВАНА>","role":"authenticated"}', false);
set role authenticated;

select id, title, status from public.tasks;

update public.tasks set status = 'accepted' where assignee_id = auth.uid();

update public.tasks set title = 'взлом' where id = '<ID_ЧУЖОЙ_ЗАДАЧИ>';

select public.change_task_status('<ID_СВОЕЙ_НОВОЙ_ЗАДАЧИ>', 'in_progress');

select public.change_task_status('<ID_СВОЕЙ_ЗАДАЧИ_В_РАБОТЕ>', 'accepted');

select public.change_task_status('<ID_ЧУЖОЙ_ЗАДАЧИ>', 'in_progress');

insert into public.task_history (task_id, task_title, to_status, changed_by)
values ('<ID_СВОЕЙ_ЗАДАЧИ>', 'x', 'accepted', auth.uid());

reset role;

select set_config('request.jwt.claims', '{"sub":"<UUID_РУКОВОДИТЕЛЯ>","role":"authenticated"}', false);
set role authenticated;

select public.change_task_status('<ID_ЗАДАЧИ_НА_ПРОВЕРКЕ>', 'rework');

select public.change_task_status('<ID_ЗАДАЧИ_НА_ПРОВЕРКЕ>', 'rework', 'Не хватает фото');
select * from public.task_history where task_id = '<ID_ЗАДАЧИ_НА_ПРОВЕРКЕ>' order by id;

reset role;

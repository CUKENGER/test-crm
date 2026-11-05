import { supabase } from "./supabase";
import type { TaskStatus } from "./transitions";

export type Task = {
  id: string;
  site_id: string;
  title: string;
  description: string;
  assignee_id: string;
  author_id: string;
  status: TaskStatus;
  created_at: string;
};

export async function fetchSiteTasks(siteId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as Task[];
}

export async function createTask(
  input: Pick<
    Task,
    "site_id" | "title" | "description" | "assignee_id" | "author_id"
  >,
): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function changeTaskStatus(
  taskId: string,
  to: TaskStatus,
  comment?: string,
): Promise<Task> {
  const { data, error } = await supabase.rpc("change_task_status", {
    p_task_id: taskId,
    p_to: to,
    p_comment: comment ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function fetchTaskHistory(taskId: string) {
  const { data, error } = await supabase
    .from("task_history")
    .select(
      "from_status, to_status, comment, changed_at, profiles!changed_by(full_name)",
    )
    .eq("task_id", taskId)
    .order("changed_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

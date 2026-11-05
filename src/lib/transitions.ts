export type TaskStatus =
  "new" | "in_progress" | "on_review" | "accepted" | "rework";
export type Role = "manager" | "executor";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  on_review: "На проверке",
  accepted: "Принята",
  rework: "На доработке",
};

type Transition = {
  to: TaskStatus;
  label: string;
  by: Role;
  commentRequired?: boolean;
};

// Зеркало правил из БД, нужно только для показа кнопок.
// Источник истины — функция change_task_status.
export const TRANSITIONS: Record<TaskStatus, Transition[]> = {
  new: [{ to: "in_progress", label: "Взять в работу", by: "executor" }],
  in_progress: [
    { to: "on_review", label: "Отправить на проверку", by: "executor" },
  ],
  on_review: [
    { to: "accepted", label: "Принять", by: "manager" },
    {
      to: "rework",
      label: "Вернуть на доработку",
      by: "manager",
      commentRequired: true,
    },
  ],
  rework: [{ to: "in_progress", label: "Взять в работу", by: "executor" }],
  accepted: [],
};

export function availableActions(
  status: TaskStatus,
  role: Role,
  isAssignee: boolean,
): Transition[] {
  return TRANSITIONS[status].filter((t) =>
    t.by === "manager" ? role === "manager" : role === "executor" && isAssignee,
  );
}

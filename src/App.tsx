import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import {
  availableActions,
  STATUS_LABELS,
  type Role,
  type TaskStatus,
} from "./lib/transitions";
import type { Task } from "./lib/tasks";
import "./App.css";

type Profile = {
  id: string;
  full_name: string;
  role: Role;
};

type Site = {
  id: string;
  name: string;
  address: string;
};

type HistoryRow = {
  id: number;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  changed_by: string;
  changed_at: string;
  comment: string | null;
};

function App() {
  const [session, setSession] = useState<{
    user: { id: string };
  } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [newTaskSite, setNewTaskSite] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [taskComment, setTaskComment] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editTaskSiteId, setEditTaskSiteId] = useState("");
  const [editTaskAssigneeId, setEditTaskAssigneeId] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  async function loadWorkspace(userId: string) {
    setError("");

    const [profileResult, profilesResult, sitesResult, tasksResult] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, role")
          .eq("id", userId)
          .single(),
        supabase
          .from("profiles")
          .select("id, full_name, role")
          .order("full_name"),
        supabase.from("sites").select("id, name, address").order("name"),
        supabase
          .from("tasks")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

    const failed = [
      profileResult.error,
      profilesResult.error,
      sitesResult.error,
      tasksResult.error,
    ].find(Boolean);

    if (failed) {
      setError(failed.message);
      return;
    }

    setProfile(profileResult.data as Profile);
    setProfiles((profilesResult.data ?? []) as Profile[]);
    setSites((sitesResult.data ?? []) as Site[]);
    setTasks((tasksResult.data ?? []) as Task[]);
  }

  useEffect(() => {
    let active = true;

    async function start() {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!active) return;

      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }

      setSession(data.session);

      if (data.session) {
        await loadWorkspace(data.session.user.id);
      }

      if (active) setLoading(false);
    }

    void start();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);

        if (nextSession) {
          window.setTimeout(() => {
            void loadWorkspace(nextSession.user.id).finally(() =>
              setLoading(false),
            );
          }, 0);
        } else {
          setProfile(null);
          setProfiles([]);
          setSites([]);
          setTasks([]);
          setSelectedTaskId(null);
          setLoading(false);
        }
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!selectedTaskId || !session) return;

    let active = true;

    async function loadHistory() {
      const { data, error: historyError } = await supabase
        .from("task_history")
        .select("id, from_status, to_status, changed_by, changed_at, comment")
        .eq("task_id", selectedTaskId)
        .order("changed_at", { ascending: true });

      if (!active) return;

      if (historyError) {
        setError(historyError.message);
        return;
      }

      setHistory((data ?? []) as HistoryRow[]);
    }

    void loadHistory();

    return () => {
      active = false;
    };
  }, [selectedTaskId, session, tasks]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
    }
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  }

  async function refresh() {
    if (session) await loadWorkspace(session.user.id);
  }

  async function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;

    const { error: insertError } = await supabase.from("sites").insert({
      name: siteName.trim(),
      address: siteAddress.trim(),
      created_by: profile.id,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSiteName("");
    setSiteAddress("");
    await refresh();
  }

  async function createNewTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;

    const { error: insertError } = await supabase.from("tasks").insert({
      site_id: newTaskSite,
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim(),
      assignee_id: newTaskAssignee,
      author_id: profile.id,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewTaskTitle("");
    setNewTaskDescription("");
    await refresh();
  }

  async function changeStatus(to: TaskStatus, commentRequired: boolean) {
    if (!selectedTask) return;

    if (commentRequired && !taskComment.trim()) {
      setError("Для возврата на доработку напишите комментарий.");
      return;
    }

    setError("");

    const { error: statusError } = await supabase.rpc("change_task_status", {
      p_task_id: selectedTask.id,
      p_to: to,
      p_comment: taskComment.trim() || null,
    });

    if (statusError) {
      setError(statusError.message);
      return;
    }

    setTaskComment("");
    await refresh();
  }

  async function saveTaskEdits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask) return;

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        title: editTitle.trim(),
        description: editDescription.trim(),
        site_id: editTaskSiteId,
        assignee_id: editTaskAssigneeId,
      })
      .eq("id", selectedTask.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await refresh();
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;

    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .eq("id", task.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setSelectedTaskId(null);
    await refresh();
  }

  async function deleteSite(site: Site) {
    if (!window.confirm(`Удалить объект «${site.name}» и его задачи?`)) return;

    const { error: deleteError } = await supabase
      .from("sites")
      .delete()
      .eq("id", site.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setSelectedTaskId(null);
    await refresh();
  }

  async function editSite(site: Site) {
    const name = window.prompt("Название объекта", site.name);
    if (name === null) return;

    const address = window.prompt("Адрес объекта", site.address);
    if (address === null) return;

    if (!name.trim() || !address.trim()) {
      setError("Название и адрес не должны быть пустыми.");
      return;
    }

    const { error: updateError } = await supabase
      .from("sites")
      .update({ name: name.trim(), address: address.trim() })
      .eq("id", site.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await refresh();
  }

  if (loading) {
    return (
      <main className="app">
        <p>Загрузка…</p>
      </main>
    );
  }

  if (!session || !profile) {
    return (
      <main className="app login-page">
        <form className="panel login-panel" onSubmit={signIn}>
          <h1>Мини-CRM</h1>
          <p>Войдите по выданным email и паролю.</p>

          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error && <p className="error">{error}</p>}
          <button type="submit">Войти</button>
        </form>
      </main>
    );
  }

  const isManager = profile.role === "manager";
  const actions = selectedTask
    ? availableActions(
        selectedTask.status,
        profile.role,
        selectedTask.assignee_id === profile.id,
      )
    : [];

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>Объекты и задачи</h1>
          <span>
            {profile.full_name} · {isManager ? "Постановщик" : "Исполнитель"}
          </span>
        </div>
        <button className="secondary" onClick={signOut}>
          Выйти
        </button>
      </header>

      {error && (
        <div className="error-banner">
          {error}
          <button className="secondary" onClick={() => setError("")}>
            Закрыть
          </button>
        </div>
      )}

      {isManager && (
        <section className="panel">
          <h2>Создать объект</h2>
          <form className="form-row" onSubmit={createSite}>
            <input
              placeholder="Название объекта"
              value={siteName}
              onChange={(event) => setSiteName(event.target.value)}
              required
            />
            <input
              placeholder="Адрес"
              value={siteAddress}
              onChange={(event) => setSiteAddress(event.target.value)}
              required
            />
            <button type="submit">Добавить объект</button>
          </form>
        </section>
      )}

      {isManager && sites.length > 0 && (
        <section className="panel">
          <h2>Создать задачу</h2>
          <form className="form-row" onSubmit={createNewTask}>
            <select
              value={newTaskSite}
              onChange={(event) => setNewTaskSite(event.target.value)}
              required
            >
              <option value="">Выберите объект</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>

            <input
              placeholder="Название задачи"
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              required
            />

            <select
              value={newTaskAssignee}
              onChange={(event) => setNewTaskAssignee(event.target.value)}
              required
            >
              <option value="">Назначить исполнителя</option>
              {profiles
                .filter((item) => item.role === "executor")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name || item.id}
                  </option>
                ))}
            </select>

            <input
              placeholder="Описание"
              value={newTaskDescription}
              onChange={(event) => setNewTaskDescription(event.target.value)}
            />
            <button type="submit">Создать задачу</button>
          </form>
        </section>
      )}

      <div className="workspace">
        <section>
          <h2>{isManager ? "Все объекты" : "Мои объекты и задачи"}</h2>

          {sites.length === 0 && <p>Пока нет доступных объектов.</p>}

          {sites.map((site) => {
            const siteTasks = tasks.filter((task) => task.site_id === site.id);

            return (
              <article className="panel site-card" key={site.id}>
                <div className="site-heading">
                  <div>
                    <h3>{site.name}</h3>
                    <p>{site.address}</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => void editSite(site)}
                  >
                    Редактировать объект
                  </button>
                  {isManager && (
                    <button
                      className="danger"
                      onClick={() => void deleteSite(site)}
                    >
                      Удалить объект
                    </button>
                  )}
                </div>

                {siteTasks.length === 0 ? (
                  <p>Задач пока нет.</p>
                ) : (
                  <ul className="task-list">
                    {siteTasks.map((task) => (
                      <li key={task.id}>
                        <button
                          className={`task-link ${selectedTaskId === task.id ? "selected" : ""}`}
                          onClick={() => {
                            setSelectedTaskId(task.id);
                            setHistory([]);
                            setEditTitle(task.title);
                            setEditDescription(task.description);
                            setEditTaskSiteId(task.site_id);
                            setEditTaskAssigneeId(task.assignee_id);
                          }}
                        >
                          <span>{task.title}</span>
                          <span className="status">
                            {STATUS_LABELS[task.status]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </section>

        <aside className="panel task-panel">
          {!selectedTask ? (
            <p>Выберите задачу, чтобы увидеть подробности и историю.</p>
          ) : (
            <>
              <span className="status">
                {STATUS_LABELS[selectedTask.status]}
              </span>
              <h2>{selectedTask.title}</h2>
              <p>{selectedTask.description || "Описание не указано."}</p>
              <p>
                Исполнитель:{" "}
                {profiles.find((item) => item.id === selectedTask.assignee_id)
                  ?.full_name || "Неизвестно"}
              </p>
              <p>
                Создана:{" "}
                {new Date(selectedTask.created_at).toLocaleString("ru-RU")}
              </p>

              {isManager && (
                <form className="edit-form" onSubmit={saveTaskEdits}>
                  <h3>Редактировать задачу</h3>
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    required
                  />
                  <select
                    value={editTaskSiteId}
                    onChange={(event) => setEditTaskSiteId(event.target.value)}
                    required
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={editTaskAssigneeId}
                    onChange={(event) =>
                      setEditTaskAssigneeId(event.target.value)
                    }
                    required
                  >
                    {profiles
                      .filter((item) => item.role === "executor")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.full_name || item.id}
                        </option>
                      ))}
                  </select>
                  <textarea
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    placeholder="Описание"
                  />
                  <button type="submit">Сохранить изменения</button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void deleteTask(selectedTask)}
                  >
                    Удалить задачу
                  </button>
                </form>
              )}

              {actions.length > 0 && (
                <div className="actions">
                  <label>
                    Комментарий
                    <textarea
                      value={taskComment}
                      onChange={(event) => setTaskComment(event.target.value)}
                      placeholder="Обязателен при возврате на доработку"
                    />
                  </label>

                  {actions.map((action) => (
                    <button
                      key={action.to}
                      onClick={() =>
                        void changeStatus(
                          action.to,
                          Boolean(action.commentRequired),
                        )
                      }
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}

              <h3>История изменений</h3>
              {history.length === 0 ? (
                <p>История пока пуста.</p>
              ) : (
                <ol className="history-list">
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <strong>
                        {entry.from_status
                          ? STATUS_LABELS[entry.from_status]
                          : "Создана"}{" "}
                        → {STATUS_LABELS[entry.to_status]}
                      </strong>
                      <span>
                        {profiles.find((item) => item.id === entry.changed_by)
                          ?.full_name || "Пользователь"}{" "}
                        · {new Date(entry.changed_at).toLocaleString("ru-RU")}
                      </span>
                      {entry.comment && <p>Комментарий: {entry.comment}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

export default App;

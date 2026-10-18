// The Tasks tab: a complete example of a tab backed by your own D1 table.
//   GET    /api/tasks              -> { tasks: [...] }
//   POST   /api/tasks  {title}     -> add
//   PATCH  /api/tasks  {id, done}  -> tick / untick
//   DELETE /api/tasks  {id}        -> remove
import { json } from "./auth.js";

export async function tasksRoute(request, env, user) {
  if (request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id,title,done,created_at FROM tasks WHERE user_id=? ORDER BY done, created_at DESC")
      .bind(user.id).all();
    return json({ tasks: results });
  }
  const body = await request.json().catch(() => ({}));
  if (request.method === "POST") {
    const title = String(body.title || "").trim().slice(0, 200);
    if (!title) return json({ error: "Title required." }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO tasks(id,user_id,title,created_at) VALUES (?,?,?,?)")
      .bind(id, user.id, title, new Date().toISOString()).run();
    return json({ id });
  }
  if (request.method === "PATCH") {
    await env.DB.prepare("UPDATE tasks SET done=? WHERE id=? AND user_id=?").bind(body.done ? 1 : 0, String(body.id), user.id).run();
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM tasks WHERE id=? AND user_id=?").bind(String(body.id), user.id).run();
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}

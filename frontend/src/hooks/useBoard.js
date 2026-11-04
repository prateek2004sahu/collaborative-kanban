import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { errorMessage } from '../services/api';
import { useSocketEvent } from './useRealtime';

/** Replace-or-add tasks by id. */
const mergeTasks = (list, incoming) => {
  const map = new Map(list.map((t) => [t.id, t]));
  for (const t of incoming) map.set(t.id, t);
  return [...map.values()];
};

/** Local (optimistic) version of what the server does when a task is moved. */
function reorderLocal(tasks, taskId, columnId, index) {
  const moving = tasks.find((t) => t.id === taskId);
  const byCol = {};
  tasks.filter((t) => t.id !== taskId).sort((a, b) => a.position - b.position)
    .forEach((t) => { (byCol[t.columnId] ||= []).push(t); });
  const dest = (byCol[columnId] ||= []);
  dest.splice(Math.min(index, dest.length), 0, { ...moving, columnId });
  return Object.values(byCol).flatMap((list) => list.map((t, i) => ({ ...t, position: i })));
}

/**
 * All board state + actions:
 *  - loads board / columns / tasks
 *  - applies live socket events
 *  - optimistic moves & deletes (rolled back / reconciled if the server disagrees)
 *  - version-based conflict handling
 *  - undo / redo for moves and edits
 */
export function useBoard(boardId) {
  const [state, setState] = useState({ loading: true, error: null, board: null, columns: [], tasks: [] });
  const [notice, setNotice] = useState(null);
  const [, bump] = useState(0);
  const tasksRef = useRef([]);
  tasksRef.current = state.tasks;
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  const flash = useCallback((message, type = 'info') => {
    setNotice({ message, type, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const setTasks = (fn) => setState((s) => ({ ...s, tasks: typeof fn === 'function' ? fn(s.tasks) : fn }));

  /** Fetch the authoritative state from the server. */
  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get(`/boards/${boardId}`);
      setState({ loading: false, error: null, ...data });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e) }));
    }
  }, [boardId]);

  useEffect(() => {
    undoStack.current = []; redoStack.current = [];
    setState({ loading: true, error: null, board: null, columns: [], tasks: [] });
    load();
  }, [load]);

  // ---------- live events from other users ----------
  const mine = (p) => p.boardId === boardId || p.task?.boardId === boardId;
  useSocketEvent('task:created', (p) => { if (mine(p)) setTasks((l) => mergeTasks(l, [p.task])); });
  useSocketEvent('task:updated', (p) => {
    if (mine(p)) setTasks((l) => { const cur = l.find((t) => t.id === p.task.id); return !cur || p.task.version >= cur.version ? mergeTasks(l, [p.task]) : l; });
  });
  useSocketEvent('task:moved', (p) => { if (mine(p)) setTasks((l) => mergeTasks(l, p.tasks)); });
  useSocketEvent('task:deleted', (p) => {
    if (p.boardId === boardId) setTasks((l) => mergeTasks(l.filter((t) => t.id !== p.taskId), p.tasks));
  });
  useSocketEvent('column:updated', (p) => { if (p.boardId === boardId) setState((s) => ({ ...s, columns: p.columns })); });
  useSocketEvent('column:deleted', (p) => {
    if (p.boardId === boardId) setTasks((l) => l.filter((t) => t.columnId !== p.columnId));
  });
  useSocketEvent('board:updated', (p) => {
    if (p.board?.id !== boardId) return;
    if (p.action === 'deleted') setState((s) => ({ ...s, error: 'This board was deleted.' }));
    else setState((s) => ({ ...s, board: p.board }));
  });

  // ---------- actions ----------
  const createTask = async (columnId, title) => {
    try {
      const { data } = await api.post('/tasks', { boardId, columnId, title });
      setTasks((l) => mergeTasks(l, [data]));
    } catch (e) { flash(errorMessage(e), 'error'); }
  };

  /** Move with an optimistic UI update. `record=false` is used by undo/redo. */
  const moveTask = async (taskId, columnId, index, record = true) => {
    const before = tasksRef.current;
    const task = before.find((t) => t.id === taskId);
    if (!task) return;
    const from = {
      columnId: task.columnId,
      index: before.filter((t) => t.columnId === task.columnId).sort((a, b) => a.position - b.position).findIndex((t) => t.id === taskId),
    };
    if (from.columnId === columnId && from.index === index) return;

    setTasks(reorderLocal(before, taskId, columnId, index));                  // 1) optimistic
    try {
      const { data } = await api.patch(`/tasks/${taskId}/move`, { columnId, index, version: task.version });
      setTasks((l) => mergeTasks(l, data.tasks));                              // 2) server is authoritative
      if (record) { undoStack.current.push({ type: 'move', taskId, from, to: { columnId, index } }); redoStack.current = []; bump((n) => n + 1); }
    } catch (e) {
      setTasks(before);                                                         // 3) roll back
      if (e.response?.status === 409) {
        setTasks((l) => mergeTasks(l, [e.response.data.current]));
        flash('Someone else just changed that task. Showing the latest version.', 'warn');
        load();
      } else if (e.response?.status === 404) { flash('That task no longer exists.', 'warn'); load(); }
      else flash(errorMessage(e), 'error');
    }
  };

  /** Edit fields. `expectedVersion` = the version the user's form was based on. */
  const updateTask = async (taskId, fields, expectedVersion, record = true) => {
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task) return { gone: true };
    try {
      const { data } = await api.put(`/tasks/${taskId}`, { ...fields, version: expectedVersion ?? task.version });
      const before = Object.fromEntries(Object.keys(fields).map((k) => [k, task[k]]));
      setTasks((l) => mergeTasks(l, [data]));
      if (record) { undoStack.current.push({ type: 'update', taskId, before, after: fields }); redoStack.current = []; bump((n) => n + 1); }
      return { ok: true, task: data };
    } catch (e) {
      if (e.response?.status === 409) {
        setTasks((l) => mergeTasks(l, [e.response.data.current]));
        return { conflict: true, current: e.response.data.current };
      }
      if (e.response?.status === 404) { setTasks((l) => l.filter((t) => t.id !== taskId)); return { gone: true }; }
      flash(errorMessage(e), 'error');
      return { error: errorMessage(e) };
    }
  };

  const deleteTask = async (taskId) => {
    const before = tasksRef.current;
    setTasks((l) => l.filter((t) => t.id !== taskId));                         // optimistic
    try { await api.delete(`/tasks/${taskId}`); }
    catch (e) {
      if (e.response?.status !== 404) { setTasks(before); flash(errorMessage(e), 'error'); }
    }
    undoStack.current = undoStack.current.filter((a) => a.taskId !== taskId);
    redoStack.current = redoStack.current.filter((a) => a.taskId !== taskId);
    bump((n) => n + 1);
  };

  // ---------- undo / redo ----------
  const apply = async (action, direction) => {
    if (action.type === 'move') {
      const target = direction === 'undo' ? action.from : action.to;
      await moveTask(action.taskId, target.columnId, target.index, false);
    } else {
      const res = await updateTask(action.taskId, direction === 'undo' ? action.before : action.after, undefined, false);
      if (res.conflict) flash('Could not undo: the task was changed meanwhile (latest version loaded).', 'warn');
    }
  };
  const undo = async () => { const a = undoStack.current.pop(); if (!a) return; redoStack.current.push(a); bump((n) => n + 1); await apply(a, 'undo'); };
  const redo = async () => { const a = redoStack.current.pop(); if (!a) return; undoStack.current.push(a); bump((n) => n + 1); await apply(a, 'redo'); };

  const tasksByColumn = useMemo(() => {
    const map = Object.fromEntries(state.columns.map((c) => [c.id, []]));
    for (const t of state.tasks) (map[t.columnId] ||= []).push(t);
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.position - b.position);
    return map;
  }, [state.columns, state.tasks]);

  return {
    ...state, tasksByColumn, notice, reload: () => load(false), flash,
    createTask, moveTask, updateTask, deleteTask,
    undo, redo, canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0,
  };
}

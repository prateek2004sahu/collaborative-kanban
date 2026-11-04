import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import TaskCard from './TaskCard';

/** One Kanban column = a droppable area containing a sortable list of cards. */
export default function BoardColumn({ column, tasks, names, onOpen, onAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { type: 'column' } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onAdd(column.id, title.trim());
    setTitle(''); setAdding(false);
  };

  return (
    <section className={`column ${isOver ? 'over' : ''}`}>
      <header className="column-head"><h3>{column.name}</h3><span className="count">{tasks.length}</span></header>
      <div ref={setNodeRef} className="column-body">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <TaskCard key={t.id} task={t} assigneeName={names[t.assignedTo]} onOpen={onOpen} />)}
        </SortableContext>
        {tasks.length === 0 && <div className="empty-col">Drop tasks here</div>}
      </div>
      {adding ? (
        <form onSubmit={submit} className="add-form">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title…" maxLength={200} />
          <div className="row"><button className="btn primary sm">Add</button><button type="button" className="btn sm" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      ) : (
        <button className="add-task" onClick={() => setAdding(true)}>+ Add task</button>
      )}
    </section>
  );
}

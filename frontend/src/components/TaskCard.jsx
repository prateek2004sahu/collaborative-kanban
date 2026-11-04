import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export const initials = (name = '?') => name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

/** Visual card (also used inside the DragOverlay). */
export function TaskCardView({ task, assigneeName, overlay, dragging, onClick }) {
  const overdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <div className={`task-card ${overlay ? 'overlay' : ''} ${dragging ? 'ghost' : ''}`} onClick={onClick}>
      <div className="task-title">{task.title}</div>
      {task.description && <div className="task-desc">{task.description}</div>}
      {task.labels?.length > 0 && <div className="labels">{task.labels.map((l) => <span key={l} className="label">{l}</span>)}</div>}
      <div className="task-meta">
        <span className={`prio prio-${task.priority}`}>{task.priority}</span>
        {task.dueDate && <span className={`due ${overdue ? 'overdue' : ''}`}>📅 {task.dueDate}</span>}
        {assigneeName && <span className="avatar small" title={assigneeName}>{initials(assigneeName)}</span>}
      </div>
    </div>
  );
}

/** Draggable + sortable wrapper. */
export default function TaskCard({ task, assigneeName, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnId: task.columnId },
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}>
      <TaskCardView task={task} assigneeName={assigneeName} dragging={isDragging} onClick={() => onOpen(task.id)} />
    </div>
  );
}

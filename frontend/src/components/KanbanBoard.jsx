import { useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
import BoardColumn from './BoardColumn';
import { TaskCardView } from './TaskCard';

/**
 * Drag-and-drop logic:
 *  - drop on a CARD   -> insert at that card's index in the destination column
 *  - drop on a COLUMN -> append to the end of that column
 * The actual move (optimistic update + server call) is done by onMove.
 */
export default function KanbanBoard({ columns, tasksByColumn, names, onMove, onOpen, onAdd }) {
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),   // small drag distance => clicks still open the task
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );
  const allTasks = Object.values(tasksByColumn).flat();
  const active = allTasks.find((t) => t.id === activeId);

  const handleDragEnd = ({ active: a, over }) => {
    setActiveId(null);
    if (!over || a.id === over.id) return;
    const overTask = allTasks.find((t) => t.id === over.id);
    if (overTask) {
      const list = tasksByColumn[overTask.columnId];
      onMove(a.id, overTask.columnId, list.findIndex((t) => t.id === overTask.id));
    } else if (tasksByColumn[over.id]) {
      const list = tasksByColumn[over.id].filter((t) => t.id !== a.id);
      onMove(a.id, over.id, list.length);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(e.active.id)} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="columns">
        {columns.map((c) => (
          <BoardColumn key={c.id} column={c} tasks={tasksByColumn[c.id] || []} names={names} onOpen={onOpen} onAdd={onAdd} />
        ))}
      </div>
      <DragOverlay>{active ? <TaskCardView task={active} assigneeName={names[active.assignedTo]} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

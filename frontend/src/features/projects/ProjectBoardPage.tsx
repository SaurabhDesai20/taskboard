/**
 * `/w/:slug/projects/:projectId` (index): the project's board. A placeholder until the Kanban
 * board (Phase 4) replaces it.
 */
export function ProjectBoardPage() {
  return (
    <section className="workspace-section" aria-labelledby="board-title">
      <h2 id="board-title">Board</h2>
      <div className="empty-state">
        <p className="empty-state__title">No tasks yet</p>
        <p>Tasks will appear here on a board with To Do, In Progress, In Review and Done columns.</p>
      </div>
    </section>
  )
}

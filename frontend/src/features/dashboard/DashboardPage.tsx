import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { MyDueTasks } from '../tasks/MyDueTasks'
import { WorkspacesSection } from '../workspaces/WorkspacesSection'
import './dashboard.css'

/** Home (`/`): what needs my attention (overdue and due this week), then my workspaces. */
export function DashboardPage() {
  useDocumentTitle('Dashboard')
  return (
    <div className="page dashboard">
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>
      <MyDueTasks />
      <WorkspacesSection />
    </div>
  )
}

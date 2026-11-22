import type { RouteObject } from 'react-router'
import { WorkspaceActivityPage } from '../features/activity/WorkspaceActivityPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RegisterPage } from '../features/auth/RegisterPage'
import { RequireAuth, RequireGuest } from '../features/auth/RouteGuards'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ProjectLayout } from '../features/projects/ProjectLayout'
import { MyTasksPage } from '../features/tasks/MyTasksPage'
import { ProjectTasksPage } from '../features/tasks/ProjectTasksPage'
import { WorkspaceHomePage } from '../features/workspaces/WorkspaceHomePage'
import { WorkspaceLayout, WorkspaceRoute } from '../features/workspaces/WorkspaceLayout'
import { WorkspaceSettingsPage } from '../features/workspaces/WorkspaceSettingsPage'
import { AppLayout } from './AppLayout'
import { NotFoundPage } from './NotFoundPage'
import { RootErrorPage, RouteErrorPage } from './RouteErrorPage'

// Route table shared by the browser router (App.tsx) and the memory router in tests.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    // A page that crashes while rendering shows an error page instead (inside the layout when
    // possible, so the header stays usable).
    errorElement: <RootErrorPage />,
    children: [
      {
        // Only for logged-out visitors; signed-in users are sent on to their target.
        element: <RequireGuest />,
        errorElement: <RouteErrorPage />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
        ],
      },
      {
        // Everything else needs a session.
        element: <RequireAuth />,
        errorElement: <RouteErrorPage />,
        children: [
          // My overdue and due-this-week tasks, then my workspaces.
          { index: true, element: <DashboardPage /> },
          // Tasks assigned to me across workspaces.
          { path: 'me/tasks', element: <MyTasksPage /> },
          {
            // The slug is resolved to a workspace (and the user's role) via GET /workspaces.
            path: 'w/:slug',
            element: <WorkspaceRoute />,
            children: [
              {
                // Workspace header and tabs.
                element: <WorkspaceLayout />,
                children: [
                  { index: true, element: <WorkspaceHomePage /> },
                  // The workspace's activity log; takes ?project and ?actor filters.
                  { path: 'activity', element: <WorkspaceActivityPage /> },
                  { path: 'settings', element: <WorkspaceSettingsPage /> },
                ],
              },
              {
                // Breadcrumbs, project sidebar and the project. The id is the project's UUID.
                // The board takes ?status, ?priority, ?assignee, ?due_before, ?q, ?view and ?task.
                path: 'projects/:projectId',
                element: <ProjectLayout />,
                children: [{ index: true, element: <ProjectTasksPage /> }],
              },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

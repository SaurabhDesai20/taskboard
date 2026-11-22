import type { RouteObject } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { RegisterPage } from '../features/auth/RegisterPage'
import { RequireAuth, RequireGuest } from '../features/auth/RouteGuards'
import { ProjectBoardPage } from '../features/projects/ProjectBoardPage'
import { ProjectLayout } from '../features/projects/ProjectLayout'
import { WorkspaceHomePage } from '../features/workspaces/WorkspaceHomePage'
import { WorkspaceLayout, WorkspaceRoute } from '../features/workspaces/WorkspaceLayout'
import { WorkspaceSettingsPage } from '../features/workspaces/WorkspaceSettingsPage'
import { WorkspacesPage } from '../features/workspaces/WorkspacesPage'
import { AppLayout } from './AppLayout'
import { NotFoundPage } from './NotFoundPage'

// Route table shared by the browser router (App.tsx) and the memory router in tests.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        // Only for logged-out visitors; signed-in users are sent on to their target.
        element: <RequireGuest />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
        ],
      },
      {
        // Everything else needs a session.
        element: <RequireAuth />,
        children: [
          { index: true, element: <WorkspacesPage /> },
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
                  { path: 'settings', element: <WorkspaceSettingsPage /> },
                ],
              },
              {
                // Breadcrumbs, project sidebar and the project. The id is the project's UUID.
                path: 'projects/:projectId',
                element: <ProjectLayout />,
                children: [{ index: true, element: <ProjectBoardPage /> }],
              },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

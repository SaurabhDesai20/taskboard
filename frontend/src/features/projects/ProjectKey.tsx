/** A project key ("WEB") as a small monospace label, announced as "Key: WEB". */
export function ProjectKey({ projectKey }: { projectKey: string }) {
  return (
    <span className="project-key">
      <span className="visually-hidden">Key: </span>
      {projectKey}
    </span>
  )
}

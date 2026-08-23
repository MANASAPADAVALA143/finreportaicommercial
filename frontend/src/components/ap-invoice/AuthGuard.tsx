/**
 * AuthGuard — login temporarily disabled.
 * Re-enable session redirect to /login when auth is restored.
 */
interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

import { Badge, Card, EmptyState, SkeletonList } from '../../components/ui';
import { useAuth } from '../auth/useAuth';

/**
 * The dashboard.
 *
 * A frame with the member's own context in it. The reporting spine that fills it lands in
 * M2; what matters here is that a member signs in and immediately sees who the system
 * thinks they are, which is the question every support conversation starts with.
 */
export function DashboardPage() {
  const { isLoading, person, context, appointments } = useAuth();

  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-text-primary text-xl font-semibold">
          Hello, {person?.firstName ?? 'there'}
        </h1>
        <p className="text-text-muted text-sm">
          {context?.districtName ?? 'No district'}
          {context?.rotaryYearLabel ? ` · Rotary Year ${context.rotaryYearLabel}` : ''}
        </p>
      </div>

      {context && !context.isYearWritable && context.rotaryYearId && (
        // A locked year, or one reached through ?year=. Saying so once at the top beats
        // a member discovering it when a form is refused.
        <div className="border-warning/20 bg-warning-subtle text-warning-text rounded-lg border px-4 py-3 text-sm">
          This Rotary Year is read-only. You can view everything and change nothing.
        </div>
      )}

      <Card title="Your appointments">
        {appointments.length === 0 ? (
          <EmptyState
            title="You hold no active appointment"
            description="Access in this system comes from appointments, not from accounts. Ask your district secretary to appoint you for this Rotary Year."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {appointments.map((appointment) => (
              <li
                key={appointment.id}
                className="border-border-subtle flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="text-text-primary truncate text-sm font-medium">
                    {appointment.positionName}
                  </p>
                  <p className="text-text-muted truncate text-xs">
                    {appointment.scopeName ?? appointment.scopeType}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="info">{appointment.scopeType}</Badge>
                  <span className="text-text-muted text-xs">
                    from {appointment.startsOn}
                    {appointment.endsOn ? ` to ${appointment.endsOn}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="What you can do">
        {context && context.permissions.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {context.permissions.map((permission) => (
              <li key={permission}>
                <Badge>{permission}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No permissions yet" />
        )}
      </Card>
    </div>
  );
}

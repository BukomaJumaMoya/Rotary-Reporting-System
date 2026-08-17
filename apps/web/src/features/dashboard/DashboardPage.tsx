import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, SkeletonList } from '../../components/ui';
import { Icon, type IconName } from '../../components/ui/icons';
import { useOutbox } from '../../lib/offline/submit';
import { cx } from '../../lib/cx';
import { useAuth } from '../auth/useAuth';

/**
 * THE DASHBOARD.
 *
 * Ordered by urgency, not by module. A member signing in at eleven at night wants to know
 * what needs doing, then who the system thinks they are — in that order. Anything that
 * needs attention comes first, the quick actions for their actual position come second, and
 * the account detail sits underneath where it can be checked but does not compete.
 *
 * It reads nothing the shell has not already fetched. `GET /auth/me` is in the cache before
 * this renders — the login response seeds it — so the screen paints immediately rather than
 * showing a spinner over data the client is already holding.
 */

/** Something needing attention. Rendered only when true; an empty alert strip is noise. */
interface Alert {
  tone: 'warning' | 'danger' | 'info';
  icon: IconName;
  text: string;
  to?: string;
  action?: string;
}

function AlertStrip({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => (
        <li
          key={alert.text}
          className={cx(
            'text-table flex flex-wrap items-center gap-3 rounded-md px-4 py-3',
            alert.tone === 'danger' && 'bg-danger-subtle text-danger-text',
            // Warnings always carry an icon — colour alone is not a signal everybody
            // receives, and amber sits close enough to gold to need the help.
            alert.tone === 'warning' && 'bg-warning-subtle text-warning-text',
            alert.tone === 'info' && 'bg-info-subtle text-info-text',
          )}
        >
          <Icon name={alert.icon} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{alert.text}</span>
          {alert.to && alert.action && (
            <Link
              to={alert.to}
              className="text-label shrink-0 font-medium underline underline-offset-2"
            >
              {alert.action}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

interface QuickAction {
  to: string;
  label: string;
  icon: IconName;
  permission: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    to: '/report',
    label: 'Report an activity',
    icon: 'report',
    permission: 'activity:create:club',
  },
  {
    to: '/membership/record',
    label: 'Record a member',
    icon: 'members',
    permission: 'membership:write:club',
  },
  {
    to: '/finance/transactions',
    label: 'Record money',
    icon: 'money',
    permission: 'finance:write:club',
  },
  { to: '/clubs', label: 'Browse clubs', icon: 'clubs', permission: 'club:read:district' },
];

/** The two or three things this member's position actually exists to do. */
function QuickActions() {
  const { permissions } = useAuth();
  const actions = QUICK_ACTIONS.filter((action) => permissions.has(action.permission));

  if (actions.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {actions.map((action) => (
        <Link
          key={action.to}
          to={action.to}
          className="border-border-subtle bg-surface hover:border-border-strong hover:bg-surface-raised press flex flex-col gap-3 rounded-lg border p-4 shadow-[var(--shadow-sm)]"
        >
          <span className="bg-accent-subtle text-accent-text grid size-9 place-items-center rounded-md">
            <Icon name={action.icon} className="size-4" />
          </span>
          <span className="text-text-primary text-table font-medium text-balance">
            {action.label}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { isLoading, person, context, appointments, mfaEnabled, mfaRecoveryCodesRemaining } =
    useAuth();
  const { count: pending } = useOutbox();

  if (isLoading) return <SkeletonList rows={3} />;

  const primary = appointments[0];

  const alerts: Alert[] = [];
  if (pending > 0) {
    alerts.push({
      tone: 'info',
      icon: 'pending',
      text: `${pending} ${pending === 1 ? 'entry is' : 'entries are'} waiting to be sent. They are saved on this device and will go when you are back on a connection.`,
      to: '/pending',
      action: 'See what is waiting',
    });
  }
  if (context && !context.isYearWritable && context.rotaryYearId) {
    // Said once at the top, as well as in the header strip. A member discovering a locked
    // year when a finished form is refused has lost the five minutes they spent on it.
    alerts.push({
      tone: 'warning',
      icon: 'history',
      text: `Rotary Year ${context.rotaryYearLabel ?? ''} is read-only. You can view everything and change nothing.`,
    });
  }
  if (!mfaEnabled) {
    alerts.push({
      tone: 'warning',
      icon: 'positions',
      text: 'Two-factor sign-in is not switched on for this account.',
    });
  } else if (mfaRecoveryCodesRemaining > 0 && mfaRecoveryCodesRemaining <= 2) {
    alerts.push({
      tone: 'warning',
      icon: 'positions',
      text: `Only ${mfaRecoveryCodesRemaining} recovery ${mfaRecoveryCodesRemaining === 1 ? 'code' : 'codes'} left. Generate more before you need them — finding out you have none at the moment your phone dies is the failure they exist to prevent.`,
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        {/* The editorial face, at title size. Quiet: this greets somebody, it does not
            announce anything. */}
        <h1 className="font-serif text-title text-text-primary text-balance">
          Hello, {person?.firstName ?? 'there'}
        </h1>
        <p className="text-text-muted text-table mt-1.5">
          {primary ? primary.positionName : 'No active appointment'}
          {primary?.scopeName ? ` · ${primary.scopeName}` : ''}
          {context?.rotaryYearLabel ? ` · RY ${context.rotaryYearLabel}` : ''}
        </p>
      </header>

      <AlertStrip alerts={alerts} />

      <QuickActions />

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
                className="border-border-subtle flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"
              >
                <div className="min-w-0">
                  <p className="text-text-primary text-table truncate font-medium">
                    {appointment.positionName}
                  </p>
                  <p className="text-text-muted text-label truncate">
                    {appointment.scopeName ?? appointment.scopeType}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="info">{appointment.scopeType}</Badge>
                  <span className="text-text-muted text-label tabular-nums">
                    from {appointment.startsOn}
                    {appointment.endsOn ? ` to ${appointment.endsOn}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
        The permission codes, behind a disclosure.

        They used to be the second card on the page, as a wall of `activity:create:club`
        chips. That is a developer's view of an account: precise, complete, and meaningless
        to the club secretary it was being shown to. It stays because it genuinely helps when
        somebody rings up asking why a screen is missing — but it stays folded, because the
        answer to "what can I do here" is the quick actions above, not a list of codes.
      */}
      {context && context.permissions.length > 0 && (
        <details className="group">
          <summary className="text-text-muted hover:text-text-primary text-table inline-flex cursor-pointer items-center gap-2 transition-colors">
            <Icon
              name="expand"
              className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            Exactly what this account may do ({context.permissions.length} permissions)
          </summary>
          <ul className="mt-3 flex flex-wrap gap-2">
            {context.permissions.map((permission) => (
              <li key={permission}>
                <Badge>{permission}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

import { Card, PageHeader } from '../../components/ui';
import { Icon, type IconName } from '../../components/ui/icons';
import { cx } from '../../lib/cx';
import { useSidebar, useThemePreference, type ThemePreference } from '../../lib/theme';
import { useAuth } from '../auth/useAuth';

/**
 * SETTINGS.
 *
 * Where the personal, device-level preferences live — the ones that change what this member
 * sees on this phone and nothing else.
 *
 * The theme control moved here out of the application header. A theme switch sitting
 * permanently beside the Rotary Year badge gave a personal display preference the same
 * visual weight as the dimension every figure on the screen is scoped by, which is the wrong
 * hierarchy and reads as a toy on a screen somebody is about to put in front of a board.
 *
 * Nothing here is district data. Everything is stored on the device, which is also why it is
 * cleared on sign-out along with the rest of the device state — a shared club phone should
 * not hand the next officer the previous one's preferences.
 */

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: IconName;
}

const THEME_CHOICES: Choice<ThemePreference>[] = [
  {
    value: 'system',
    label: 'Match my device',
    description: 'Follows the phone or computer, including switching automatically at night.',
    icon: 'settings',
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Ink on paper. The setting the printed and exported views always use.',
    icon: 'sun',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Easier at night and on a dim screen. Exports and printing stay light.',
    icon: 'moon',
  },
];

/** A radio group that looks like a list of choices rather than a form control. */
function ChoiceList<T extends string>({
  legend,
  hint,
  choices,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  choices: Choice<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-text-primary text-table font-medium">{legend}</legend>
      {hint && <p className="text-text-muted text-label mt-1">{hint}</p>}

      <div className="border-border-subtle mt-3 divide-y divide-border-subtle border-y">
        {choices.map((choice) => {
          const isSelected = choice.value === value;
          return (
            <label
              key={choice.value}
              className={cx(
                'flex min-h-14 cursor-pointer items-center gap-4 py-3',
                'hover:bg-surface-sunken -mx-2 px-2 transition-colors',
              )}
            >
              <input
                type="radio"
                name={legend}
                value={choice.value}
                checked={isSelected}
                onChange={() => onChange(choice.value)}
                className="accent-accent size-4 shrink-0"
              />
              <Icon name={choice.icon} className="text-text-muted size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="text-text-primary text-table block font-medium">
                  {choice.label}
                </span>
                <span className="text-text-muted text-label block text-pretty">
                  {choice.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SettingsPage() {
  const { preference, setPreference } = useThemePreference();
  const { isRail, toggle: toggleSidebar } = useSidebar();
  const { person, context } = useAuth();

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader
        title="Settings"
        description="Preferences for this device. They are not shared with anyone else, and they do not change any district record."
      />

      <div className="flex flex-col gap-6">
        <Card title="Appearance">
          <div className="flex flex-col gap-8">
            <ChoiceList
              legend="Theme"
              hint="Printing and exports always use the light theme, whatever is chosen here — a dark screenshot in a board pack is a photocopier's problem."
              choices={THEME_CHOICES}
              value={preference}
              onChange={setPreference}
            />

            <ChoiceList
              legend="Sidebar"
              hint="On a phone the menu is always a drawer; this applies to tablets and computers."
              choices={[
                {
                  value: 'expanded' as const,
                  label: 'Show labels',
                  description: 'The full menu, with the name of every screen.',
                  icon: 'expand',
                },
                {
                  value: 'rail' as const,
                  label: 'Icons only',
                  description:
                    'A narrow rail that gives the page more room. Hovering it shows the labels.',
                  icon: 'collapse',
                },
              ]}
              value={isRail ? 'rail' : 'expanded'}
              onChange={(next) => {
                if ((next === 'rail') !== isRail) toggleSidebar();
              }}
            />
          </div>
        </Card>

        <Card title="This account">
          {/*
            Read-only, and deliberately so. Everything here is district data owned by
            governance: a name change is a person record, and access comes from appointments
            rather than from anything a member can set about themselves.
          */}
          <dl className="text-table grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-text-muted">Name</dt>
            <dd className="text-text-primary">
              {person ? `${person.firstName} ${person.lastName}` : '—'}
            </dd>
            <dt className="text-text-muted">District</dt>
            <dd className="text-text-primary">{context?.districtName ?? '—'}</dd>
            <dt className="text-text-muted">Rotary Year</dt>
            <dd className="text-text-primary">{context?.rotaryYearLabel ?? '—'}</dd>
          </dl>
          <p className="text-text-muted text-label mt-4 text-pretty">
            Your name and the positions you hold are district records. To correct either, ask your
            district secretary — they are changed through governance, not through a personal
            setting.
          </p>
        </Card>
      </div>
    </div>
  );
}

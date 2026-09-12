import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type Settings,
} from '../../src/shared/settings';
import { deleteEverything, fetchStats, formatBytes } from '../../src/ui/react/api';

/**
 * Settings.
 *
 * The whole page is an argument that this extension can be trusted, so it says
 * plainly what each control does and what the extension cannot do, rather than
 * presenting a row of unexplained switches. The storage meter and the blocklist
 * are the two things a cautious person looks for first, so they are not buried.
 */

const STORAGE_CAP_BYTES = 50 * 1024 * 1024;

const RETENTION_CHOICES = [
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 0, label: 'forever' },
] as const;

export function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState({ snapshots: 0, fields: 0, bytes: 0 });
  const [newSite, setNewSite] = useState('');
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setSettings(await readSettings());
      setStats(await fetchStats());
    })();
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    // Optimistic, then persisted: a toggle that waits on storage before moving
    // feels broken even when it is working.
    setSettings((current) => ({ ...current, ...patch }));
    await writeSettings(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }, []);

  const addSite = useCallback(
    async (raw: string) => {
      const host = normaliseHost(raw);
      if (!host || settings.blockedOrigins.includes(host)) {
        setNewSite('');
        return;
      }
      await update({ blockedOrigins: [...settings.blockedOrigins, host].sort() });
      setNewSite('');
    },
    [settings.blockedOrigins, update],
  );

  const removeSite = useCallback(
    (host: string) =>
      update({ blockedOrigins: settings.blockedOrigins.filter((entry) => entry !== host) }),
    [settings.blockedOrigins, update],
  );

  const fraction = Math.min(1, stats.bytes / STORAGE_CAP_BYTES);

  return (
    <div className="min-h-screen bg-surface text-text">
      <div className="mx-auto max-w-[680px] px-6 py-10">
        <header className="flex items-baseline justify-between border-b border-line pb-4">
          <h1 className="text-[13px] font-medium uppercase tracking-[0.16em]">
            Draft Rescue
          </h1>
          <span
            className={`text-[11px] transition-opacity ${saved ? 'opacity-100 text-accent' : 'opacity-0'}`}
            role="status"
            aria-live="polite"
          >
            saved
          </span>
        </header>

        <Section
          title="Capture"
          note="What gets saved, and when."
        >
          <Toggle
            label="Save what I type"
            description="Turn this off to pause capture everywhere without uninstalling."
            checked={settings.enabled}
            onChange={(enabled) => void update({ enabled })}
          />

          <Toggle
            label="Also save in incognito windows"
            description={
              'Off by default. Chrome has its own switch for this too — the extension does ' +
              'not run in a private window at all unless you tick "Allow in incognito" on ' +
              'chrome://extensions. This setting is a second refusal on top of that, not a ' +
              'way to grant it.'
            }
            checked={settings.captureInIncognito}
            onChange={(captureInIncognito) => void update({ captureInIncognito })}
          />
        </Section>

        <Section
          title="Keep drafts for"
          note="Older drafts are deleted automatically. The check runs every six hours."
        >
          <div className="flex flex-wrap gap-2">
            {RETENTION_CHOICES.map((choice) => {
              const active = settings.retentionDays === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => void update({ retentionDays: choice.value })}
                  aria-pressed={active}
                  className={[
                    'rounded-sm border px-3 py-1.5 text-[12px] transition-colors',
                    active
                      ? 'border-accent bg-accent-dim text-text'
                      : 'border-line text-muted hover:border-line-strong hover:text-text',
                  ].join(' ')}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          title="Never save on these sites"
          note="Matches the site and everything under it, so blocking example.com also blocks mail.example.com."
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addSite(newSite);
            }}
            className="flex gap-2"
          >
            <input
              value={newSite}
              onChange={(event) => setNewSite(event.target.value)}
              placeholder="example.com"
              aria-label="Site to block"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-sm border border-line bg-raised px-2.5 py-1.5 text-[12px] text-text placeholder:text-faint focus:border-line-strong focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newSite.trim()}
              className="rounded-sm border border-line px-3 py-1.5 text-[12px] text-muted hover:border-line-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              block
            </button>
          </form>

          {settings.blockedOrigins.length === 0 ? (
            <p className="mt-3 text-[12px] text-faint">
              No sites blocked. Banking and payment sites are already refused
              automatically, along with every password and card field.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {settings.blockedOrigins.map((host) => (
                <li key={host} className="flex items-center gap-3 py-2">
                  <span className="truncate text-[12px]">{host}</span>
                  <button
                    type="button"
                    onClick={() => void removeSite(host)}
                    className="ml-auto text-[11px] text-faint hover:text-text"
                    aria-label={`Stop blocking ${host}`}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Storage" note="Drafts live in this browser profile, on this machine.">
          <div className="rounded-sm border border-line bg-raised p-4">
            <div className="flex items-baseline gap-3 text-[12px]">
              <span className="text-text">{formatBytes(stats.bytes)}</span>
              <span className="text-faint">of 50 MB</span>
              <span className="ml-auto text-muted">
                {stats.snapshots} drafts across {stats.fields} fields
              </span>
            </div>

            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken"
              role="img"
              aria-label={`Storage used: ${formatBytes(stats.bytes)} of 50 MB`}
            >
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(fraction * 100, stats.bytes > 0 ? 1 : 0)}%` }}
              />
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              When the cap is reached the oldest drafts are deleted first. The
              most complete version of any field is never deleted to make room —
              that is the one you are most likely to want back.
            </p>
          </div>

          <div className="mt-4 rounded-sm border border-alarm-dim bg-raised p-4">
            <h3 className="text-[12px] text-text">Delete everything</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Removes every saved draft from this machine. It cannot be undone,
              and there is no copy anywhere else.
            </p>

            {confirmingWipe ? (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      await deleteEverything();
                      setStats(await fetchStats());
                      setConfirmingWipe(false);
                    })();
                  }}
                  className="rounded-sm bg-alarm px-3 py-1.5 text-[12px] text-on-accent"
                >
                  yes, delete all {stats.snapshots}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingWipe(false)}
                  className="text-[12px] text-faint hover:text-text"
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingWipe(true)}
                disabled={stats.snapshots === 0}
                className="mt-3 rounded-sm border border-alarm-dim px-3 py-1.5 text-[12px] text-alarm hover:bg-alarm-dim disabled:cursor-not-allowed disabled:opacity-40"
              >
                delete everything
              </button>
            )}
          </div>
        </Section>

        <Section title="What this extension cannot do" note="">
          <ul className="space-y-2 font-serif text-[13px] leading-relaxed text-muted">
            <li>
              <span className="text-text">It cannot send your drafts anywhere.</span>{' '}
              There is no network code in it at all — not disabled, not
              configurable, absent. You can check: the whole thing is a few
              thousand lines and it requests no host permissions.
            </li>
            <li>
              <span className="text-text">It does not save passwords or card details.</span>{' '}
              Password fields, one-time codes, card numbers and anything inside a
              checkout form are refused before storage. Card numbers that appear
              in ordinary text are replaced with [redacted] regardless of what
              the field is called.
            </li>
            <li>
              <span className="text-text">It does not restore anything on its own.</span>{' '}
              Nothing is ever put back into a page unless you click to do it.
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line py-7 last:border-b-0">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-text">
        {title}
      </h2>
      {note && <p className="mt-1 max-w-[76ch] text-[11px] text-faint">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'mt-0.5 h-4 w-7 shrink-0 rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-sunken',
        ].join(' ')}
      >
        <span
          className={[
            'block h-3 w-3 rounded-full transition-transform',
            checked ? 'translate-x-[13px] bg-on-accent' : 'translate-x-[1px] bg-faint',
          ].join(' ')}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[12px] text-text">{label}</span>
        <span className="mt-0.5 block max-w-[56ch] text-[11px] leading-relaxed text-faint">
          {description}
        </span>
      </span>
    </label>
  );
}

/**
 * Accept a URL, a host, or something with a path, and keep only the hostname.
 *
 * Parsed by hand rather than with `new URL()`, which would need a literal
 * `https://` prefix for a bare hostname. That is harmless here — the string is
 * never requested, and nothing in this extension could request it — but it is
 * also the exact shape of an exfiltration endpoint, and scripts/check-offline.mjs
 * rightly refuses to distinguish. Better to not write the pattern at all than to
 * teach the check to ignore it.
 */
function normaliseHost(raw: string): string {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
    .replace(/^[^/@]*@/, '') // credentials
    .split(/[/?#]/)[0] // path, query, fragment
    ?.split(':')[0] // port
    ?? '';

  // Anything left that is not host-shaped is not a site.
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host === 'localhost' ? host : '';
}

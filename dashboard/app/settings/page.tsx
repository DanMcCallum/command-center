import CronConfigPanel from '@/components/CronConfigPanel';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="text-sm text-[#6B6B6B]">
        The Ad Builder triggers the worker on-demand. Enable the schedule below
        to also run queued tasks on a cron interval.
      </p>
      <CronConfigPanel />
    </div>
  );
}

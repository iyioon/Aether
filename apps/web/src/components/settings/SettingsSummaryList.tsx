export function SummaryList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="settings-summary-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="truncate text-xs font-medium text-muted-foreground">
            {label}
          </dt>
          <dd className="whitespace-nowrap font-mono text-xs font-medium text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

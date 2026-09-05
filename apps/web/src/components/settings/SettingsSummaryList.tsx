export function SummaryList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="settings-summary-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

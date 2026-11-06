type TechnicalDetail = {
  label: string;
  value: unknown;
};

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Details unavailable";
  }
}

export function LogTechnicalDetails({
  details,
}: {
  details: TechnicalDetail[];
}) {
  const availableDetails = details.filter(
    ({ value }) => value !== null && value !== undefined && value !== "",
  );

  if (availableDetails.length === 0) return null;

  return (
    <details className="mt-3 rounded-lg border border-[#dfe7ec] px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold text-[#294b60]">
        View technical details
      </summary>
      <dl className="mt-3 grid gap-3">
        {availableDetails.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-bold uppercase tracking-wide text-[#82919b]">
              {label}
            </dt>
            <dd className="mt-1 break-all text-xs text-[#617582]">
              {typeof value === "object" ? (
                <pre className="whitespace-pre-wrap font-sans">
                  {formatValue(value)}
                </pre>
              ) : (
                formatValue(value)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

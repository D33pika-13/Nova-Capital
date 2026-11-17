export function formatMoney(value: string | null, currency: string) {
  if (value === null) return "Not recorded";
  const negative = value.startsWith("-");
  const [whole, decimal = ""] = value.replace(/^-/, "").split(".");
  const grouped = new Intl.NumberFormat(
    currency === "INR" ? "en-IN" : "en-US",
  ).format(BigInt(whole));
  const fraction = decimal.padEnd(2, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${currency} ${negative ? "−" : ""}${grouped}.${fraction}`;
}
export function formatDate(value: string) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  );
}
export function toUtcInput(value: string) {
  return value.replace(/Z$/, "");
}
export function fromUtcInput(value: string) {
  return new Date(`${value}Z`).toISOString();
}

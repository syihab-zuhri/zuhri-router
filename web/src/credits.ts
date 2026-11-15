const SCALE = 1_000_000n;

export function integer(value: unknown): string {
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value)) throw new Error('invalid_integer');
  return value;
}
export function grouped(value: string): string {
  return integer(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
export function formatCredits(micro: string): string {
  const n = BigInt(integer(micro));
  const abs = n < 0n ? -n : n;
  const fraction = (abs % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${n < 0n ? '-' : ''}${grouped(String(abs / SCALE))}${fraction ? ',' + fraction : ''}`;
}
export function creditsToMicro(credits: string): string {
  if (!/^(0|[1-9][0-9]*)([.,][0-9]{1,6})?$/.test(credits)) throw new Error('invalid_credits');
  const [whole, fraction = ''] = credits.replace(',', '.').split('.');
  return String(BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0')));
}
export function formatDecimal(value: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new Error('invalid_decimal');
  const [whole, fraction = ''] = value.split('.');
  return `${grouped(whole)}${fraction ? ',' + fraction.replace(/0+$/, '') : ''}`;
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) + ' WIB';
}

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function nanoid(len = 10) {
  const out = new Array(len);
  const rand = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out[i] = alphabet[rand[i] % alphabet.length];
  return out.join('');
}

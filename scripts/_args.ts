export const flag = (name: string) => Deno.args.includes(`--${name}`);
export const opt = (name: string, d?: string) => {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : d;
};

import "server-only";
/** Small flat string-only JSON with decoded duplicate-key rejection. */
export function parseFlatStringObject(
  text: string,
  maxLength: number,
): Record<string, string> {
  if (typeof text !== "string" || text.length > maxLength) throw Error("json");
  const token =
    /\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|[{}:,])\s*/gy;
  let offset = 0;
  const take = () => {
    token.lastIndex = offset;
    const match = token.exec(text);
    if (!match) throw Error("json");
    offset = token.lastIndex;
    return match[1];
  };
  if (take() !== "{") throw Error("json");
  const result: Record<string, string> = Object.create(null);
  let next = take();
  if (next !== "}")
    while (true) {
      if (!next.startsWith('"')) throw Error("json");
      const key: string = JSON.parse(next);
      if (Object.hasOwn(result, key) || take() !== ":") throw Error("json");
      const value = take();
      if (!value.startsWith('"')) throw Error("json");
      result[key] = JSON.parse(value);
      next = take();
      if (next === "}") break;
      if (next !== ",") throw Error("json");
      next = take();
    }
  if (offset !== text.length) throw Error("json");
  return result;
}

/** Escapes LIKE wildcards in user input. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const iso = (value: Date) => value.toISOString();

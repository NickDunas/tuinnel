const noColor = !!process.env['NO_COLOR'];

export function useColor() {
  return { noColor };
}

/** Returns the color if NO_COLOR is not set, undefined otherwise. */
export function color(c: string | undefined): string | undefined {
  return noColor ? undefined : c;
}

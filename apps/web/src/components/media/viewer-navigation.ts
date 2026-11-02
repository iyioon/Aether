export function adjacentViewerId(
  currentId: string,
  direction: -1 | 1,
  currentIds: string[],
  previousIds: string[]
): string | null {
  const currentIndex = currentIds.indexOf(currentId);
  if (currentIndex >= 0) return currentIds[currentIndex + direction] ?? null;
  const previousIndex = previousIds.indexOf(currentId);
  if (previousIndex < 0) return null;
  const available = new Set(currentIds);
  for (
    let index = previousIndex + direction;
    index >= 0 && index < previousIds.length;
    index += direction
  ) {
    if (available.has(previousIds[index]!)) return previousIds[index]!;
  }
  return null;
}

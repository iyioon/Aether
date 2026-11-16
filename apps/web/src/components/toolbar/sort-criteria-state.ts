import type { SortCriterion } from "../../api/client";

export function moveSortCriterion(
  criteria: SortCriterion[],
  from: number,
  to: number
): SortCriterion[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= criteria.length ||
    to >= criteria.length ||
    from === to
  )
    return criteria;
  const next = [...criteria];
  const [criterion] = next.splice(from, 1);
  next.splice(to, 0, criterion!);
  return next;
}

export function closestSortRow(
  pointerY: number,
  rows: Array<{ top: number; height: number }>
): number {
  if (!Number.isFinite(pointerY) || rows.length === 0) return -1;
  let closest = 0;
  let distance = Infinity;
  for (const [index, row] of rows.entries()) {
    const nextDistance = Math.abs(pointerY - row.top - row.height / 2);
    if (nextDistance < distance) {
      closest = index;
      distance = nextDistance;
    }
  }
  return closest;
}

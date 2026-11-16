import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import type {
  SortCriterion,
  SortDirection,
  SortField,
  SortMode
} from "../../api/client";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { MAX_SORT_CRITERIA } from "../library-state";
import { sortFieldOptions } from "./library-control-options";
import { closestSortRow, moveSortCriterion } from "./sort-criteria-state";
import "./sort-controls.css";

export interface SortControlsProps {
  sort: SortMode;
  sortDirection: SortDirection;
  sortCriteria?: SortCriterion[];
  onSetSort: (sort: SortMode) => void;
  onSetSortCriteria: (criteria: SortCriterion[]) => void;
}

export function SortControls({
  sort,
  sortDirection,
  sortCriteria,
  onSetSort,
  onSetSortCriteria
}: SortControlsProps) {
  const criteria: SortCriterion[] =
    sort === "random"
      ? []
      : sortCriteria?.length
        ? sortCriteria
        : [{ field: sort, direction: sortDirection }];
  const rememberedCriteriaRef = useRef<SortCriterion[]>(
    sortCriteria?.length ? sortCriteria : [{ field: "date", direction: "desc" }]
  );
  const rowRefs = useRef(new Map<SortField, HTMLLIElement>());
  const focusRef = useRef<{
    field: SortField;
    control: "field" | "reorder";
    origin: Element | null;
  } | null>(null);
  const dragRef = useRef<{
    field: SortField;
    pointerId: number;
    startY: number;
    to: number;
    signature: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useLayoutEffect(() => {
    if (sort !== "random") rememberedCriteriaRef.current = criteria;
    const pending = focusRef.current;
    if (!pending) return;
    const target = rowRefs.current
      .get(pending.field)
      ?.querySelector<HTMLButtonElement>(
        `[data-sort-control="${pending.control}"]`
      );
    if (!target) return;
    focusRef.current = null;
    if (
      document.activeElement === pending.origin ||
      document.activeElement === document.body
    )
      target.focus();
  });

  function focusField(field: SortField, control: "field" | "reorder") {
    focusRef.current = { field, control, origin: document.activeElement };
  }

  function move(from: number, to: number) {
    const next = moveSortCriterion(criteria, from, to);
    if (next === criteria) return;
    const criterion = criteria[from]!;
    focusField(criterion.field, "reorder");
    onSetSortCriteria(next);
    const label = sortFieldOptions.find(
      (option) => option.value === criterion.field
    )!.label;
    setAnnouncement(`${label} moved to position ${to + 1} of ${next.length}.`);
  }

  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientY - current.startY) < 6 && !dropTarget) return;
    const bounds = criteria.flatMap((criterion) => {
      const row = rowRefs.current.get(criterion.field);
      return row ? [row.getBoundingClientRect()] : [];
    });
    const to = closestSortRow(event.clientY, bounds);
    const from = criteria.findIndex(
      (criterion) => criterion.field === current.field
    );
    if (to < 0 || from < 0) return;
    event.preventDefault();
    current.to = to;
    setDropTarget({ from, to });
  }

  function cancelDrag() {
    dragRef.current = null;
    setDropTarget(null);
  }

  return (
    <div className="view-options-fields sort-controls">
      <Label className="sort-random-choice">
        <Checkbox
          checked={sort === "random"}
          onCheckedChange={(checked) => {
            cancelDrag();
            if (checked === true) {
              rememberedCriteriaRef.current = criteria;
              onSetSort("random");
            } else onSetSortCriteria(rememberedCriteriaRef.current);
          }}
        />
        Random order
      </Label>
      {sort !== "random" ? (
        <>
          <ol className="sort-criteria-list" aria-label="Sort criteria">
            {criteria.map((criterion, index) => {
              const option = sortFieldOptions.find(
                (item) => item.value === criterion.field
              )!;
              return (
                <li
                  className="sort-criterion"
                  key={criterion.field}
                  data-sort-field={criterion.field}
                  data-sort-drop={
                    dropTarget?.to === index && dropTarget.from !== index
                      ? dropTarget.to < dropTarget.from
                        ? "before"
                        : "after"
                      : undefined
                  }
                  ref={(row) => {
                    if (row) rowRefs.current.set(criterion.field, row);
                    else rowRefs.current.delete(criterion.field);
                  }}
                >
                  <div className="sort-criterion-heading">
                    <Button
                      className="sort-reorder-handle"
                      variant="ghost"
                      size="icon"
                      type="button"
                      data-sort-control="reorder"
                      aria-label={`Reorder ${option.label}`}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      title="Drag or use arrow keys to reorder"
                      disabled={criteria.length === 1}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "ArrowUp" &&
                          event.key !== "ArrowDown"
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || !event.isPrimary) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        dragRef.current = {
                          field: criterion.field,
                          pointerId: event.pointerId,
                          startY: event.clientY,
                          to: index,
                          signature: JSON.stringify(criteria)
                        };
                      }}
                      onPointerMove={dragMove}
                      onPointerUp={(event) => {
                        const current = dragRef.current;
                        if (
                          current?.pointerId === event.pointerId &&
                          current.signature === JSON.stringify(criteria)
                        )
                          move(index, current.to);
                        cancelDrag();
                      }}
                      onPointerCancel={cancelDrag}
                      onLostPointerCapture={cancelDrag}
                    >
                      <GripVertical aria-hidden="true" />
                    </Button>
                    <span className="sort-priority">
                      {index === 0 ? "Sort by" : "Then by"}
                    </span>
                    <div className="sort-criterion-actions">
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={`Move ${option.label} up`}
                        title="Move up"
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={`Move ${option.label} down`}
                        title="Move down"
                        disabled={index === criteria.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={`Remove ${option.label} sort`}
                        title="Remove sort"
                        disabled={criteria.length === 1}
                        onClick={() => {
                          const next = criteria.filter(
                            (_, position) => position !== index
                          );
                          focusField(
                            next[Math.min(index, next.length - 1)]!.field,
                            "field"
                          );
                          onSetSortCriteria(next);
                          setAnnouncement(`${option.label} sort removed.`);
                        }}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="sort-criterion-fields">
                    <Select
                      value={criterion.field}
                      onValueChange={(value) => {
                        const chosen = sortFieldOptions.find(
                          (item) => item.value === value
                        );
                        if (
                          !chosen ||
                          criteria.some(
                            (item, position) =>
                              position !== index && item.field === value
                          )
                        )
                          return;
                        focusField(chosen.value, "field");
                        onSetSortCriteria(
                          criteria.map((item, position) =>
                            position === index
                              ? {
                                  field: chosen.value,
                                  direction: chosen.defaultDirection
                                }
                              : item
                          )
                        );
                      }}
                    >
                      <SelectTrigger
                        aria-label={`Sort field ${index + 1}`}
                        data-sort-control="field"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="view-options-select-menu">
                        {sortFieldOptions.map((item) => (
                          <SelectItem
                            key={item.value}
                            value={item.value}
                            disabled={criteria.some(
                              (other, position) =>
                                position !== index && other.field === item.value
                            )}
                          >
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={criterion.direction}
                      onValueChange={(value) => {
                        if (value !== "asc" && value !== "desc") return;
                        onSetSortCriteria(
                          criteria.map((item, position) =>
                            position === index
                              ? { ...item, direction: value }
                              : item
                          )
                        );
                      }}
                    >
                      <SelectTrigger aria-label={`Sort direction ${index + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="view-options-select-menu">
                        <SelectItem value="asc">{option.asc}</SelectItem>
                        <SelectItem value="desc">{option.desc}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              );
            })}
          </ol>
          <Button
            className="sort-add-criterion"
            variant="outline"
            type="button"
            disabled={criteria.length >= MAX_SORT_CRITERIA}
            title={
              criteria.length >= MAX_SORT_CRITERIA
                ? "Use up to five sort criteria"
                : undefined
            }
            onClick={() => {
              const next = sortFieldOptions.find(
                (item) =>
                  !criteria.some((criterion) => criterion.field === item.value)
              );
              if (!next || criteria.length >= MAX_SORT_CRITERIA) return;
              focusField(next.value, "field");
              onSetSortCriteria([
                ...criteria,
                { field: next.value, direction: next.defaultDirection }
              ]);
            }}
          >
            <Plus aria-hidden="true" />
            Add sort
          </Button>
        </>
      ) : null}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

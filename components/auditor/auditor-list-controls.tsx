"use client";

import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/field";

type AuditorListControlsProps = {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  typeLabel: string;
  typeValue: string;
  onTypeChange: (value: string) => void;
  typeOptions: string[];
  fromDate: string;
  onFromDateChange: (value: string) => void;
  toDate: string;
  onToDateChange: (value: string) => void;
  visibleCount: number;
  totalCount: number;
};

function labelForOption(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function filterAuditorRows<T>(
  rows: T[],
  options: {
    search: string;
    type: string;
    fromDate: string;
    toDate: string;
    getType: (row: T) => string;
    getDate: (row: T) => string;
  },
) {
  const term = options.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (term) {
      let searchable = "";
      try {
        searchable = JSON.stringify(row)?.toLowerCase() ?? "";
      } catch {
        searchable = String(row).toLowerCase();
      }
      if (!searchable.includes(term)) return false;
    }

    if (options.type && options.getType(row).toLowerCase() !== options.type.toLowerCase()) {
      return false;
    }

    const date = localDateKey(options.getDate(row));
    if (options.fromDate && (!date || date < options.fromDate)) return false;
    if (options.toDate && (!date || date > options.toDate)) return false;
    return true;
  });
}

export function AuditorListControls({
  search,
  onSearchChange,
  searchPlaceholder,
  typeLabel,
  typeValue,
  onTypeChange,
  typeOptions,
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
  visibleCount,
  totalCount,
}: AuditorListControlsProps) {
  const typePlural = typeLabel.toLowerCase() === "status"
    ? "statuses"
    : `${typeLabel.toLowerCase()}s`;

  return (
    <div className="grid gap-3 border-b border-[#e2e8ed] px-4 py-4 sm:px-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_12rem_10rem_10rem]">
        <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-[#617582]">
          Search records
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8b9aa4]" />
            <Input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search auditor records"
              className="h-10 rounded-lg border border-[#dce5ea] bg-white pl-9 pr-3"
            />
          </span>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">
          {typeLabel}
          <Select
            value={typeValue}
            onChange={(event) => onTypeChange(event.target.value)}
            aria-label={`Filter by ${typeLabel.toLowerCase()}`}
            className="h-10 rounded-lg border border-[#dce5ea] bg-white px-3"
          >
            <option value="">All {typePlural}</option>
            {typeOptions.map((option) => (
              <option key={option} value={option}>{labelForOption(option)}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">
          From date
          <Input
            type="date"
            value={fromDate}
            onChange={(event) => onFromDateChange(event.target.value)}
            aria-label="Filter from date"
            className="h-10 rounded-lg border border-[#dce5ea] bg-white px-3"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#617582]">
          To date
          <Input
            type="date"
            value={toDate}
            onChange={(event) => onToDateChange(event.target.value)}
            aria-label="Filter to date"
            className="h-10 rounded-lg border border-[#dce5ea] bg-white px-3"
          />
        </label>
      </div>
      <p className="text-xs text-[#748693]">Showing {visibleCount} of {totalCount} records</p>
    </div>
  );
}

export function auditorFilterOptions(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
}

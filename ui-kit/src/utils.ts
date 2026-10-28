import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/* The type scale in theme.css adds font sizes tailwind-merge does not know; without this, text-micro and a text colour would be treated as conflicting colours. */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["micro", "caption", "label", "body", "title", "metric", "display"] }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

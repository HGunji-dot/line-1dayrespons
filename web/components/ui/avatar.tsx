import * as React from "react";
import { cn } from "@/lib/utils";

/** 軽量版アバター（依存を増やさないため div ベース）。後で shadcn の avatar に差し替え可 */
function Avatar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white",
        className
      )}
      {...props}
    />
  );
}

export { Avatar };

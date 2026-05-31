import * as React from "react";
import { cn } from "@/lib/utils";

/** 軽量版スクロール領域（overflow ベース）。後で shadcn の scroll-area に差し替え可 */
const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative overflow-y-auto overflow-x-hidden", className)}
      {...props}
    >
      {children}
    </div>
  )
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };

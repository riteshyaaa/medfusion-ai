import { cn } from "@/lib/utils";

interface SeverityBadgeProps {
  severity: string;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config: Record<string, { color: string, label: string, dot: string }> = {
    normal: { color: "bg-success/15 text-success border-success/30", label: "Normal", dot: "bg-success" },
    mild: { color: "bg-warning/15 text-warning border-warning/30", label: "Mild", dot: "bg-warning" },
    moderate: { color: "bg-orange-500/15 text-orange-600 border-orange-500/30", label: "Moderate", dot: "bg-orange-500" },
    severe: { color: "bg-danger/15 text-danger border-danger/30", label: "Severe", dot: "bg-danger" },
  };

  const normalizedSeverity = severity?.toLowerCase() || "";
  const style = config[normalizedSeverity];

  if (!style) {
    return <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border border-slate-300 bg-slate-100 text-slate-600", className)}>Not assessed</span>;
  }

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
      style.color,
      className
    )}>
      <div className={cn("w-1.5 h-1.5 rounded-full", style.dot)} />
      {style.label}
    </div>
  );
}

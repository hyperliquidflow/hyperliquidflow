import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:     "border-transparent bg-primary text-primary-foreground",
        secondary:   "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline:     "text-foreground",
        long:        "border-transparent bg-flow-green/20 text-flow-green border-flow-green/30",
        short:       "border-transparent bg-flow-red/20 text-flow-red border-flow-red/30",
        neutral:     "border-transparent bg-flow-amber/20 text-flow-amber border-flow-amber/30",
        bull:        "border-transparent bg-flow-green/20 text-flow-green",
        bear:        "border-transparent bg-flow-red/20 text-flow-red",
        ranging:     "border-transparent bg-flow-muted/20 text-flow-muted",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }

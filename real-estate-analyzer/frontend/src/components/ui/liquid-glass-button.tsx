"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary-dark",
        destructive: "bg-danger text-white hover:bg-danger/90",
        outline: "border border-border bg-white text-text-primary hover:bg-bg-light",
        secondary: "bg-secondary text-text-primary hover:bg-secondary/80",
        ghost: "text-text-primary hover:bg-bg-light",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-8",
        xl: "h-12 rounded-lg px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

// LiquidButton now renders as a clean primary button (Zillow blue)
interface LiquidButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function LiquidButton({
  className,
  size,
  asChild = false,
  children,
  ...props
}: LiquidButtonProps) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(
        buttonVariants({ variant: "default", size, className }),
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}

// MetalButton now renders as a clean flat button
interface MetalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "success" | "error"
}

const MetalButton = React.forwardRef<HTMLButtonElement, MetalButtonProps>(
  ({ children, className, variant = "default", ...props }, ref) => {
    const variantMap: Record<string, string> = {
      default: "bg-text-primary text-white hover:bg-text-primary/90",
      primary: "bg-primary text-white hover:bg-primary-dark",
      success: "bg-accent text-white hover:bg-accent/90",
      error: "bg-danger text-white hover:bg-danger/90",
    }

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors cursor-pointer",
          variantMap[variant] || variantMap.default,
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)
MetalButton.displayName = "MetalButton"

const liquidbuttonVariants = buttonVariants

export { Button, buttonVariants, liquidbuttonVariants, LiquidButton, MetalButton }
export type { ButtonProps, LiquidButtonProps, MetalButtonProps }

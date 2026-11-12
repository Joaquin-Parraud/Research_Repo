import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "normal" | "small";
}

export function Button({
  variant = "default",
  size = "normal",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    variant === "default" ? "" : styles[variant],
    size === "small" ? styles.small : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}

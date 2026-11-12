import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useAppNavigation } from "../hooks/useAppNavigation";

interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
}

/** A real link (middle-click, copy address) whose plain click is routed through the guard. */
export function AppLink({ to, onClick, ...rest }: AppLinkProps) {
  const { go } = useAppNavigation();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(to);
  }
  return <a href={to} onClick={handleClick} {...rest} />;
}
